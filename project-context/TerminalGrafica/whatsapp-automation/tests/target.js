// TARGET — convierte un workflow ya construido en su variante de PROD o de TEST.
//
// El unico delta entre las dos variantes es a donde apunta: que host de Chatwoot,
// que credenciales, que nombre. La LOGICA es identica byte por byte — si no lo fuera,
// el harness estaria testeando otro bot y no serviria para nada.
//
// Por eso esto es un paso del build y no un script aparte que parchea el JSON ya
// escrito: las dos variantes salen del mismo codigo fuente, asi que no pueden
// divergir. Un `sync.js` que reescribe el output es exactamente el drift que
// queremos que sea imposible.
//
// Uso desde build-v9.js:
//   const { aplicarTarget } = require('./target');
//   aplicarTarget(wf, 'test');   // o 'prod'

// ───────────────────────────────────────────────────────────────────────────
// EL MAPA
//
// Los ids de credencial son de la instancia n8n de Martin. Los de test los dio de
// alta el 2026-07-27 para que el harness pegue con una key de OpenRouter separada:
// asi una suite corriendo en loop no puede consumir la cuota de produccion ni
// ensuciar el costo real que se le factura a TG.
// ───────────────────────────────────────────────────────────────────────────
const TARGETS = {
  prod: {
    nombre: 'faq-bot-v9',
    chatwootHost: 'https://chatwoot.silvercoastwebagency.com',
    webhookPath: 'chatwoot',
    refreshPath: 'refrescar-catalogo',
    credenciales: {
      // nombre visible en n8n -> { id, name } que va en el JSON
      'Chatwoot API Token': { id: 'KxbAlYAWQ95ZZKQ5', name: 'Chatwoot API Token' },
      // 2026-07-28 (Martin): las dos credenciales de OpenRouter pasan a estos ids.
      // 'OpenRouter API' es el httpHeaderAuth de los 5 nodos httpRequest; 'OpenRouter'
      // es la api key del nodo langchain del guard Tier-2 (que hasta hoy tenia un id
      // placeholder sin resolver, o sea el guard nunca pudo autenticar en prod).
      //
      // OJO: son los MISMOS ids que figuran abajo como credenciales de test. Eso
      // anula la separacion de cuota que se monto el 2026-07-27 (una suite en loop
      // ahora consume la cuota de produccion y ensucia el costo que se le factura a
      // TG). Se aplica porque Martin lo pidio explicitamente; si la separacion se
      // quiere de vuelta, alcanza con darle a prod ids propios aca.
      'OpenRouter API': { id: 'rwhlhrRvC0TbZZNI', name: 'OpenRouter API' },
      'OpenRouter': { id: 'widAoSc9Weo8PxAN', name: 'OpenRouter' },
    },
  },
  test: {
    nombre: 'faq-bot-v9-test',
    // El mock de Chatwoot. Habla el mismo dialecto de API que el Chatwoot real
    // para los 3 endpoints que el bot usa (GET messages, POST messages, POST labels).
    //
    // El mock corre en la maquina de quien testea, y n8n (que vive en otra maquina)
    // tiene que poder alcanzarlo: se expone con `cloudflared tunnel --url
    // http://localhost:8787`, que da una URL trycloudflare EFIMERA — cambia en cada
    // corrida. Por eso se puede pisar por entorno sin tocar el archivo:
    //   MOCK_HOST=https://xxx.trycloudflare.com node tests/build-v9.js --target test
    // El localhost queda de default para correr todo en una sola maquina.
    chatwootHost: process.env.MOCK_HOST || 'http://localhost:8787',
    webhookPath: 'chatwoot-test',
    refreshPath: 'refrescar-catalogo-test',
    credenciales: {
      // Credencial PROPIA de test, y no la de prod, por una razon que costo una
      // corrida entera: la credencial de prod tiene RESTRICCION DE DOMINIO a
      // chatwoot.silvercoastwebagency.com. n8n rechaza el request ANTES de emitirlo
      // ("Domain not allowed") apenas la URL apunta a otro host, asi que los 12
      // nodos que hablan con el mock fallaban en silencio: Get Historial nunca
      // llegaba y el turno moria sin respuesta ni error visible desde afuera.
      // La restriccion de prod NO se toca: es una defensa real (impide que un bug
      // mande datos de TG a un host ajeno). La de test va sin restriccion, o
      // restringida al host del mock. El token puede ser dummy: el mock no valida.
      'Chatwoot API Token': { id: process.env.MOCK_CRED_ID || 'FALTA_CRED_TEST', name: 'Chatwoot API Token (test)' },
      'OpenRouter API': { id: 'rwhlhrRvC0TbZZNI', name: 'OpenRouter API (test)' },
      'OpenRouter': { id: 'widAoSc9Weo8PxAN', name: 'OpenRouter (test)' },
    },
  },
};

