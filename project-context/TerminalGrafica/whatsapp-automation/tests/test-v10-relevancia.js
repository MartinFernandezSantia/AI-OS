// TEST del nodo `Calcular Montos` — el que decide si el turno vive o escala.
//
// Motivo (2026-07-29): "cuánto sale imprimir 200 páginas doble faz en obra 75?"
// escaló a mail con la búsqueda trayendo los productos CORRECTOS. El turno murió
// en ¿Hay Algo Que Decir? y no quedó registro de por qué, porque cuando escala
// Log Turno no corre.
//
// Corre el jsCode REAL extraído del workflow (no una copia), así el test no puede
// quedar desincronizado del nodo.
//
//   node tests/test-v10-relevancia.js
//   WF=faq-bot-v9-test.json node tests/test-v10-relevancia.js
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'n8n', 'flows');
const wf = JSON.parse(fs.readFileSync(path.join(DIR, process.env.WF || 'faq-bot-v10-live.json'), 'utf8'));
const nodo = (n) => wf.nodes.find((x) => x.name === n);

// Filas como las devuelve Buscar Candidatos para el caso real: el producto tiene
// 4 variantes (simple/doble faz x bn/color) y el cliente pidió doble faz.
const FILAS = [
  { producto_id: 'p1', nombre_canonico: 'Impresiones papel obra 75 gr', score: 3.2,
    variante_id: 'v1', variante: 'simple faz bn', precio_lista: 70, unidad: 'hoja',
    mostrable: true, solo_descuentos: false, por_pagina: true, por_pack: null, tiene_reglas: true, nicho: null },
  { producto_id: 'p1', nombre_canonico: 'Impresiones papel obra 75 gr', score: 3.2,
    variante_id: 'v2', variante: 'doble faz bn', precio_lista: 120, unidad: 'hoja',
    mostrable: true, solo_descuentos: false, por_pagina: true, por_pack: null, tiene_reglas: true, nicho: null },
  { producto_id: 'p1', nombre_canonico: 'Impresiones papel obra 75 gr', score: 3.2,
    variante_id: 'v3', variante: 'simple faz color', precio_lista: 400, unidad: 'hoja',
    mostrable: true, solo_descuentos: false, por_pagina: true, por_pack: null, tiene_reglas: true, nicho: null },
];

const SOBRE = {
  userMessage: 'cuánto sale imprimir 200 páginas doble faz en obra 75?',
  conversation: [{ role: 'user', content: 'cuánto sale imprimir 200 páginas doble faz en obra 75?' }],
  conversationId: 1, accountId: 1,
};

// Ejecuta el jsCode de un nodo con $() y $input mockeados.
function correr(nombreNodo, entrada, contexto) {
  const js = nodo(nombreNodo).parameters.jsCode;
  const $ = (n) => {
    if (!(n in contexto)) throw new Error('el nodo pide $(' + n + ') y el test no lo mockeó');
    return { first: () => ({ json: contexto[n] }), all: () => [{ json: contexto[n] }] };
  };
  const $input = {
    first: () => ({ json: Array.isArray(entrada) ? entrada[0] : entrada }),
    all: () => (Array.isArray(entrada) ? entrada : [entrada]).map((j) => ({ json: j })),
  };
  const fn = new Function('$', '$input', '$execution', js);
  const r = fn($, $input, { id: 'test' });
  return Array.isArray(r) ? r[0].json : r;
}

let ok = 0, fallos = 0;
const check = (nombre, cond, detalle) => {
  if (cond) { ok++; console.log('  ok     ' + nombre); }
  else { fallos++; console.log('  FALLA  ' + nombre + (detalle ? '\n           ' + detalle : '')); }
};

// ── Armar Candidatos: la lista cerrada ──────────────────────────────────
const armados = correr('Armar Candidatos', FILAS, { 'Leer Selector': SOBRE });
console.log('=== Armar Candidatos ===');
check('arma un candidato por variante', armados.candidatos.length === 3,
  'candidatos=' + armados.candidatos.length);
check('preserva las filas crudas para el verificador', armados.filasCrudas.length === 3);
check('el prompt lista las 3 opciones con precio',
  (armados.promptAgente.match(/\[\d\]/g) || []).length === 3);

