// Validador estructural del SQL de `Buscar Candidatos` (v8.3).
//
// NO reemplaza a Postgres: no hay una instancia disponible en este entorno y el SQL
// lo corre Martin. Lo que SÍ hace es atrapar la clase de bug que apareció en la 1ª
// corrida real (2026-07-27), que fue de estructura y no de lógica:
//
//   1. un CTE referenciándose a SÍ MISMO sin RECURSIVE  -> error de Postgres, y con
//      onError:continueRegularOutput el nodo devuelve el item de error en vez de
//      filas: la búsqueda salía VACÍA sin ninguna señal;
//   2. columnas que no existen en la vista de la que se leen (`oculto` está en
//      bot.producto_meta, NO en bot.variantes);
//   3. leer de bot.variantes sin pasar por bot.taxonomia, que es la vista que ya
//      aplica el filtro de `oculto`.
//
//   node tests/validate-sql-busqueda.js
const fs = require('fs');
const path = require('path');

const WF = path.join(__dirname, '..', 'n8n', 'flows', process.env.WF || 'faq-bot-v9.json');
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
const nodo = wf.nodes.find((n) => n.name === 'Buscar Candidatos');
if (!nodo) { console.log('SKIP: este workflow no tiene Buscar Candidatos (¿v8?)'); process.exit(0); }
const sql = nodo.parameters.query;
// Versión sin comentarios `--`, para los chequeos que buscan CÓDIGO. Sin esto una
// nota explicando por qué NO se filtra por algo cuenta como si se filtrara.
const sqlCodigo = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

let err = 0;
const E = (m) => { err++; console.log('  ERROR  ' + m); };
const ok = (m) => console.log('  ok  ' + m);

// ── 1. CTEs: ninguno puede referenciarse a sí mismo sin RECURSIVE ──────────
// Es EXACTAMENTE el bug de la 1ª corrida. Se parsea el bloque de cada CTE y se
// busca su propio nombre adentro.
console.log('=== 1. CTEs ===');
const esRecursive = /^\s*with\s+recursive/i.test(sqlCodigo);
// nombres de CTE: `nombre as (` al principio de línea o después de una coma
const nombres = [...sqlCodigo.matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gim)].map((m) => m[1]);
if (!nombres.length) E('no se detectó ningún CTE (¿cambió la forma de la query?)');
else ok('CTEs detectados: ' + nombres.join(', '));

// Para cada CTE, aislar su cuerpo balanceando paréntesis y buscar auto-referencia.
for (const n of nombres) {
  const re = new RegExp('(?:^|,)\\s*' + n + '\\s+as\\s*\\(', 'im');
  const m = re.exec(sqlCodigo);
  if (!m) continue;
  let i = m.index + m[0].length, d = 1;
  while (i < sqlCodigo.length && d > 0) {
    const c = sqlCodigo[i];
    if (c === '(') d++;
    else if (c === ')') d--;
    i++;
  }
  const cuerpo = sqlCodigo.slice(m.index + m[0].length, i - 1);
  // ¿el CTE se nombra a sí mismo en un FROM/JOIN de su propio cuerpo?
  const auto = new RegExp('\\b(?:from|join)\\s+' + n + '\\b', 'i').test(cuerpo);
  if (auto && !esRecursive) E('el CTE "' + n + '" se referencia a SÍ MISMO sin RECURSIVE (Postgres lo rechaza; el nodo devolvería el item de error y la búsqueda saldría vacía)');
}
if (!err) ok('ningún CTE se auto-referencia');

