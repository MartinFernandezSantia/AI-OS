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

// FILAS REALES de la ejecución del 2026-07-29 (recortadas a 5 de las 29).
// Ojo `mostrable: false` en TODAS: en la vista es `(not tiene_reglas)`, o sea
// "precio limpio sin escalera", NO un flag de visibilidad. Filtrar por él dejaba
// al agente con "(la busqueda no devolvio nada)".
const FILAS = [
  { producto_id: 'p1', nombre_canonico: 'Impresiones papel obra 75 gr', score: '5.28',
    variante_id: 'v1', variante: 'simple faz b/n', precio_lista: '100', unidad: 'Hoja',
    mostrable: false, solo_descuentos: false, por_pagina: true, por_pack: false,
    tiene_reglas: true, nicho: null,
    rangos_cantidad: [{ value: 100, minQty: 1, maxQty: 10 }, { value: 70, minQty: 11, maxQty: 1000 }, { value: 65, minQty: 1001, maxQty: null }] },
  { producto_id: 'p1', nombre_canonico: 'Impresiones papel obra 75 gr', score: '5.28',
    variante_id: 'v2', variante: 'doble faz b/n', precio_lista: '150', unidad: 'Hoja',
    mostrable: false, solo_descuentos: false, por_pagina: true, por_pack: false,
    tiene_reglas: true, nicho: null,
    rangos_cantidad: [{ value: 150, minQty: 1, maxQty: 10 }, { value: 96, minQty: 11, maxQty: 50 },
      { value: 88, minQty: 51, maxQty: 250 }, { value: 86, minQty: 251, maxQty: 500 }, { value: 84, minQty: 501, maxQty: null }] },
  { producto_id: 'p1', nombre_canonico: 'Impresiones papel obra 75 gr', score: '5.28',
    variante_id: 'v3', variante: 'simple faz color', precio_lista: '400', unidad: 'Hoja',
    mostrable: false, solo_descuentos: false, por_pagina: true, por_pack: false,
    tiene_reglas: true, nicho: null,
    rangos_cantidad: [{ value: 400, minQty: 1, maxQty: 70 }, { value: 150, minQty: 71, maxQty: 150 }, { value: 80, minQty: 151, maxQty: 500 }] },
  // precio_lista 0 PERO con escalera: no es "sin precio"
  { producto_id: 'p2', nombre_canonico: 'Impresiones a4 papel obra 106 gr', score: '5.28',
    variante_id: 'v4', variante: 'doble faz b/n', precio_lista: '0', unidad: 'Hoja',
    mostrable: false, solo_descuentos: false, por_pagina: true, por_pack: false,
    tiene_reglas: true, nicho: null,
    rangos_cantidad: [{ value: 230, minQty: 1, maxQty: 10 }, { value: 176, minQty: 11, maxQty: 100 }, { value: 178, minQty: 101, maxQty: 500 }] },
  // solo_descuentos: va a caveat, nunca a precio
  { producto_id: 'p3', nombre_canonico: 'Impresiones láser color papel obra 80 gr', score: '5.28',
    variante_id: 'v5', variante: 'A4', precio_lista: '750', unidad: 'Hoja',
    mostrable: false, solo_descuentos: true, por_pagina: false, por_pack: false,
    tiene_reglas: true, nicho: null, rangos_cantidad: null },
];