// ── Calcular Montos: los escenarios que mataban el turno ────────────────
console.log('\n=== Calcular Montos — escenarios de salida del agente ===');
const ctx = { 'Armar Candidatos': armados };

const casos = [
  ['elige la variante correcta',        { output: { elegidos: [{ idx: 2, confianza: 0.9 }] } }, true],
  ['elige SIN declarar confianza',      { output: { elegidos: [{ idx: 2 }] } }, true],
  ['confianza como string',             { output: { elegidos: [{ idx: '2', confianza: '0.9' }] } }, true],
  ['confianza modesta (0.5)',           { output: { elegidos: [{ idx: 2, confianza: 0.5 }] } }, true],
  ['confianza 0.4 (mataba el turno)',   { output: { elegidos: [{ idx: 2, confianza: 0.4 }] } }, true],
  ['elige varias para comparar',        { output: { elegidos: [{ idx: 1, confianza: 0.7 }, { idx: 2, confianza: 0.9 }] } }, true],
  ['salida anidada raw.output.output',  { output: { output: { elegidos: [{ idx: 2, confianza: 0.9 }] } } }, true],
  ['salida como string JSON',           { output: '{"elegidos":[{"idx":2,"confianza":0.9}]}' }, true],
  ['salida en la raiz',                 { elegidos: [{ idx: 2, confianza: 0.9 }] }, true],
  ['con intermediateSteps',             { output: { elegidos: [{ idx: 2, confianza: 0.9 }] }, intermediateSteps: [{}] }, true],
  // los que SI tienen que escalar
  ['agente devuelve lista vacia',       { output: { elegidos: [] } }, false],
  ['agente inventa un idx',             { output: { elegidos: [{ idx: 99, confianza: 0.9 }] } }, false],
];

for (const [nombre, raw, deberiaVivir] of casos) {
  const r = correr('Calcular Montos', raw, ctx);
  const vive = r.hayAlgoQueDecir === true;
  check(nombre + (deberiaVivir ? ' -> responde' : ' -> escala'),
    vive === deberiaVivir,
    'hayAlgoQueDecir=' + vive + ' hechos=' + (r.hechos || []).length +
    ' motivoVacio=' + r.motivoVacio + ' idxInval=' + r.idxInvalidos);
}

// ── El rastro: toda escalada tiene que decir POR QUE ───────────────────
console.log('\n=== Rastro de la escalada ===');
const motivos = [
  ['agente_no_eligio', { output: { elegidos: [] } }],
  ['idx_invalidos',    { output: { elegidos: [{ idx: 99, confianza: 0.9 }] } }],
  ['salida_ilegible',  { output: { cualquierCosa: true } }],
];
for (const [esperado, raw] of motivos) {
  const r = correr('Calcular Montos', raw, ctx);
  check('motivoVacio = ' + esperado, r.motivoVacio === esperado, 'dio: ' + r.motivoVacio);
}

const ilegible = correr('Calcular Montos', { output: { cualquierCosa: true } }, ctx);
check('guarda la salida cruda cuando no la puede interpretar',
  typeof ilegible.crudoAgente === 'string' && ilegible.crudoAgente.length > 0);

// ── El monto es deterministico ─────────────────────────────────────────
console.log('\n=== Invariante de plata ===');
const conMonto = correr('Calcular Montos', { output: { elegidos: [{ idx: 2, confianza: 0.9 }] } }, ctx);
check('el hecho trae el precio de la fila SQL (120)',
  conMonto.hechos[0].monto === 120, JSON.stringify(conMonto.hechos[0]));
check('el texto dice "por pagina" (por_pagina=true)',
  /por pagina/.test(conMonto.hechos[0].texto), conMonto.hechos[0].texto);
check('NO multiplica por la cantidad (200) — precio_lista es el BASE',
  !/24\.000|24000/.test(JSON.stringify(conMonto.hechos)));
check('montosAutorizados = los montos de los hechos',
  JSON.stringify(conMonto.montosAutorizados) === '[120]');

console.log('\n' + '='.repeat(58));
console.log(fallos ? 'FALLA: ' + fallos + ' de ' + (ok + fallos) : 'TODO OK: ' + ok + ' casos');
process.exit(fallos ? 1 : 0);
