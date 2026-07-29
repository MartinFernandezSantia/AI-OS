// Validacion de import-safety: v8 tiene que ser el MISMO grafo que v7 (mismos
// nodos, mismas conexiones, mismas credenciales) y diferir SOLO en los nodos que
// se tocaron a proposito. Ademas verifica que ningun guard de plata se haya caido
// en la edicion. Correr junto con code-harness.js antes de cualquier import.
//   node tests/validate-v8-import.js
// (BASE / WF para comparar otras versiones.)
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const DIR = path.join(__dirname, '..', 'n8n', 'flows');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const v7 = load(process.env.BASE || 'faq-bot-v7.json'), v8 = load(process.env.WF || 'faq-bot-v8.json');
let err = 0; const E = (m) => { err++; console.log('  ERROR  ' + m); };

console.log('=== 1. GRAFO ===');
console.log('  nodos v7=' + v7.nodes.length + '  v8=' + v8.nodes.length);
// v8.2: cae la ruta handoff a un humano (decision Martin, ronda del 27). TG no
// tiene a nadie mirando Chatwoot, y `Asignar a Humano` ademas dejaba al bot MUDO
// para siempre en esa conversacion (Filtro Ingreso exige !meta.assignee).
const SIN_HANDOFF = ['Asignar a Humano', 'Armar Nota Agente', 'Llamar LLM Nota', 'Nota Privada Agente'];
// v8.3: los 6 nodos del pipeline de búsqueda por palabra. Se declaran acá para que
// el conteo siga siendo una aserción exacta y no un ">=": si mañana aparece un nodo
// que nadie declaró, el validador tiene que gritar igual que antes.
const NUEVOS_V83 = ['Extraer Palabras', 'Buscar Candidatos', 'Armar Prompt Filtro',
  '¿Filtrar?', 'Llamar LLM Filtro', 'Aplicar Filtro'];
// v9: los 5 del verificador de silencio (2ª opinión sobre un noop del LLM principal).
const NUEVOS_V9 = ['Armar Prompt Verificador', '¿Verificar Silencio?',
  'Llamar LLM Verificador', 'Aplicar Verificador', '¿Rescatar Turno?'];
const esV9 = v8.nodes.some((n) => n.name === 'Aplicar Filtro');
const conVerif = v8.nodes.some((n) => n.name === 'Aplicar Verificador');
const nEsperados = v7.nodes.length - SIN_HANDOFF.length + 1
  + (esV9 ? NUEVOS_V83.length : 0) + (conVerif ? NUEVOS_V9.length : 0);
if (nEsperados !== v8.nodes.length) {
  E('cambio la cantidad de nodos: esperaba ' + nEsperados + ' y hay ' + v8.nodes.length
    + ' (68 - 4 de handoff + 1 de Log Silencio' + (esV9 ? ' + ' + NUEVOS_V83.length + ' de v8.3' : '')
    + (conVerif ? ' + ' + NUEVOS_V9.length + ' del verificador' : '') + ')');
}
if (esV9) NUEVOS_V83.forEach((n) => { if (!v8.nodes.some((x) => x.name === n)) E('falta el nodo de v8.3 "' + n + '"'); });
SIN_HANDOFF.forEach((n) => { if (v8.nodes.some((x) => x.name === n)) E('volvio el nodo de handoff "' + n + '"'); });
// y la escalacion tiene que seguir dejando su fila con el motivo
if (!v8.nodes.some((n) => n.name === 'Log Escalación')) E('se perdio Log Escalación (ahi vive `motivo`)');
const n7 = new Set(v7.nodes.map((n) => n.name)), n8 = new Set(v8.nodes.map((n) => n.name));
const soloV7 = [...n7].filter((x) => !n8.has(x)), soloV8 = [...n8].filter((x) => !n7.has(x));
console.log('  solo en v7 (borrados/renombrados): ' + soloV7.join(', '));
console.log('  solo en v8 (nuevos/renombrados):   ' + soloV8.join(', '));
// conexiones: no pueden quedar referencias a nodos inexistentes
const nombres = new Set(v8.nodes.map((n) => n.name));
Object.entries(v8.connections).forEach(([k, v]) => {
  if (!nombres.has(k)) E('conexion desde nodo inexistente: ' + k);
  (v.main || []).forEach((b) => (b || []).forEach((x) => { if (!nombres.has(x.node)) E('conexion ' + k + ' -> ' + x.node + ' (inexistente)'); }));
});
// una sola rama de envio y una sola de log
const envios = v8.nodes.filter((n) => /^Enviar /.test(n.name) && n.type === 'n8n-nodes-base.httpRequest' && /messages/.test(JSON.stringify(n.parameters)) && !/private: true/.test(JSON.stringify(n.parameters)));
console.log('  nodos de envio al cliente: ' + envios.map((n) => n.name).join(', '));
// UN solo log del turno saliente. Se excluyen a proposito: `Log Escalación` (otra
// rama, siempre fue separada) y `Get Ruta Cotizador` (LEE decisiones, no escribe).
const logsTurno = v8.nodes.filter((n) => n.type === 'n8n-nodes-base.postgres'
  && /decisiones/.test(JSON.stringify(n.parameters)) && /^Log /.test(n.name) && n.name !== 'Log Escalación' && n.name !== 'Log Silencio');