const SOBRE = {
  userMessage: 'cuánto sale imprimir 200 páginas doble faz en obra 75?',
  conversation: [{ role: 'user', content: 'cuánto sale imprimir 200 páginas doble faz en obra 75?' }],
  conversationId: 377, accountId: 1,
  seleccion: { terminos: ['Impresiones papel obra 75 gr'], productos: [], cantidad: 200 },
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
check('arma un candidato por variante', armados.candidatos.length === 5,
  'candidatos=' + armados.candidatos.length);
check('preserva las filas crudas para el verificador', armados.filasCrudas.length === 5);
// EL BUG DEL 2026-07-29: con mostrable=false en todas, el prompt decia
// "(la busqueda no devolvio nada)" y el agente contestaba bien sobre nada.
check('NO filtra por `mostrable` (es not tiene_reglas, no visibilidad)',
  (armados.promptAgente.match(/\[\d+\]/g) || []).length === 5,
  'opciones en el prompt: ' + (armados.promptAgente.match(/\[\d+\]/g) || []).length);
check('el prompt NO dice "no devolvio nada"',
  !/no devolvio nada/.test(armados.promptAgente));

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

// ── El monto es deterministico y respeta la escalera ───────────────────
console.log('\n=== Invariante de plata ===');
const conMonto = correr('Calcular Montos', { output: { elegidos: [{ idx: 2, confianza: 0.9 }] } }, ctx);
const h0 = conMonto.hechos[0];
// EL CASO REAL: 200 paginas doble faz. precio_lista dice 150 (tramo 1-10) pero
// el tramo 51-250 vale 88. Informar 150 seria un 1,7x.
check('elige el TRAMO por cantidad (200 -> $88), no precio_lista ($150)',
  h0 && h0.monto === 88, JSON.stringify(h0));
check('el texto dice "por pagina"', h0 && /por pagina/.test(h0.texto), h0 && h0.texto);
check('NO multiplica por la cantidad (no dice 17.600 ni 24.000)',
  !/17\.?600|24\.?000/.test(JSON.stringify(conMonto.hechos)));
check('montosAutorizados = los montos de los hechos',
  JSON.stringify(conMonto.montosAutorizados) === '[88]', JSON.stringify(conMonto.montosAutorizados));

// precio_lista 0 con escalera != sin precio
const cero = correr('Calcular Montos', { output: { elegidos: [{ idx: 4, confianza: 0.9 }] } }, ctx);
check('precio_lista 0 CON escalera da precio (no caveat)',
  cero.hechos.length === 1 && cero.hechos[0].monto === 178,
  'hechos=' + JSON.stringify(cero.hechos) + ' caveats=' + JSON.stringify(cero.caveats));

// solo_descuentos nunca sale como precio
const desc = correr('Calcular Montos', { output: { elegidos: [{ idx: 5, confianza: 0.9 }] } }, ctx);
check('solo_descuentos va a caveat, no a precio',
  desc.hechos.length === 0 && desc.caveats.length === 1,
  'hechos=' + desc.hechos.length + ' caveats=' + desc.caveats.length);
check('un caveat solo tambien deja hablar (no escala)', desc.hayAlgoQueDecir === true);

// varias variantes para comparar
const varias = correr('Calcular Montos',
  { output: { elegidos: [{ idx: 1, confianza: 0.8 }, { idx: 2, confianza: 0.9 }] } }, ctx);
check('con 2 variantes emite 2 hechos con su tramo',
  varias.hechos.length === 2 && varias.hechos[0].monto === 70 && varias.hechos[1].monto === 88,
  JSON.stringify(varias.hechos.map((h) => h.monto)));

// ── EL VERIFICADOR: que vea la escalera y no vete al codigo ────────────
// 2do rechazo real del 2026-07-29: el verificador tumbó $88 y $120 diciendo que
// "no figuran en la base cruda". Tenía razón con lo que le mostrábamos: el
// prompt traía sólo precio_lista (150) y NO la escalera de donde sale el 88.
console.log('\n=== Verificador: evidencia completa ===');
const sobreVerif = {
  ...conMonto,
  borrador: 'Las impresiones doble faz en obra 75 te salen $88 por página.',
  conversation: SOBRE.conversation,
  seleccion: SOBRE.seleccion,
};
const pv = correr('Prompt Verificador', {}, { 'Leer Compositor': sobreVerif });

check('las filas crudas muestran la escalera por cantidad',
  /escalera por cantidad/.test(pv.promptAgente),
  pv.promptAgente.split('\n').filter((l) => /fila 1/.test(l))[0]);
check('el $88 del hecho aparece en la evidencia cruda',
  /88/.test(pv.promptAgente.split('RESULTADO CRUDO')[1] || ''));
check('precio_lista se nombra como "tramo 1", no como "el precio"',
  /precio base \(tramo 1\)/.test(pv.promptAgente));
check('el prompt explica de donde sale el monto',
  /COMO SE CALCULARON LOS HECHOS/.test(pv.promptAgente));
check('el chequeo automatico se declara deterministico',
  /DETERMINISTICO/.test(pv.promptAgente) && /NO lo contradigas/.test(pv.promptAgente));
check('el guard no detecta montos no autorizados (el mensaje es correcto)',
  (pv.numerosNoAutorizados || []).length === 0, JSON.stringify(pv.numerosNoAutorizados));

console.log('\n=== Verificador: el codigo manda sobre la plata ===');
const veredictos = [
  ['LLM rechaza por precio_inventado con chequeo OK -> SE IGNORA',
    { output: { aprobado: false, falla: 'precio_inventado', motivo: 'no figuran en la base' } }, true, true],
  ['LLM rechaza por producto_equivocado -> se respeta',
    { output: { aprobado: false, falla: 'producto_equivocado', motivo: 'no es lo que pidio' } }, false, false],
  ['LLM rechaza por no_contesta -> se respeta',
    { output: { aprobado: false, falla: 'no_contesta', motivo: 'no responde' } }, false, false],
  ['LLM aprueba -> pasa',
    { output: { aprobado: true, falla: 'ninguna', motivo: 'ok' } }, true, false],
];
for (const [nombre, raw, deberiaAprobar, esperaVeto] of veredictos) {
  const r = correr('Leer Verificador', raw, { 'Prompt Verificador': pv });
  check(nombre, r.aprobado === deberiaAprobar && r.vetoInvalido === esperaVeto,
    'aprobado=' + r.aprobado + ' veto=' + r.vetoInvalido + ' falla=' + r.falla);
}

// y el guard sigue mandando para RECHAZAR
const conInventado = correr('Leer Verificador',
  { output: { aprobado: true, falla: 'ninguna' } },
  { 'Prompt Verificador': { ...pv, numerosNoAutorizados: [999] } });
check('un monto NO autorizado tumba el OK del LLM',
  conInventado.aprobado === false && conInventado.falla === 'precio_inventado',
  'aprobado=' + conInventado.aprobado + ' falla=' + conInventado.falla);

// ── UNIDAD DE COBRO: `unidad_venta` manda sobre `unidad` ────────────────
//
// Incidente del 2026-07-29 (loop de reintento): "cuanto sale anillar 120 hojas"
// -> "$2.400 por hoja". Un anillado se cobra POR TRABAJO. Si el cliente
// multiplica por 120 se lleva $288.000 de una cotizacion de $2.400 (120x).
//
// La columna `unidad` dice "Hoja" en 142 de 165 variantes del catalogo real,
// pero solo 48 se cobran por hoja de verdad: unidad(48) hoja(40) pack(26)
// trabajo(18) m2 metro. El dato bueno vive en atributos.unidad_venta.
//
// POR QUE NINGUN TEST LO PESCO: ninguna fixture traia `atributos`. El harness
// mockeaba filas donde `unidad` y `unidad_venta` no podian discrepar — el bug
// quedaba afuera POR CONSTRUCCION. Estas filas son las reales del export
// (db/export-actualizado-catalogo.json, producto Anillado).
console.log('\n=== Unidad de cobro (unidad_venta vs unidad) ===');
const FILAS_ANILLADO = [
  { producto_id: 'an1', nombre_canonico: 'Anillado plástico a4/oficio', score: '4.1',
    variante_id: 'av1', variante: '.', precio_lista: '2400', unidad: 'Hoja',
    mostrable: true, solo_descuentos: false, por_pagina: false, por_pack: false,
    tiene_reglas: false, nicho: null, rangos_cantidad: null,
    atributos: { tamano: ['a4', 'oficio'], material: 'plastico', multiplica: true, unidad_venta: 'trabajo' } },
  { producto_id: 'an2', nombre_canonico: 'Anillado Metálico a4/a3', score: '4.1',
    variante_id: 'av2', variante: 'Hasta 3/4', precio_lista: '3200', unidad: 'Hoja',
    mostrable: true, solo_descuentos: false, por_pagina: false, por_pack: false,
    tiene_reglas: false, nicho: null, rangos_cantidad: null,
    atributos: { tamano: ['a4', 'a3'], material: 'metalico', multiplica: true, unidad_venta: 'trabajo' } },
];
const SOBRE_ANILLADO = {
  userMessage: 'cuanto sale anillar 120 hojas?',
  conversation: [{ role: 'user', content: 'cuanto sale anillar 120 hojas?' }],
  conversationId: 380, accountId: 1,
  seleccion: { terminos: ['Anillado plástico'], productos: [], cantidad: 120 },
};
const armAn = correr('Armar Candidatos', FILAS_ANILLADO, { 'Leer Selector': SOBRE_ANILLADO });
check('el candidato NO se lista como "por Hoja"',
  !/por Hoja/i.test(armAn.promptAgente), armAn.promptAgente.split('\n')[3]);
check('el candidato se lista "por trabajo"',
  /por trabajo/.test(armAn.promptAgente), armAn.promptAgente.split('\n')[3]);

const anillado = correr('Calcular Montos',
  { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } }, { 'Armar Candidatos': armAn });
