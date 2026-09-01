// CHATWOOT MOCK — un Chatwoot de mentira, suficiente para que el bot no note la diferencia.
//
//   node tests/chatwoot-mock.js            -> escucha en :8787
//   PORT=9000 node tests/chatwoot-mock.js
//
// POR QUE EXISTE
// El bot no solo RECIBE de Chatwoot: tambien le pregunta el historial (Get Historial) y
// le postea sus respuestas (9 nodos). `Decidir` come de ese historial para el debounce,
// la idempotencia, el cap 24h, `avisoDado` y `lastBotReplies`. Un mock que solo dispare
// el webhook dejaria `Decidir` sin ejercitar — y `Decidir` es justo donde vivieron el
// bug del debounce, el de NFC y el de "ya respondido". Asi que el mock hace las DOS
// puntas: sirve el historial y absorbe los envios.
//
// Estado en memoria a proposito: cada corrida arranca limpia y ningun test hereda
// basura del anterior. Se pierde al reiniciar, que es lo que queremos.
//
// Sin dependencias: http nativo. No hay que instalar nada.

const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
// Tiene que ser el MISMO secreto que $env.CHATWOOT_WEBHOOK_SECRET en n8n, o
// `Verificar HMAC` rechaza todo y `Filtro Ingreso` corta el flujo en silencio.
const SECRET = process.env.CHATWOOT_WEBHOOK_SECRET || 'test-secret';
// A donde dispara el mock cuando entra un mensaje: el webhook del workflow de TEST.
const N8N_WEBHOOK = process.env.N8N_WEBHOOK || 'http://localhost:5678/webhook/chatwoot-test';
// Clave para que solo yo pueda disparar tests si esto sale por el tunel.
const TEST_KEY = process.env.TEST_KEY || '';

// ───────────────────────────────────────────────────────────────────────────
// ESTADO
// conversaciones: id -> { mensajes: [], labels: [], meta: {} }
// ───────────────────────────────────────────────────────────────────────────
const convs = new Map();
let nextMsgId = 1000;

// El reloj es inyectable porque el cap de 25/24h y la idempotencia comparan
// created_at contra Date.now(). Sin poder mover el reloj, testear "el cap se
// resetea a las 24h" implicaria esperar 24 horas.
let offsetMs = 0;
const ahora = () => Date.now() + offsetMs;

function getConv(id) {
  if (!convs.has(id)) {
    convs.set(id, { id, mensajes: [], labels: [], assignee: null });
  }
  return convs.get(id);
}

// Forma de mensaje igual a la del API de Chatwoot. Los campos que lee `Decidir`:
//   id, content, message_type ('incoming'|'outgoing'), created_at (unix seg), private
function nuevoMensaje(conv, { content, tipo, private: priv = false, createdAt }) {
  const m = {
    id: nextMsgId++,
    content: content == null ? '' : String(content),
    message_type: tipo,
    content_type: 'text',
    private: priv,
    // Chatwoot manda created_at en SEGUNDOS unix. `Decidir` lo normaliza con num(),
    // pero si aca mandaramos ms el cap de 24h se calcularia mal.
    created_at: Math.floor((createdAt != null ? createdAt : ahora()) / 1000),
    conversation_id: conv.id,
  };
  conv.mensajes.push(m);
  return m;
}

// ───────────────────────────────────────────────────────────────────────────
// DISPARO DEL WEBHOOK
// Arma el payload `message_created` y lo firma como lo firma Chatwoot:
//   HMAC-SHA256 sobre  `${timestamp}.${rawBody}`  con el secreto compartido.
// Firmarlo de verdad (en vez de saltear el HMAC) hace que `Verificar HMAC` y
// `Filtro Ingreso` tambien queden cubiertos por el harness.
// ───────────────────────────────────────────────────────────────────────────
function dispararWebhook(conv, msg, accountId) {
  const body = {
    event: 'message_created',
    id: msg.id,
    content: msg.content,
    message_type: 'incoming',
    created_at: msg.created_at,
    account: { id: accountId },
    conversation: {
      id: conv.id,
      channel: 'Channel::Whatsapp',
      meta: conv.assignee ? { assignee: conv.assignee } : {},
    },
    sender: { id: 1, name: 'Cliente Test' },
  };

  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  const timestamp = String(ahora());
  const firmado = Buffer.concat([Buffer.from(`${timestamp}.`), raw]);
  const firma = 'sha256=' + crypto.createHmac('sha256', SECRET).update(firmado).digest('hex');

  return new Promise((resolve) => {
    const u = new URL(N8N_WEBHOOK);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': raw.length,
          'x-chatwoot-signature': firma,
          'x-chatwoot-timestamp': timestamp,
        },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      }
    );
    req.on('error', (e) => resolve({ status: 0, error: String(e.message || e) }));
    req.write(raw);
    req.end();
  });
}

// ───────────────────────────────────────────────────────────────────────────
// RUTEO
// ───────────────────────────────────────────────────────────────────────────
const RE_MESSAGES = /^\/api\/v1\/accounts\/([^/]+)\/conversations\/([^/]+)\/messages$/;
const RE_LABELS = /^\/api\/v1\/accounts\/([^/]+)\/conversations\/([^/]+)\/labels$/;

function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) });
  res.end(b);
}