console.log('  logs del turno saliente: ' + logsTurno.map((n) => n.name).join(', '));
if (logsTurno.length !== 1) E('deberia haber UN solo log de turno, hay ' + logsTurno.length);
['Log Precio', 'Log Menu', 'Log Respuesta', 'Enviar Precio', 'Enviar Menu', 'Enviar Respuesta', 'Pre-Envío Precio']
  .forEach((n) => { if (nombres.has(n)) E('quedo un nodo de la topologia vieja: ' + n); });

console.log('\n=== 2. CREDENCIALES ===');
const creds = (wf) => wf.nodes.filter((n) => n.credentials).map((n) => n.name + ':' + JSON.stringify(n.credentials)).sort();
const c7 = creds(v7), c8 = creds(v8);
console.log('  nodos con credencial: v7=' + c7.length + ' v8=' + c8.length + ' (v8 suma el LLM Compositor y pierde 2 envios)');
const sinCred = v8.nodes.filter((n) => /^(Enviar|Llamar|Log|Asignar|Label|Mensaje|Nota|Saludo|Aviso|Respuesta No|Get |Firewall|Strike|Silencio)/.test(n.name)
  && ['n8n-nodes-base.httpRequest', 'n8n-nodes-base.postgres'].includes(n.type) && !n.credentials);
if (sinCred.length) E('nodos sin credencial: ' + sinCred.map((n) => n.name).join(', '));

console.log('\n=== 3. SINTAXIS DE LOS NODOS CODE ===');
let nCode = 0;
v8.nodes.filter((n) => n.type === 'n8n-nodes-base.code').forEach((n) => {
  nCode++;
  const f = path.join(require('os').tmpdir(), '_chk-v8.js');
  fs.writeFileSync(f, 'async function _(){\n' + n.parameters.jsCode + '\n}');
  try { cp.execSync('node --check ' + f, { stdio: 'pipe' }); }
  catch (e) { E('sintaxis en "' + n.name + '": ' + String(e.stderr || e).split('\n').slice(0, 3).join(' ')); }
});
console.log('  nodos code validados: ' + nCode);

