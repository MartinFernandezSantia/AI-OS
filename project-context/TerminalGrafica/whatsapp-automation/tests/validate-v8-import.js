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
  'Llamar LLM Compositor', 'Aplicar Compositor', 'Armar Menu Opciones', 'Aplicar Aclarador', 'Prompt Cotizador']);
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

console.log('\n=== ' + err + ' errores ===');
process.exit(err ? 1 : 0);