async function leerBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const ruta = u.pathname;

  // ── API DE CHATWOOT (lo que consume el bot) ──────────────────────────────

  const mMsg = RE_MESSAGES.exec(ruta);
  if (mMsg) {
    const conv = getConv(mMsg[2]);

    // Get Historial. Chatwoot devuelve {payload: [...]} en orden cronologico.
    if (req.method === 'GET') {
      return json(res, 200, { payload: conv.mensajes });
    }

    // Los 9 nodos de envio. El bot postea {content, message_type:'outgoing', ...}.
    if (req.method === 'POST') {
      const body = await leerBody(req);
      const m = nuevoMensaje(conv, {
        content: body.content,
        tipo: 'outgoing',
        private: body.private === true,
      });
      return json(res, 200, m);
    }
  }

  const mLbl = RE_LABELS.exec(ruta);
  if (mLbl && req.method === 'POST') {
    const conv = getConv(mLbl[2]);
    const body = await leerBody(req);
    const labels = Array.isArray(body.labels) ? body.labels : [body.labels].filter(Boolean);
    for (const l of labels) if (!conv.labels.includes(l)) conv.labels.push(l);
    return json(res, 200, { payload: conv.labels });
  }

  // ── API DEL HARNESS (lo que consumo yo) ──────────────────────────────────

  if (TEST_KEY && ruta.startsWith('/test/') && req.headers['x-test-key'] !== TEST_KEY) {
    return json(res, 401, { error: 'x-test-key invalida o ausente' });
  }

  // POST /test/say {conv, texto, accountId?, assignee?}
  // Mete el mensaje como entrante y dispara el webhook firmado. Devuelve cuando n8n
  // contesto — pero OJO: n8n contesta al recibir, no al terminar el turno. Para leer
  // la respuesta del bot hay que hacer GET /test/conv/:id despues (o usar wait).
  if (ruta === '/test/say' && req.method === 'POST') {
    const body = await leerBody(req);
    const convId = String(body.conv || 'c1');
    const accountId = String(body.accountId || '1');
    const conv = getConv(convId);
    if (body.assignee !== undefined) conv.assignee = body.assignee;

    const antes = conv.mensajes.length;
    const msg = nuevoMensaje(conv, { content: body.texto, tipo: 'incoming' });
    const r = await dispararWebhook(conv, msg, accountId);

    // Espera opcional a que aparezca una saliente nueva: evita que el llamador
    // tenga que adivinar cuanto tarda el turno (4 llamadas LLM = varios segundos).
    const esperarMs = body.esperar === false ? 0 : Number(body.esperar || 25000);
    let nuevas = [];
    if (esperarMs > 0) {
      const limite = Date.now() + esperarMs;
      while (Date.now() < limite) {
        nuevas = conv.mensajes.slice(antes + 1).filter((m) => m.message_type === 'outgoing');
        if (nuevas.length) break;
        await new Promise((r2) => setTimeout(r2, 250));
      }
    }

    return json(res, 200, {
      enviado: msg,
      webhook: r,
      respuestas: nuevas.map((m) => m.content),
      // Sin respuesta no siempre es un fallo: el bot calla a proposito en varios
      // caminos (skip por debounce, silencio Tier-2, cap ya avisado). Por eso se
      // reporta el hecho crudo y que el caso de test decida si esperaba silencio.
      silencio: nuevas.length === 0,
    });
  }

  // GET /test/conv/:id -> transcript + labels
  if (ruta.startsWith('/test/conv/') && req.method === 'GET') {
    const conv = getConv(ruta.slice('/test/conv/'.length));
    return json(res, 200, {
      id: conv.id,
      labels: conv.labels,
      assignee: conv.assignee,
      mensajes: conv.mensajes.map((m) => ({
        id: m.id,
        rol: m.message_type === 'incoming' ? 'cliente' : 'bot',
        content: m.content,
        created_at: m.created_at,
        private: m.private,
      })),
    });
  }

  // POST /test/reset {conv?}  -> borra una conversacion o todas
  if (ruta === '/test/reset' && req.method === 'POST') {
    const body = await leerBody(req);
    if (body.conv) convs.delete(String(body.conv));
    else convs.clear();
    offsetMs = 0;
    return json(res, 200, { ok: true, conversaciones: convs.size });
  }

  // POST /test/seed {conv, mensajes:[{rol,texto,hace?}]}
  // Precarga historial sin pasar por el bot. Para montar el estado de un test
  // (24 respuestas previas para probar el cap) sin gastar 24 turnos de LLM.
  if (ruta === '/test/seed' && req.method === 'POST') {
    const body = await leerBody(req);
    const conv = getConv(String(body.conv || 'c1'));
    for (const m of body.mensajes || []) {
      nuevoMensaje(conv, {
        content: m.texto,
        tipo: m.rol === 'bot' ? 'outgoing' : 'incoming',
        private: m.private === true,
        // `hace` en ms hacia atras: permite sembrar mensajes viejos y cruzar
        // el borde de las 24h del cap.
        createdAt: ahora() - Number(m.hace || 0),
      });
    }
    return json(res, 200, { ok: true, total: conv.mensajes.length });
  }

  // POST /test/clock {avanzarMs} -> mueve el reloj del mock
  if (ruta === '/test/clock' && req.method === 'POST') {
    const body = await leerBody(req);
    offsetMs += Number(body.avanzarMs || 0);
    return json(res, 200, { offsetMs });
  }

  if (ruta === '/test/health') return json(res, 200, { ok: true, conversaciones: convs.size });

  json(res, 404, { error: 'sin ruta', ruta, metodo: req.method });
});

server.listen(PORT, () => {
  console.log(`chatwoot-mock escuchando en http://localhost:${PORT}`);
  console.log(`  webhook n8n -> ${N8N_WEBHOOK}`);
  console.log(`  secreto HMAC -> ${SECRET === 'test-secret' ? 'test-secret (default)' : '(de env)'}`);
  console.log(`  x-test-key   -> ${TEST_KEY ? 'exigida' : 'NO exigida (solo local)'}`);
});