console.log('\n=== 4. DIFF (nodos que cambiaron) ===');
const esperados = new Set(['Get Precio', 'Get Precio 2', 'Armar Respuesta Precio', 'Armar Respuesta Precio 2',
  'Llamar LLM Respuesta', 'Llamar LLM Nota', 'Llamar LLM Aclarador', 'Log Escalación',
  // topologia unificada + compositor
  'Normalizar Envío', 'Enviar Mensaje', 'Log Turno', 'Armar Prompt Compositor', '¿Componer?',
  'Llamar LLM Compositor', 'Aplicar Compositor', 'Armar Menu Opciones', 'Aplicar Aclarador', 'Prompt Cotizador',
  // v8.1 — bloqueantes del consejo
  'Get Ruta Cotizador', 'Armar Mensajes LLM', 'Parsear Respuesta',
  // v8.2 — telemetria de los finales mudos
  'Log Silencio', 'Silencio Repetición', 'Descartar (debounce/dup)',
  'Enviar Mensaje', 'Mensaje Firewall Refusal', 'Aviso Rate Firewall', 'Mensaje Refusal Tier-2',
  'Respuesta No-Texto', 'Saludo Bienvenida', 'Mensaje Anti-Injection', 'Mensaje Escalación',
  'Mensaje Cap Email', 'Label Escalación', 'Label Cap',
  // v8.1 — señal, conjunto cerrado y housekeeping
  'Decidir', 'Log Turno',
  // v8.3 — búsqueda por palabra + filtro. Los 6 nodos nuevos, más los 3 que se
  // tocan para intercalarlos: Switch Acción (la rama precio ya no va directo a
  // Get Precio) y los dos ARP (hayCompetencia pre-filtro + fallback de nombre).
  ...NUEVOS_V83, 'Switch Acción',
  // v8.3b (auditoría 2026-07-28) — el Aclarador leía el catálogo de 'Guardar Cache
  // Catálogo', que sólo corre en cache MISS: con el TTL de 10 min el caso normal es
  // HIT, $() tiraba y su catch dejaba la lista VACÍA, así que decidía 'nada' → mail
  // teniendo el producto. Pasa a una cascada que arranca por 'Armar Mensajes LLM',
  // que corre siempre y ahora republica `_catalogo`.
  'Armar Prompt Aclarador',
  // v9 — verificador de silencio (decisión Martin 2026-07-28). Los 5 nodos nuevos.
  // 'Switch Acción' ya está arriba (la rama noop ahora entra al verificador) y
  // 'Armar Mensajes LLM' también (republica el flag de la cota anti-ciclo).
  ...NUEVOS_V9,
  // v9 (2026-07-28) — modelo primario a gemini-3.1-flash-lite en los 6 nodos LLM, y
  // las 2 credenciales de OpenRouter a los ids nuevos. 'OpenRouter Chat Model' (el
  // guard Tier-2) es el único que no aparecía ya en esta lista: cambia por las dos
  // cosas a la vez (su modelo vive en parameters.model, no en un jsonBody).
  'OpenRouter Chat Model',
  // v9.2 (2026-07-28) — el menú dice precios: `Get Opciones` suma `v.atributos`
  // (de ahí sale la unidad de venta) y `v.solo_descuentos` al select. Sin la
  // unidad, un precio por m² se imprimiría igual que uno por unidad.
  'Get Opciones']);
const borrados = new Set(['Pre-Envío Precio', 'Enviar Precio', 'Log Precio', 'Enviar Menu', 'Enviar Respuesta', 'Log Menu', 'Log Respuesta']);
const byName = (wf) => Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
const a = byName(v7), b = byName(v8);
const cambiados = [];
Object.keys(b).forEach((k) => { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) cambiados.push(k); });
cambiados.forEach((k) => console.log('  ' + (esperados.has(k) ? 'ok  ' : 'OJO ') + k));
cambiados.filter((k) => !esperados.has(k)).forEach((k) => E('nodo cambiado NO previsto: ' + k));
console.log('  total cambiados: ' + cambiados.length);

