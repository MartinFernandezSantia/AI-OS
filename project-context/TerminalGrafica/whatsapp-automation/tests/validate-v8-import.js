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
if (v7.nodes.length !== v8.nodes.length) E('cambio la cantidad de nodos');
const n7 = v7.nodes.map((n) => n.name).sort(), n8 = v8.nodes.map((n) => n.name).sort();
if (JSON.stringify(n7) !== JSON.stringify(n8)) E('cambiaron los nombres de nodos');
if (JSON.stringify(v7.connections) !== JSON.stringify(v8.connections)) E('cambiaron las conexiones');
console.log('  conexiones identicas: ' + (JSON.stringify(v7.connections) === JSON.stringify(v8.connections)));

console.log('\n=== 2. CREDENCIALES ===');
const creds = (wf) => wf.nodes.filter((n) => n.credentials).map((n) => n.name + ':' + JSON.stringify(n.credentials)).sort();
const c7 = creds(v7), c8 = creds(v8);
console.log('  nodos con credencial: v7=' + c7.length + ' v8=' + c8.length);
if (JSON.stringify(c7) !== JSON.stringify(c8)) E('cambiaron las credenciales');

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
  'Llamar LLM Respuesta', 'Llamar LLM Nota', 'Llamar LLM Aclarador', 'Log Precio', 'Log Respuesta', 'Log Escalación']);
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

const gp = b['Get Precio'].parameters.query;
if (!gp.includes('v.atributos')) E('Get Precio no expone atributos');
else console.log('  ok  Get Precio expone atributos y familias');
if (!/var_rank = \(select min/.test(gp)) E('Get Precio: falta el filtro de var_rank minimo (el match por atributo dejaria de ser aditivo)');
else console.log('  ok  match por atributo es estrictamente aditivo');

console.log('\n=== ' + err + ' errores ===');
process.exit(err ? 1 : 0);
