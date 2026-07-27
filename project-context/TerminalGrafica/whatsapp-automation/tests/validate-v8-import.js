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
if (v7.nodes.length !== v8.nodes.length) E('cambio la cantidad de nodos (68 - 4 borrados + 4 nuevos = 68)');
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
  && /decisiones/.test(JSON.stringify(n.parameters)) && /^Log /.test(n.name) && n.name !== 'Log Escalación');
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
  'Enviar Mensaje', 'Mensaje Firewall Refusal', 'Aviso Rate Firewall', 'Mensaje Refusal Tier-2',
  'Respuesta No-Texto', 'Saludo Bienvenida', 'Mensaje Anti-Injection', 'Mensaje Escalación',
  'Mensaje Cap Email', 'Label Escalación', 'Label Cap',
  // v8.1 — señal, conjunto cerrado y housekeeping
  'Decidir', 'Log Turno']);
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
 ['compositor: multiset de digitos', /digitos'\)/],
 ['compositor: lexico de riesgo', /lexico_riesgo/],
 ['compositor: estampa desde el mapa', /j\.mapa/],
 ['compositor: kill-switch', /saltar/]].forEach(([t, re]) => {
  if (!re.test(comp)) E('falta: ' + t); else console.log('  ok  ' + t);
});
if (!/const COMPOSITOR = true;/.test(b['Armar Prompt Compositor'].parameters.jsCode)) E('falta el kill-switch COMPOSITOR');
else console.log('  ok  kill-switch COMPOSITOR editable desde la UI');
if (/\d+ \+ '\. '/.test(b['Armar Menu Opciones'].parameters.jsCode)) E('quedo numeracion en el menu');
else console.log('  ok  sin menu numerado');

const gp = b['Get Precio'].parameters.query;
if (!gp.includes('v.atributos')) E('Get Precio no expone atributos');
else console.log('  ok  Get Precio expone atributos y familias');
if (!/var_rank = \(select min/.test(gp)) E('Get Precio: falta el filtro de var_rank minimo (el match por atributo dejaria de ser aditivo)');
else console.log('  ok  match por atributo es estrictamente aditivo');

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

// 6c. ningun nodo Code puede volver a comparar el anti-loop contra lastBotReplies:
// desde el compositor ese texto esta parafraseado y el guard queda muerto.
v8.nodes.filter((nd) => nd.type === 'n8n-nodes-base.code').forEach((nd) => {
  const js = nd.parameters.jsCode || '';
  if (nd.name === 'Decidir' || nd.name === 'Armar Mensajes LLM') return; // lo producen / lo pasan al LLM
  if (/lastBotReplies/.test(js) && !/^\s*\/\//m.test(js.split('lastBotReplies')[0].split('\n').pop()))
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
if (!/'hedge'/.test(comp2)) E('el gate no protege el hedge (precio de lista / lo confirma el equipo)');
else console.log('  ok  gate: conservacion de hedge');
if (!/unidad:/.test(comp2)) E('el gate no protege la UNIDAD (c/u -> por pagina es una mentira de 2x)');
else console.log('  ok  gate: conservacion de unidad');
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
['Get Precio', 'Get Precio 2'].forEach((nm) => {
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
if (!/normalize\('NFC'\)/.test(b['Decidir'].parameters.jsCode)) E('el mensaje del cliente no se normaliza a NFC');
else console.log('  ok  mensaje del cliente en NFC');

console.log('\n=== ' + err + ' errores ===');
process.exit(err ? 1 : 0);