// ── 2. Columnas que se leen de cada vista ─────────────────────────────────
// Se declaran las columnas REALES de cada vista (según db/curacion-e0-2026-07-26.sql,
// que es donde se definen) y se verifica que no se lea ninguna otra.
console.log('\n=== 2. COLUMNAS POR VISTA ===');
const COLS = {
  // bot.taxonomia — OJO: no tiene `oculto` (la vista ya lo aplicó en su WHERE) ni
  // precios: es sólo identidad + vocabulario.
  't': ['producto_id', 'nombre_canonico', 'categoria', 'categoria_padre', 'sinonimos', 'casos_de_uso', 'familias', 'atributos'],
  // bot.variantes — acá SÍ están los precios y flags de mecánica de precio.
  'v': ['variante_id', 'producto_id', 'variante', 'variante_origen', 'color', 'unidad',
    'precio_lista', 'precio_actualizado', 'por_pagina', 'por_pack', 'familias', 'atributos',
    'tiene_reglas', 'solo_descuentos', 'tiene_override', 'n_reglas_cantidad',
    'rangos_cantidad', 'mostrable'],
};
const FUENTE = { t: 'bot.taxonomia', v: 'bot.variantes' };
for (const [alias, cols] of Object.entries(COLS)) {
  // ¿se usa este alias en la query?
  const usaAlias = new RegExp('\\b' + FUENTE[alias].replace('.', '\\.') + '\\s+' + alias + '\\b').test(sqlCodigo);
  if (!usaAlias) continue;
  const refs = [...sqlCodigo.matchAll(new RegExp('\\b' + alias + '\\.([a-z_][a-z0-9_]*)', 'g'))].map((m) => m[1]);
  const malas = [...new Set(refs)].filter((c) => !cols.includes(c));
  if (malas.length) E(FUENTE[alias] + ' no tiene la(s) columna(s): ' + malas.join(', '));
  else ok(FUENTE[alias] + ' (' + alias + '): ' + [...new Set(refs)].length + ' columnas, todas existen');
}

// ── 3. Invariantes del diseño ─────────────────────────────────────────────
console.log('\n=== 3. INVARIANTES ===');
const inv = [
  ['parte de bot.taxonomia (la vista que ya filtra `oculto`)', /from\s+bot\.taxonomia/i],
  ['guard de nicho contra la ventana del cliente', /nicho\s*=\s*'medicina'/i],
  ['guard de la promo inmobiliarias', /nicho\s*=\s*'inmobiliarias'/i],
  ['ponderación por rareza (IDF)', /\bln\s*\(/i],
  ['corte relativo al mejor score', /0\.4\s*\*/],
  ['cupo parametrizado', /limit\s+greatest\(coalesce\(\$3/i],
  ['los 3 parámetros se usan', /\$1/],
];
for (const [nombre, re] of inv) {
  if (re.test(sqlCodigo)) ok(nombre); else E('se perdió: ' + nombre);
}
// `solo_descuentos` NO debe filtrar: en la vista real es bool_and(rule_type='discount'),
// o sea "la lista es techo garantizado" — mecánica de precio, NO la política comercial
// "no ofrecer espontáneamente" que el plan §4 le atribuía. Filtrar por él escondería
// productos legítimos (54 de 185 variantes, entre ellas kraft e ilustraciones).
if (/\bsolo_descuentos\b/i.test(sqlCodigo)) {
  E('la búsqueda filtra por solo_descuentos: ese flag es mecánica de precio (bool_and(rule_type=discount)), no la política "no ofrecer espontáneamente"');
} else ok('no filtra por solo_descuentos (es mecánica de precio, no política comercial)');

// ── 4. Paréntesis balanceados ─────────────────────────────────────────────
console.log('\n=== 4. SINTAXIS BÁSICA ===');
let d = 0, str = false;
for (let i = 0; i < sqlCodigo.length; i++) {
  const c = sqlCodigo[i];
  if (c === "'" ) { str = !str; continue; }
  if (str) continue;
  if (c === '(') d++;
  else if (c === ')') d--;
  if (d < 0) { E('paréntesis desbalanceado (cierra de más) cerca del char ' + i); break; }
}
if (d > 0) E('paréntesis desbalanceado: quedan ' + d + ' sin cerrar');
else if (d === 0) ok('paréntesis balanceados');
if (str) E('comilla simple sin cerrar');

console.log('\n=== ' + err + ' errores ===');
console.log('NOTA: esto es validación ESTRUCTURAL. La query sólo se prueba de verdad');
console.log('      corriéndola contra la base (suite 7 §A).');
process.exit(err ? 1 : 0);