// Las 12 URLs de Chatwoot viven como expresiones n8n con el host literal embebido,
// p.ej.  ={{ 'https://chatwoot.../api/v1/accounts/' + $json.accountId + ... }}
// Se reemplaza el host dejando intacto el resto de la expresion.
const HOST_PROD = 'https://chatwoot.silvercoastwebagency.com';

function aplicarTarget(wf, target) {
  const cfg = TARGETS[target];
  if (!cfg) throw new Error('TARGET: target desconocido "' + target + '" (prod|test)');

  // Sin credencial de test el JSON sale con un id invalido y n8n lo importa igual:
  // el turno recien falla en runtime, en silencio y en el nodo equivocado. Mejor
  // romper aca.
  if (target === 'test' && cfg.credenciales['Chatwoot API Token'].id === 'FALTA_CRED_TEST') {
    throw new Error(
      'TARGET: falta la credencial de Chatwoot para test. Crea en n8n una credencial\n' +
      '  httpHeaderAuth SIN restriccion de dominio (o restringida al host del mock) y corre:\n' +
      '  MOCK_CRED_ID=<id> MOCK_HOST=<url> node tests/build-v9.js --target test\n' +
      '  La credencial de PROD no se toca: su restriccion de dominio es deliberada.'
    );
  }

  const log = [];
  wf.name = cfg.nombre;

  // ── 1. HOST DE CHATWOOT ────────────────────────────────────────────────
  // Toda URL que apunte al Chatwoot de prod se reescribe al host del target.
  let urls = 0;
  for (const n of wf.nodes) {
    const u = n.parameters && n.parameters.url;
    if (typeof u === 'string' && u.includes(HOST_PROD)) {
      n.parameters.url = u.split(HOST_PROD).join(cfg.chatwootHost);
      urls++;
    }
  }
  // Guardia: si el conteo cambia, alguien agrego o saco un nodo que habla con
  // Chatwoot y este modulo no se entero. Preferimos romper el build a generar en
  // silencio una variante de test que le pegue a produccion.
  // 12 = 10 de mensajes + 2 de labels (Escalacion y Cap). Ver `Get Historial`, que
  // es GET y es la unica que LEE.
  const URLS_ESPERADAS = 12;
  if (target !== 'prod' && urls !== URLS_ESPERADAS) {
    throw new Error(
      'TARGET: esperaba ' + URLS_ESPERADAS + ' URLs de Chatwoot, encontre ' + urls +
      '. Si agregaste/sacaste un nodo que habla con Chatwoot, actualiza URLS_ESPERADAS.'
    );
  }
  log.push('host Chatwoot -> ' + cfg.chatwootHost + ' (' + urls + ' URLs)');

  // ── 2. CREDENCIALES ────────────────────────────────────────────────────
  // n8n referencia credenciales por id. Se remapean por el NOMBRE que traen de
  // prod, porque el nombre es lo estable entre variantes.
  const porNombreProd = {};
  for (const [visible, cred] of Object.entries(TARGETS.prod.credenciales)) {
    porNombreProd[cred.name] = visible;
  }

  let creds = 0;
  for (const n of wf.nodes) {
    if (!n.credentials) continue;
    for (const [tipo, cred] of Object.entries(n.credentials)) {
      const visible = porNombreProd[cred.name] || cred.name;
      const destino = cfg.credenciales[visible];
      if (!destino) continue; // p.ej. la de Postgres: es la misma en las dos variantes
      n.credentials[tipo] = { id: destino.id, name: destino.name };
      creds++;
    }
  }
  log.push('credenciales remapeadas -> ' + target + ' (' + creds + ' nodos)');

  // ── 3. PATHS DE WEBHOOK ────────────────────────────────────────────────
  // Las dos variantes conviven en la MISMA instancia de n8n, asi que no pueden
  // compartir path: n8n rechaza el duplicado y, peor, un mensaje real podria caer
  // en el workflow de test.
  for (const n of wf.nodes) {
    if (n.type !== 'n8n-nodes-base.webhook') continue;
    const p = n.parameters.path;
    if (p === TARGETS.prod.webhookPath) n.parameters.path = cfg.webhookPath;
    else if (p === TARGETS.prod.refreshPath) n.parameters.path = cfg.refreshPath;
    else throw new Error('TARGET: webhook con path inesperado "' + p + '"');
    // El webhookId tambien tiene que diferir, o n8n colisiona las dos variantes.
    if (target !== 'prod' && n.webhookId) n.webhookId = n.webhookId.replace(/.$/, 't');
  }
  log.push('webhooks -> /' + cfg.webhookPath + ', /' + cfg.refreshPath);

  return log;
}

module.exports = { aplicarTarget, TARGETS };