const ha = anillado.hechos[0];
check('el hecho dice "por trabajo", NO "por Hoja"',
  ha && /por trabajo/.test(ha.texto) && !/por Hoja/i.test(ha.texto), ha && ha.texto);
check('marca esPorTrabajo para que el compositor lo sepa', ha && ha.esPorTrabajo === true);
check('NO agrega "(por 120 unidades)" a un precio por trabajo',
  ha && !/120 unidades/.test(ha.texto), ha && ha.texto);
check('el monto sigue siendo el de la fila ($2.400)', ha && ha.monto === 2400);
check('el prompt le avisa al compositor que NO se multiplica',
  /trabajo COMPLETO/.test(anillado.promptAgente) && /no multiplique/.test(anillado.promptAgente));

// el verificador tiene que ver "se cobra: trabajo", no "unidad: Hoja" —
// esa contradiccion es la que lo hizo rechazar dos veces seguidas
const pvAn = correr('Prompt Verificador', {}, { 'Leer Compositor': {
  ...anillado,
  borrador: 'El anillado plástico a4/oficio sale $2.400 por trabajo.',
  conversation: SOBRE_ANILLADO.conversation,
  seleccion: SOBRE_ANILLADO.seleccion,
} });
check('el verificador ve "se cobra: trabajo"', /se cobra: trabajo/.test(pvAn.promptAgente));
check('el verificador NO ve "unidad: Hoja" (la columna que miente)',
  !/unidad: Hoja/i.test(pvAn.promptAgente));