console.log('\n=== 5. INVARIANTES DE SEGURIDAD ===');
const arp = b['Armar Respuesta Precio'].parameters.jsCode;
[['el LLM nunca tipea montos (plantilla forzada sigue)', /forzarPlantilla/],
 ['guard de dorso vivo', /fallback: dorso/],
 ['guard de numerales vivo', /producto_incoherente/],
 ['guard de papel especial vivo', /papel_especial/],
 ['guard de faz inversa vivo', /faz_incoherente/],
 ['guard de nicho vivo', /producto_nicho/],
 ['cap de volumen vivo', /capGate/],
 ['v8: doble faz por hoja', /hojasPorCopia/],
 ['v8: unidad de venta curada', /noMultiplica/],
 ['v8: minimo de unidades', /bajoMinimo/],
 ['v8: regla de gemelos', /ejeDiscriminante/]].forEach(([t, re]) => {
  if (!re.test(arp)) E('falta: ' + t); else console.log('  ok  ' + t);
});

const comp = b['Aplicar Compositor'].parameters.jsCode;
[['compositor: fail-safe al borrador', /salir\(borrador,/],
 ['compositor: tokens en orden', /tokens'\)/],
 ['compositor: prohibe $ y @ propios', /plata_o_mail/],
 // v8.3b: las reglas de conservación OBSERVAN en vez de rechazar (Martin,
 // 2026-07-28), así que la marca ya no es `salir(borrador,'digitos')` sino la
 // observación. Lo que el validador protege sigue siendo lo mismo: que la
 // DETECCIÓN exista — es la que alimenta la auditoría semanal.
 ['compositor: detecta cambio de digitos', /habria_digitos|digitos'\)/],
 ['compositor: lexico de riesgo', /lexico_riesgo/],
 ['compositor: estampa desde el mapa', /j\.mapa/],
 ['compositor: kill-switch', /saltar/]].forEach(([t, re]) => {
  if (!re.test(comp)) E('falta: ' + t); else console.log('  ok  ' + t);
});
if (!/const COMPOSITOR = true;/.test(b['Armar Prompt Compositor'].parameters.jsCode)) E('falta el kill-switch COMPOSITOR');
else console.log('  ok  kill-switch COMPOSITOR editable desde la UI');
if (/\d+ \+ '\. '/.test(b['Armar Menu Opciones'].parameters.jsCode)) E('quedo numeracion en el menu');
else console.log('  ok  sin menu numerado');

// v9.2: estos tres chequeos apuntaban a `Get Precio` cuando ese nodo era el
// resolvedor POR NOMBRE de la 1a pasada. Ya no lo es: v8.3b lo dejó huérfano
// (Buscar Candidatos absorbió su trabajo) y el bloque 12 lo reusó para resolver el
// HERMANO de una promo POR UUID. El que sigue resolviendo por nombre es `Get Precio
// 2` (la 2a pasada del Aclarador), y es ahí donde estas garantías tienen sentido.
const gp = b['Get Precio 2'].parameters.query;
if (!gp.includes('v.atributos')) E('Get Precio 2 no expone atributos');
else console.log('  ok  Get Precio 2 expone atributos y familias');
if (!/var_rank = \(select min/.test(gp)) E('Get Precio 2: falta el filtro de var_rank minimo (el match por atributo dejaria de ser aditivo)');
else console.log('  ok  match por atributo es estrictamente aditivo');

// Y el rol NUEVO de `Get Precio`: resolver el hermano por uuid. Si alguien lo
// vuelve a cablear a una resolución por nombre, el borrador de bajo_minimo
// cotizaría un producto que nadie pidió.
{
  const gp1 = b['Get Precio'].parameters.query;
  if (!/producto_id = \$1::uuid/.test(gp1) || !/variante_id = \$2::uuid/.test(gp1)) {
    E('Get Precio dejo de resolver el hermano por uuid (bloque 12a)');
  } else console.log('  ok  Get Precio resuelve el hermano por uuid');
  const cn = v8.connections['Get Precio'];
  if (!cn || !cn.main || !cn.main[0] || cn.main[0][0].node !== 'Armar Respuesta Precio') {
    E('Get Precio no alimenta a Armar Respuesta Precio (bloque 12d)');
  } else console.log('  ok  Get Precio -> Armar Respuesta Precio');
}

console.log('\n=== 6. v8.1 — BLOQUEANTES DEL CONSEJO ===');

// 6a. settings: el validador no miraba esta seccion. Sin executionOrder v1, n8n
// aplica el orden legacy al importar y el workflow se comporta distinto que en tus
// pruebas. El errorWorkflow se engancha desde la UI (el id depende de la instancia).
if (!v8.settings || v8.settings.executionOrder !== 'v1') E('falta wf.settings.executionOrder = "v1"');
else console.log('  ok  executionOrder v1');

// 6b. los nodos que MANDAN mensajes al cliente no pueden reintentar: Chatwoot esta
// detras de un tunel y un 504 post-aceptacion cobra el mensaje de nuevo.
['Enviar Mensaje', 'Mensaje Firewall Refusal', 'Aviso Rate Firewall', 'Mensaje Refusal Tier-2'].forEach((nm) => {
  const nd = b[nm];
  if (!nd) return E('falta el nodo ' + nm);
  if (nd.retryOnFail) E(nm + ' reintenta un envio al cliente (cobra el mensaje dos o tres veces)');
  if (nd.onError !== 'continueRegularOutput') E(nm + ' sin onError: un blip deja la ejecucion en rojo y el retry REENVIA');
});
console.log('  ok  envios al cliente sin retry y con onError');

// 6c. ningun nodo Code puede volver a COMPARAR el anti-loop contra lastBotReplies:
// desde el compositor ese texto esta parafraseado y el guard queda muerto.
//
// v9: la regla apunta a COMPARACIONES, no a lecturas. 'Armar Prompt Verificador' lee
// lastBotReplies a proposito — le muestra al verificador lo que el cliente
// EFECTIVAMENTE vio, y ahi el parafraseo del compositor es lo correcto
// (borradoresPrevios es texto que el cliente nunca leyo). No compara nada: se lo pasa
// a un LLM. La deteccion sigue siendo la misma: normRep/filter/=== sobre esa lista.
const COMPARA = /lastBotReplies[\s\S]{0,200}?(normRep|\.filter\s*\(|===|\.includes\s*\()/;
v8.nodes.filter((nd) => nd.type === 'n8n-nodes-base.code').forEach((nd) => {
  const js = nd.parameters.jsCode || '';
  if (nd.name === 'Decidir' || nd.name === 'Armar Mensajes LLM') return; // lo producen / lo pasan al LLM
  if (!/lastBotReplies/.test(js)) return;
  if (/^\s*\/\//m.test(js.split('lastBotReplies')[0].split('\n').pop())) return; // mencion en comentario
  if (COMPARA.test(js))
    E(nd.name + ' compara contra lastBotReplies (texto compuesto): el anti-loop queda muerto');
});
const guards = ['Parsear Respuesta', 'Armar Respuesta Precio', 'Armar Menu Opciones', 'Aplicar Aclarador'];
guards.forEach((nm) => {
  if (!/borradoresPrevios/.test(b[nm].parameters.jsCode)) E(nm + ': el anti-loop no usa borradoresPrevios');
});
console.log('  ok  los 4 anti-loops comparan contra el borrador previo');
if (!/borrador/.test(b['Get Ruta Cotizador'].parameters.query) || !/limit 3/.test(b['Get Ruta Cotizador'].parameters.query))
  E('Get Ruta Cotizador no trae los 3 borradores previos');
else console.log('  ok  Get Ruta Cotizador trae los 3 borradores');

// 6d. el gate del compositor protege el NOMBRE y el HEDGE, no solo la plata.
const comp2 = b['Aplicar Compositor'].parameters.jsCode;
if (!/nombre_ajeno/.test(comp2)) E('el gate no protege el nombre del producto');
else console.log('  ok  gate: conservacion de nombre');
// v8.3b: hedge y unidad se DETECTAN pero ya no bloquean. La regla verifica que la
// detección siga viva (es lo que alimenta la auditoría), no que rechace.
if (!/habria_hedge|'hedge'/.test(comp2)) E('el gate no detecta el hedge (precio de lista / lo confirma el equipo)');
else console.log('  ok  gate: detecta pérdida de hedge');
if (!/unidad:/.test(comp2)) E('el gate no detecta el cambio de UNIDAD (c/u -> por pagina es una mentira de 2x)');
else console.log('  ok  gate: detecta cambio de unidad');
// Lo único que TIENE que seguir bloqueando: un token sin estampar saldría literal.
if (!/token_residual/.test(comp2)) E('el estampado no verifica tokens residuales: podría salir "[[P1]]" al cliente');
else console.log('  ok  estampado: token residual sigue bloqueando');
if (/precio de lista; el precio final/.test(b['Armar Respuesta Precio'].parameters.jsCode)) E('quedo la leyenda vieja inline');
else console.log('  ok  sin la leyenda vieja');
if (!/UNIDAD_FRASE/.test(b['Armar Respuesta Precio'].parameters.jsCode)) E('el borrador no dice la unidad de venta');
else console.log('  ok  el borrador dice la unidad');
if (!/prohibidos/.test(b['Armar Prompt Compositor'].parameters.jsCode)) E('Armar Prompt Compositor no calcula los tokens prohibidos');
else console.log('  ok  tokens prohibidos derivados del catalogo');

// 6e. sin catalogo el turno se aborta: contestar sin mundo cerrado es peor que callarse.
if (!/catalogo no disponible/.test(b['Armar Mensajes LLM'].parameters.jsCode) || !/throw new Error/.test(b['Armar Mensajes LLM'].parameters.jsCode))
  E('Armar Mensajes LLM no aborta cuando el catalogo no cargo');
else console.log('  ok  SPOF del catalogo: aborta en vez de improvisar');

console.log('\n=== 7. v8.1 — SEÑAL, CONJUNTO CERRADO, MATCHING ===');

// 7a. el rank-2 no puede volver a ser substring crudo: producto='lona' matcheaba
// 'ta<lona>rios rifas'. Ancla a inicio de palabra, sin ancla al final (plural).
// v9.2: sale `Get Precio` de la lista — desde el bloque 12a no resuelve por nombre
// sino por uuid, así que no tiene rank ni tokenización que proteger. `Get Precio 2`
// sí, y es el que queda.
['Get Precio 2'].forEach((nm) => {
  const q = b[nm].parameters.query;
  if (/like '%' \|\| replace\(replace\(p\.prod/.test(q)) E(nm + ': el rank-2 sigue siendo substring crudo (lona ⊂ talonarios)');
  else if (!/prod_tok/.test(q)) E(nm + ': falta la tokenizacion del rank-2');
});
console.log('  ok  rank-2 anclado a inicio de palabra');

// 7b. la señal del confident-wrong. Sin esto nada de lo demas es medible: el log
// guardaba el nombre CANONICO y el string crudo del LLM se destruia.
const arp2 = b['Armar Respuesta Precio'].parameters.jsCode;
[['señal: producto crudo del LLM', /producto_pedido/],
 ['señal: candidatos descartados por rank', /descartados/],
 ['señal: ejes anclados por el cliente', /dijoValor/],
 ['guard de ancla / puerta abierta', /PUERTA/]].forEach(([t, re]) => {
  if (!re.test(arp2)) E('falta: ' + t); else console.log('  ok  ' + t);
});
if (!/senales/.test(JSON.stringify(b['Log Turno'].parameters))) E('Log Turno no guarda las señales');
else console.log('  ok  Log Turno guarda senales');
if (!/senales/.test(b['Normalizar Envío'].parameters.jsCode)) E('el sobre no lleva las señales hasta el log');
else console.log('  ok  el sobre lleva las señales');

// 7b-bis. LAS COLUMNAS DE Log Turno APUNTAN A CAMPOS QUE EL SOBRE EMITE.
// El bug (2026-07-28): la columna `accion` mapeaba `.accionLog`, un nombre que solo
// existe DENTRO de la rama precio — `Normalizar Envío` lo colapsa a `accion`. La
// columna es NOT NULL, asi que el INSERT rebotaba, y con onError:continueRegularOutput
// fallaba EN SILENCIO: cero filas de la rama normal, ninguna alarma. Sin fila no hay
// `senales`, sin `senales` no viaja la pregunta pendiente, y el bot repregunta lo que
// el cliente ya contesto. Un bug de UNA palabra que apagaba la memoria del bot.
//
// El harness no podia cazarlo: testea nodos Code sueltos, y esto es la COSTURA entre
// el sobre y el mapeo declarativo del nodo Postgres. Se chequea aca, contra el JSON.
{
  const cols = b['Log Turno'].parameters.columns.value;
  const norm = b['Normalizar Envío'].parameters.jsCode;
  // Los campos que Normalizar Envío realmente pone en el sobre, mas los que agregan
  // los dos nodos del compositor rio abajo (ambos hacen Object.assign sobre el sobre).
  const DEL_COMPOSITOR = ['borrador', 'final', 'notas'];
  const refs = Object.entries(cols)
    .map(([col, v]) => [col, String(v).match(/\.first\(\)\.json\.(\w+)/g) || []])
    .filter(([, ms]) => ms.length);
  for (const [col, ms] of refs) {
    for (const m of ms) {
      const campo = m.replace(/^.*\.json\./, '');
      if (DEL_COMPOSITOR.includes(campo)) continue;
      // El sobre lo emite si Normalizar Envío lo nombra como clave del return.
      const emitido = new RegExp('(^|[\\s,{])' + campo + '\\s*[,:]', 'm').test(norm);
      if (!emitido) E('Log Turno.' + col + ' lee `' + campo + '`, que el sobre de Normalizar Envío NO emite (columna quedaria null)');
    }
  }
  if (!/(^|[\s,{])accion\s*[,:]/m.test(norm)) E('Normalizar Envío dejo de emitir `accion`');
  if (!/\.json\.accion\s/.test(String(cols.accion))) E('Log Turno.accion no lee `accion` del sobre (el bug del 28: leia accionLog)');
  else console.log('  ok  las columnas de Log Turno existen en el sobre');
}

// 7b-ter. EL ENUM. `bot.decisiones.accion` acepta 5 valores y nada mas. Escribir
// otro hace rebotar el INSERT ENTERO — y con onError:continueRegularOutput, en
// silencio: cero filas, sin memoria entre turnos, sin telemetria. Paso desde v7
// hasta el 2026-07-28 tapado por el bug de la columna nula.
// `noop` va aparte: no tiene equivalente entre los 5 (callarse no es informar, ni
// preguntar, ni escalar) y se agrega al enum por ALTER. Los `firewall_*` los
// escribe bot.fw_log() del lado SQL, no el workflow.
{
  const ENUM = ['informo_precio', 'informo_capacidad', 'repregunto', 'handoff', 'fallback_error', 'noop'];
  const PRODUCTORES = ['Armar Respuesta Precio', 'Armar Respuesta Precio 2', 'Aplicar Aclarador', 'Normalizar Envío'];
  // Los strings que se asignan a accionLog/accion, o el ternario de Normalizar.
  const RE = /(?:accionLog|accion)\s*[:=]\s*'([a-z_]+)'|\?\s*'([a-z_]+)'\s*:\s*'([a-z_]+)'/g;
  const fuera = new Set();
  for (const nombre of PRODUCTORES) {
    if (!b[nombre]) continue;
    const js = b[nombre].parameters.jsCode || '';
    let m;
    while ((m = RE.exec(js))) {
      for (const v of [m[1], m[2], m[3]]) {
        // El ternario tambien matchea strings que no son acciones (frases sueltas).
        // Solo interesan los que PARECEN una accion: sin espacios y ya conocidos, o
        // asignados explicitamente a accionLog/accion (grupo 1).
        if (!v) continue;
        if (m[1] === v) { if (!ENUM.includes(v)) fuera.add(nombre + ':' + v); }
        else if (/^(pregunto_opciones|cotizador_answer|informo_\w+|repregunto|handoff|noop|fallback_\w+)$/.test(v)
          && !ENUM.includes(v)) fuera.add(nombre + ':' + v);
      }
    }
  }
  // Y los literales de los tres nodos Postgres que escriben la tabla.
  for (const nombre of ['Log Turno', 'Log Escalación', 'Log Silencio']) {
    if (!b[nombre]) continue;
    const v = b[nombre].parameters.columns && b[nombre].parameters.columns.value;
    const a = v && v.accion;
    if (typeof a === 'string' && !a.startsWith('=') && !ENUM.includes(a)) fuera.add(nombre + ':' + a);
  }
  if (fuera.size) E('valores fuera del enum bot.accion -> el INSERT rebota en silencio: ' + [...fuera].join(', '));
  else console.log('  ok  todos los valores de `accion` existen en el enum');
}

// 7c. conjunto cerrado (E): el nombre que emite el LLM se valida contra el catalogo,
// y el Aclarador ya no puede imprimirle al cliente un nombre que no existe.
if (!/producto_inventado/.test(b['Parsear Respuesta'].parameters.jsCode)) E('Parsear Respuesta no valida contra el conjunto cerrado');
else console.log('  ok  validacion de conjunto cerrado');
if (!/setAcl/.test(b['Aplicar Aclarador'].parameters.jsCode)) E('Aplicar Aclarador imprime nombres sin validar contra el catalogo');
else console.log('  ok  el Aclarador filtra contra el catalogo');

// 7d. el endpoint pineado: 5 endpoints diluyen el cache de prefijo, que es donde
// vive el catalogo (~5k tokens a 0,1x).
const llms = v8.nodes.filter((nd) => nd.type === 'n8n-nodes-base.httpRequest' && /openrouter/i.test(JSON.stringify(nd.parameters)));
const sinPin = llms.filter((nd) => !/provider: \{ order:/.test(nd.parameters.jsonBody || ''));
if (sinPin.length) E('nodos LLM sin endpoint pineado: ' + sinPin.map((x) => x.name).join(', '));
else console.log('  ok  los ' + llms.length + ' nodos LLM pinean el endpoint');

// 7e. MODELO PRIMARIO (v9, 2026-07-28). gemini-2.5-flash-lite se apaga el 16-oct-2026:
// un nodo nuevo que nazca con el modelo viejo pegado del hermano de al lado funciona
// hoy y falla ese dia, en produccion y sin aviso. Se congela acá.
// El fallback SÍ puede seguir en 2.5 mientras viva — es la lista de reintento de
// OpenRouter, no el modelo que se usa.
// Sólo aplica a v9: v8 es el ROLLBACK y se queda congelado como está — retocarlo
// para pasar una validación anularía justamente lo que lo hace un rollback.
const MODELO = 'google/gemini-3.1-flash-lite';
const VIEJO_OFF = 'google/gemini-2.5-flash-lite';
const modelosMal = [];
if (conVerif) v8.nodes.forEach((nd) => {
  const p = nd.parameters || {};
  const m = typeof p.jsonBody === 'string' ? (p.jsonBody.match(/model: '([^']+)'/) || [])[1] : p.model;
  if (!m) return;
  if (!/gemini|gpt|claude|llama|qwen|deepseek/i.test(m)) return; // no es un nodo LLM
  if (m !== MODELO) modelosMal.push(nd.name + ' -> ' + m);
});
if (modelosMal.length) E('nodos con el modelo primario viejo (' + VIEJO_OFF + ' muere el 16-oct-2026): ' + modelosMal.join(', '));
else if (conVerif) console.log('  ok  todos los nodos LLM corren ' + MODELO);
else console.log('  ok  (rollback: el modelo no se valida, v8 queda congelado)');
if (!/normalize\('NFC'\)/.test(b['Decidir'].parameters.jsCode)) E('el mensaje del cliente no se normaliza a NFC');
else console.log('  ok  mensaje del cliente en NFC');

console.log('\n=== ' + err + ' errores ===');
process.exit(err ? 1 : 0);