check('el prompt le dice al auditor que no juzgue la unidad por su cuenta',
  /LA UNIDAD DE COBRO/.test(pvAn.promptAgente));
check('el guard no marca el monto como inventado',
  (pvAn.numerosNoAutorizados || []).length === 0, JSON.stringify(pvAn.numerosNoAutorizados));

// FALLBACK: sin unidad_venta se sigue usando `unidad` (no se rompe lo que andaba)
const sinUV = correr('Armar Candidatos', [{ ...FILAS_ANILLADO[0], atributos: {} }],
  { 'Leer Selector': SOBRE_ANILLADO });
check('sin unidad_venta se cae a la columna `unidad`',
  /por Hoja/i.test(sinUV.promptAgente), sinUV.promptAgente.split('\n')[3]);

// las impresiones (unidad_venta: hoja) tienen que seguir diciendo por pagina
const impr = correr('Calcular Montos', { output: { elegidos: [{ idx: 2, confianza: 0.9 }] } }, ctx);
check('no rompe las impresiones: sigue diciendo "por pagina"',
  /por pagina/.test(impr.hechos[0].texto), impr.hechos[0].texto);

console.log('\n' + '='.repeat(58));
console.log(fallos ? 'FALLA: ' + fallos + ' de ' + (ok + fallos) : 'TODO OK: ' + ok + ' casos');
process.exit(fallos ? 1 : 0);
