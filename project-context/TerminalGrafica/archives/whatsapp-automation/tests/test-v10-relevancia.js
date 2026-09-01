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
    tiene_reglas: true, nicho: null, rangos_cantidad: null,
    // con unidad_venta: sin esto la fila cae en el caveat de "no consta como se
    // cobra" y el test mediria ese guard en vez del de solo_descuentos.
    atributos: { unidad_venta: 'hoja', multiplica: true } },
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

// solo_descuentos SI sale como precio + caveat (corregido 2026-07-29: era
// telemetria, no una orden de silencio — ver la seccion del final).
const desc = correr('Calcular Montos', { output: { elegidos: [{ idx: 5, confianza: 0.9 }] } }, ctx);
check('solo_descuentos emite el precio Y el caveat',
  desc.hechos.length === 1 && desc.caveats.length >= 1,
  'hechos=' + desc.hechos.length + ' caveats=' + desc.caveats.length);
check('el caveat avisa que puede haber un precio mejor',
  desc.caveats.some((c) => /precio mejor/.test(c.nota)), JSON.stringify(desc.caveats));
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

// SIN FALLBACK a `unidad` (decision 2026-07-29, tras medir el catalogo): las 6
// variantes sin unidad_venta tienen unidad="Hoja" y en las 6 esta mal. Caer a
// esa columna no rescata el caso, le pone una unidad incorrecta con cara de
// correcta. Ver la seccion "Sin unidad_venta" al final.
const sinUV = correr('Armar Candidatos', [{ ...FILAS_ANILLADO[0], atributos: {} }],
  { 'Leer Selector': SOBRE_ANILLADO });
check('sin unidad_venta NO se cae a `unidad` (diria "por Hoja" en un anillado)',
  !/por Hoja/i.test(sinUV.promptAgente), sinUV.promptAgente.split('\n')[3]);

// las impresiones (unidad_venta: hoja) tienen que seguir diciendo por pagina
const impr = correr('Calcular Montos', { output: { elegidos: [{ idx: 2, confianza: 0.9 }] } }, ctx);
check('no rompe las impresiones: sigue diciendo "por pagina"',
  /por pagina/.test(impr.hechos[0].texto), impr.hechos[0].texto);

// ── PACKS: `por_pack` es un FLAG, la cantidad esta en pack_unidades ─────
//
// Encontrado auditando el catalogo (2026-07-29), misma familia que unidad_venta:
// el nombre del campo sugiere un dato que el campo no tiene. `por_pack` es
// booleano y se usaba como si trajera el numero -> "el pack de true".
// La cantidad real vive en atributos.pack_unidades.
console.log('\n=== Packs (por_pack booleano vs pack_unidades) ===');
const FILAS_PACK = [
  { producto_id: 'tp1', nombre_canonico: '100 Tarjetas Color/Negro', score: '4.8',
    variante_id: 'tv1', variante: '.', precio_lista: '15000', unidad: 'Hoja',
    mostrable: true, solo_descuentos: false, por_pagina: false, por_pack: true,
    tiene_reglas: false, nicho: null, rangos_cantidad: null,
    atributos: { unidad_venta: 'pack', pack_unidades: 100, pack_tiers: [100, 500, 1000] } },
];
const SOBRE_PACK = {
  userMessage: 'cuanto salen 500 tarjetas?',
  conversation: [{ role: 'user', content: 'cuanto salen 500 tarjetas?' }],
  conversationId: 381, accountId: 1,
  seleccion: { terminos: ['Tarjetas'], productos: [], cantidad: 500 },
};
const armPk = correr('Armar Candidatos', FILAS_PACK, { 'Leer Selector': SOBRE_PACK });
check('el candidato NO dice "pack de true"', !/pack de true/i.test(armPk.promptAgente),
  armPk.promptAgente.split('\n')[3]);
check('el candidato dice la cantidad real del pack (100)',
  /pack de 100 unidades/.test(armPk.promptAgente), armPk.promptAgente.split('\n')[3]);
check('el candidato avisa que hay otros packs (500, 1000)',
  /tambien hay packs de 100, 500, 1000/.test(armPk.promptAgente));

const pack = correr('Calcular Montos',
  { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } }, { 'Armar Candidatos': armPk });
const hp = pack.hechos[0];
check('el hecho NO dice "el pack de true"', hp && !/true/i.test(hp.texto), hp && hp.texto);
check('el hecho dice "el pack de 100 unidades"',
  hp && /el pack de 100 unidades/.test(hp.texto), hp && hp.texto);
check('el monto es el de la fila ($15.000)', hp && hp.monto === 15000);
// el cliente pidio 500 y el candidato es el pack de 100: tiene que enterarse
check('avisa por caveat que hay packs de 500 y 1000',
  pack.caveats.some((c) => /500, 1000/.test(c.nota)), JSON.stringify(pack.caveats));

const pvPk = correr('Prompt Verificador', {}, { 'Leer Compositor': {
  ...pack, borrador: 'El pack de 100 tarjetas sale $15.000.',
  conversation: SOBRE_PACK.conversation, seleccion: SOBRE_PACK.seleccion,
} });
check('el verificador ve el tamanio del pack', /pack de 100 unidades/.test(pvPk.promptAgente));

// pack sin pack_unidades: no debe inventar un numero
const packSinN = correr('Armar Candidatos',
  [{ ...FILAS_PACK[0], atributos: { unidad_venta: 'pack' } }], { 'Leer Selector': SOBRE_PACK });
check('pack sin pack_unidades dice "por pack" sin numero',
  !/pack de (true|null|undefined|NaN)/i.test(packSinN.promptAgente),
  packSinN.promptAgente.split('\n')[3]);

// ── PEDIDO MINIMO: por debajo del minimo el precio NO vale ──────────────
//
// Promo inmobiliarias: $15.000 el cartel LLEVANDO 6. El suelto sale $19.500
// (otra fila). Ya estaba diagnosticado en v9 (preguntas-tg.md): sin el minimo,
// "3 carteles" cotizaba $45.000 contra $58.500 reales. v10 lo habia perdido.
console.log('\n=== Pedido minimo (min_unidades) ===');
const FILA_MIN = {
  producto_id: 'pm1', nombre_canonico: 'Promoción para inmobiliarias (cartel de 1 × 0,65 m, llevando 6)',
  score: '4.2', variante_id: 'pv1', variante: '.', precio_lista: '15000', unidad: 'unidad',
  mostrable: true, solo_descuentos: false, por_pagina: false, por_pack: false,
  tiene_reglas: false, nicho: 'inmobiliarias', rangos_cantidad: null,
  // `multiplica: true` es lo que dice la fila REAL del catalogo (verificado en
  // db/export-actualizado-catalogo.json, producto "Promocion Inmobiliarias 6
  // carteles"). El fixture no lo declaraba, asi que el no-total se atribuia a
  // `no_multiplica` y tapaba la razon verdadera (`bajo_minimo`) — el test pasaba
  // por el motivo equivocado.
  atributos: {
    unidad_venta: 'unidad', min_unidades: 6, nicho: 'inmobiliarias', multiplica: true,
  },
};
const sobreMin = (cant) => ({
  userMessage: 'necesito ' + cant + ' carteles para la inmobiliaria',
  conversation: [{ role: 'user', content: 'necesito ' + cant + ' carteles para la inmobiliaria' }],
  conversationId: 382, accountId: 1,
  seleccion: { terminos: ['cartel inmobiliaria'], productos: [], cantidad: cant },
});

// POLITICA NUEVA (Martin, 2026-07-29): bajo el minimo la OFERTA SE DICE.
//
// Estos 4 checks afirmaban lo contrario ("NO emite el precio", "avisa por
// caveat") y pasaban en verde mientras el bot fallaba en WhatsApp: el cliente
// dijo que era de una inmobiliaria, pidio 3 carteles, y nunca se enrero de que
// llevando 6 le salian $15.000 en vez de $19.500. El `continue` que los hacia
// pasar era el bug.
//
// Lo que NO cambia: no se cotiza un TOTAL con el precio de la promo (3 x $15.000
// = $45.000 seria 1,3x por debajo de los $58.500 reales). El monto se dice, el
// total no.
const bajo = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
  { 'Armar Candidatos': correr('Armar Candidatos', [FILA_MIN], { 'Leer Selector': sobreMin(3) }) });
check('bajo el minimo SI emite la oferta como hecho', bajo.hechos.length === 1,
  JSON.stringify(bajo.hechos));
check('la marca como oferta condicionada', bajo.hechos[0].ofertaBajoMinimo === true);
check('el minimo viaja PEGADO al monto (no como caveat borrable)',
  /\$15\.000.*llevando 6 o mas/.test(bajo.hechos[0].texto), bajo.hechos[0].texto);
check('bajo el minimo NO da total', bajo.hechos[0].total === null,
  JSON.stringify(bajo.hechos[0].total));
check('el motivo del no-total es el minimo', bajo.hechos[0].motivoSinTotal === 'bajo_minimo',
  bajo.hechos[0].motivoSinTotal);
check('bajo el minimo NO escala: hay algo que decir', bajo.hayAlgoQueDecir === true);
check('$15.000 queda autorizado (el compositor tiene que poder decirlo)',
  (bajo.montosAutorizados || []).includes(15000), JSON.stringify(bajo.montosAutorizados));
check('NO autoriza el total que no se calculo',
  !(bajo.montosAutorizados || []).includes(45000), JSON.stringify(bajo.montosAutorizados));
check('le pide al compositor decir las DOS cosas',
  /DECI LAS DOS COSAS/.test(bajo.promptAgente));
check('le explica que es una oferta y no el precio de lo que pidio',
  /OFERTA que arranca en 6/.test(bajo.promptAgente), bajo.promptAgente.slice(0, 400));

// pide 10, arriba del minimo -> cotiza normal, y el minimo se dice igual
const alto = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
  { 'Armar Candidatos': correr('Armar Candidatos', [FILA_MIN], { 'Leer Selector': sobreMin(10) }) });
check('arriba del minimo SI cotiza', alto.hechos.length === 1 && alto.hechos[0].monto === 15000,
  JSON.stringify(alto.hechos));
check('arriba del minimo NO es oferta condicionada', alto.hechos[0].ofertaBajoMinimo === false);
check('arriba del minimo igual aclara el minimo',
  /llevando 6 o mas/.test(alto.hechos[0].texto), alto.hechos[0].texto);
check('el minimo NO se dice dos veces (estaba duplicado en caveats)',
  !alto.caveats.some((c) => /llevando 6 o mas/.test(c.nota)), JSON.stringify(alto.caveats));

const armMin = correr('Armar Candidatos', [FILA_MIN], { 'Leer Selector': sobreMin(3) });
check('el candidato le muestra el minimo al agente',
  /LLEVAR AL MENOS 6/.test(armMin.promptAgente), armMin.promptAgente.split('\n')[3]);

const pvMin = correr('Prompt Verificador', {}, { 'Leer Compositor': {
  ...bajo, borrador: 'Ese precio es llevando 6 o más.',
  conversation: sobreMin(3).conversation, seleccion: sobreMin(3).seleccion,
} });
check('el verificador ve el minimo en la fila cruda', /MINIMO 6 unidades/.test(pvMin.promptAgente));

// ── SIN unidad_venta: NO se cae a `unidad` ─────────────────────────────
//
// Medido sobre el catalogo real: 6 variantes no tienen unidad_venta, y en LAS
// SEIS `unidad` dice "Hoja" cuando son 3 anillados (por trabajo), Ojales (por
// unidad) y 2 Papel Vegetal (pack de 10). Justo donde `unidad` seria el unico
// dato, miente. Caer a esa columna no rescata el caso: le pone una unidad
// incorrecta con cara de correcta.
console.log('\n=== Sin unidad_venta: caveat honesto, no "por Hoja" ===');
const FILA_OJALES = {
  producto_id: 'oj1', nombre_canonico: 'Ojales', score: '3.9',
  variante_id: 'ov1', variante: '.', precio_lista: '500', unidad: 'Hoja',
  mostrable: true, solo_descuentos: false, por_pagina: false, por_pack: false,
  tiene_reglas: false, nicho: null, rangos_cantidad: null,
  atributos: {},   // <- sin unidad_venta, como en el catalogo real
};
const SOBRE_OJ = {
  userMessage: 'cuanto sale ponerle ojales a una lona?',
  conversation: [{ role: 'user', content: 'cuanto sale ponerle ojales a una lona?' }],
  conversationId: 383, accountId: 1,
  seleccion: { terminos: ['ojales'], productos: [], cantidad: null },
};
const armOj = correr('Armar Candidatos', [FILA_OJALES], { 'Leer Selector': SOBRE_OJ });
check('el candidato NO dice "por Hoja"', !/por Hoja/i.test(armOj.promptAgente),
  armOj.promptAgente.split('\n')[3]);
check('el candidato avisa que no consta como se cobra',
  /no consta como se cobra/.test(armOj.promptAgente), armOj.promptAgente.split('\n')[3]);
check('`unidad` NO viaja en el objeto candidato',
  !('unidad' in armOj.candidatos[0]), Object.keys(armOj.candidatos[0]).join(','));

const oj = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
  { 'Armar Candidatos': armOj });
check('sin unidad de cobro NO emite el precio como hecho', oj.hechos.length === 0,
  JSON.stringify(oj.hechos));
check('va a caveat honesto', oj.caveats.some((c) => /como se cobra/.test(c.nota)),
  JSON.stringify(oj.caveats));
check('NO escala: el caveat deja hablar', oj.hayAlgoQueDecir === true);
check('$500 NO queda autorizado', !(oj.montosAutorizados || []).includes(500),
  JSON.stringify(oj.montosAutorizados));

const pvOj = correr('Prompt Verificador', {}, { 'Leer Compositor': {
  ...oj, borrador: 'Los ojales los tenemos, te confirmamos por mail cómo se cobran.',
  conversation: SOBRE_OJ.conversation, seleccion: SOBRE_OJ.seleccion,
} });
check('el verificador ve "SIN DATO" y por que no es confiable',
  /SIN DATO/.test(pvOj.promptAgente) && /NO es confiable/.test(pvOj.promptAgente));

// `por_pack` SIGUE siendo util como flag: "es un pack" aunque no diga cuantos
const FILA_VEG = { ...FILA_OJALES, nombre_canonico: 'Papel Vegetal a4 x 10 unid',
  por_pack: true, precio_lista: '3000', atributos: {} };
const armVeg = correr('Armar Candidatos', [FILA_VEG], { 'Leer Selector': SOBRE_OJ });
check('por_pack sin pack_unidades igual dice "se vende por pack"',
  /se vende por pack/.test(armVeg.promptAgente), armVeg.promptAgente.split('\n')[3]);
const veg = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
  { 'Armar Candidatos': armVeg });
check('un pack sin cantidad SI cotiza (el flag alcanza para la unidad)',
  veg.hechos.length === 1 && /el pack/.test(veg.hechos[0].texto),
  JSON.stringify(veg.hechos));

// ── EL VERIFICADOR CORRIGE (decision de Martin 2026-07-29) ─────────────
//
// Puede devolver el mensaje ya arreglado en vez de solo rechazar. Lo delicado:
// pasa a ser el unico que escribe sin que nadie lo audite despues. Por eso su
// correccion pasa por EL MISMO guard de plata que el borrador del compositor.
console.log('\n=== Verificador: correccion con guard de plata ===');
{
  const base = { ...pv, borrador: 'Sale $88 por página. ¿Querés que avancemos con el pedido?' };
  const corr = correr('Leer Verificador', { output: {
    aprobado: true, falla: 'ninguna', motivo: 'saque la oferta de tomar pedido',
    mensajeCorregido: 'Sale $88 por página. Para encargarlo escribinos a terminalgrafica@gmail.com.',
    queCorregi: 'saque el ofrecimiento de tomar el pedido',
  } }, { 'Prompt Verificador': base });
  check('la correccion sin montos nuevos se aplica', corr.correccionAplicada === true);
  check('`final` es el mensaje corregido', /terminalgrafica@gmail\.com/.test(corr.final), corr.final);
  check('`final` YA NO ofrece avanzar', !/avancemos/.test(corr.final), corr.final);
  check('queda registrado en notas', /CORREGIDO-POR-VERIFICADOR/.test(corr.notas));

  // EL CASO PELIGROSO: el auditor tipea un monto que el calculo no produjo.
  const conPlata = correr('Leer Verificador', { output: {
    aprobado: true, falla: 'ninguna', motivo: 'ajuste',
    mensajeCorregido: 'Sale $95 por página, mejor precio.',
  } }, { 'Prompt Verificador': base });
  check('un monto inventado EN LA CORRECCION tumba el turno', conPlata.aprobado === false,
    'aprobado=' + conPlata.aprobado);
  check('NO se envia la correccion con plata inventada', !/95/.test(conPlata.final || ''),
    conPlata.final);
  check('NO se cae en silencio al borrador original', conPlata.final === '', conPlata.final);
  check('se marca correccionRechazada para auditarlo', conPlata.correccionRechazada === true);
  check('la falla queda como precio_inventado', conPlata.falla === 'precio_inventado');
  check('queda el rastro con el monto que invento', /CORRECCION-CON-PLATA-INVENTADA\(95\)/.test(conPlata.notas),
    conPlata.notas);

  // sin correccion, todo sigue como antes
  const sinCorr = correr('Leer Verificador',
    { output: { aprobado: true, falla: 'ninguna', motivo: 'ok' } }, { 'Prompt Verificador': base });
  check('sin correccion sale el borrador original', sinCorr.final === base.borrador);
  check('sin correccion no marca nada', sinCorr.correccionAplicada === false);

  // ── GUARD DE OFERTA BORRADA ─────────────────────────────────────────
  //
  // EL CASO REAL DEL 2026-07-29. El verificador aprobo el mensaje pero le borro
  // la promo de inmobiliarias ($15.000 llevando 6), dejando solo el suelto
  // ($19.500). Motivo declarado: "informacion innecesaria sobre otras medidas y
  // promociones que no venian al caso". El cliente se fue sin saber que existia
  // un precio mejor, y el log decia CORREGIDO-POR-VERIFICADOR sin mas detalle.
  console.log('\n=== Guard: el verificador NO puede borrar una oferta ===');
  const conOferta = {
    ...pv,
    borrador: 'El cartel suelto sale $19.500 por unidad. Llevando 6 te sale $15.000 cada uno.',
    montosAutorizados: [19500, 15000],
    hechos: [
      { producto: 'Cartel 1x0.65', texto: '$19.500 por unidad', monto: 19500 },
      { producto: 'Promo inmobiliarias', texto: '$15.000 por unidad llevando 6 o mas',
        monto: 15000, ofertaBajoMinimo: true, minUnidades: 6 },
    ],
  };

  const borroOferta = correr('Leer Verificador', { output: {
    aprobado: true, falla: 'ninguna',
    motivo: 'El mensaje incluia informacion innecesaria sobre promociones que no venian al caso',
    mensajeCorregido: 'El cartel de 1 x 0.65 mt sale $19.500 por unidad. Para un presupuesto escribinos a terminalgrafica@gmail.com.',
    queCorregi: 'Elimine la mencion a la promocion de 6 unidades',
  } }, { 'Prompt Verificador': conOferta });
  check('la correccion que borra la oferta se descarta',
    borroOferta.correccionAplicada === false);
  check('sale el borrador ORIGINAL, que tenia la promo',
    /15\.000/.test(borroOferta.final), borroOferta.final);
  check('el turno NO se rechaza (el borrador estaba bien)', borroOferta.aprobado === true);
  check('NO lo confunde con plata inventada', borroOferta.montoInventado === false);
  check('queda el rastro con el monto borrado',
    /CORRECCION-BORRO-OFERTA\(15000\)/.test(borroOferta.notas), borroOferta.notas);
  check('se cuenta en senales para vigilarlo', borroOferta.senales.ofertasBorradas === 1);

  // CONTRACARA: reformular la oferta SI se permite. El guard compara el monto,
  // no el texto — si comparara la frase, romperia justo la libertad que se le dio.
  const reformulo = correr('Leer Verificador', { output: {
    aprobado: true, falla: 'ninguna', motivo: 'acorte',
    mensajeCorregido: 'Suelto: $19.500 c/u. Desde 6 unidades: $15.000 c/u.',
    queCorregi: 'lo acorte',
  } }, { 'Prompt Verificador': conOferta });
  check('reformular la oferta SI se permite', reformulo.correccionAplicada === true);
  check('la correccion reformulada es la que sale',
    /Desde 6 unidades/.test(reformulo.final), reformulo.final);

  // y borrar OTRA cosa (no una oferta) sigue estando permitido
  const borroRelleno = correr('Leer Verificador', { output: {
    aprobado: true, falla: 'ninguna', motivo: 'saque relleno',
    mensajeCorregido: '$19.500 por unidad. Llevando 6, $15.000 cada uno.',
    queCorregi: 'saque la frase de cierre',
  } }, { 'Prompt Verificador': conOferta });
  check('borrar relleno sigue permitido si la oferta queda',
    borroRelleno.correccionAplicada === true);

  // una correccion identica al original no cuenta como correccion
  const igual = correr('Leer Verificador', { output: {
    aprobado: true, falla: 'ninguna', motivo: 'ok', mensajeCorregido: base.borrador,
  } }, { 'Prompt Verificador': base });
  check('una correccion identica al original no se cuenta', igual.correccionAplicada === false);
}

// ── RIFAS: pack_unidades vs escalera de puntos ─────────────────────────
//
// Caso real (WhatsApp, 2026-07-29): "precio para 500 rifas" -> el bot dijo
// "$10.000 el pack de 100 unidades". El monto era CORRECTO (tramo minQty:500)
// pero la cantidad no: pack_unidades=100 sale del NOMBRE del producto
// ('Talonarios Rifas 100 numeros') y la escalera habla de rifas.
// Ademas los tramos son {minQty:500, maxQty:501} — puntos, no rangos: pidiendo
// 600 no caia en ninguno y se informaba el piso ($6.000, el de 100) como precio.
console.log('\n=== Rifas: pack fijo + escalera de puntos ===');
const FILA_RIFAS = {
  producto_id: 'rf1', nombre_canonico: 'Talonarios Rifas 100 numeros', score: '5.1',
  variante_id: 'rv1', variante: 'Escala de rifas 10x7cm', precio_lista: '0', unidad: 'Hoja',
  mostrable: false, solo_descuentos: false, por_pagina: false, por_pack: true,
  tiene_reglas: true, nicho: null,
  atributos: { unidad_venta: 'pack', pack_unidades: 100, multiplica: false },
  rangos_cantidad: [
    { value: 6000, minQty: 100, maxQty: 101 }, { value: 8000, minQty: 250, maxQty: 251 },
    { value: 10000, minQty: 500, maxQty: 501 }, { value: 14000, minQty: 1000, maxQty: 1001 },
  ],
};
const sobreRifas = (cant) => ({
  userMessage: 'Cual es el precio para ' + cant + ' rifas?',
  conversation: [{ role: 'user', content: 'Cual es el precio para ' + cant + ' rifas?' }],
  conversationId: 384, accountId: 1,
  seleccion: { terminos: ['rifas'], productos: [], cantidad: cant },
});
const rifas = (cant) => correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
  { 'Armar Candidatos': correr('Armar Candidatos', [FILA_RIFAS], { 'Leer Selector': sobreRifas(cant) }) });

const r500 = rifas(500);
check('500 rifas -> $10.000 (tramo correcto)', r500.hechos[0] && r500.hechos[0].monto === 10000,
  JSON.stringify(r500.hechos));
check('NO dice "el pack de 100" cuando el tramo manda',
  r500.hechos[0] && !/pack de 100/.test(r500.hechos[0].texto), r500.hechos[0] && r500.hechos[0].texto);
check('dice la cantidad del tramo (500)',
  r500.hechos[0] && /500 unidades/.test(r500.hechos[0].texto), r500.hechos[0] && r500.hechos[0].texto);

// 600 cae ENTRE dos puntos: antes daba el piso ($6.000) sin aclarar nada
const r600 = rifas(600);
check('600 rifas NO informa el piso ($6.000) como si fuera su precio',
  r600.hechos[0] && r600.hechos[0].monto !== 6000, JSON.stringify(r600.hechos));
check('600 rifas usa el escalon inferior ($10.000 de 500)',
  r600.hechos[0] && r600.hechos[0].monto === 10000, JSON.stringify(r600.hechos));
check('600 rifas ACLARA que el precio es por 500',
  r600.hechos[0] && /precio por 500 unidades/.test(r600.hechos[0].texto),
  r600.hechos[0] && r600.hechos[0].texto);

// ── LA LISTA DE PRECIOS ENTERA (ronda real 2026-07-29) ─────────────────
//
// Dos fallas con la misma causa: "600 rifas" decia solo $10.000 y se callaba
// que 1000 salen $14.000; y pidiendo "100 y 1000" en el mismo mensaje solo se
// resolvia UNA cantidad (hay un solo seleccion.cantidad).
console.log('\n=== Rifas: la lista de precios completa ===');
check('el hecho trae la lista entera', r600.hechos[0].listaPrecios !== null
  && r600.hechos[0].listaPrecios.length === 4, JSON.stringify(r600.hechos[0].listaPrecios));
check('la lista trae cantidad y monto formateado',
  ((r600.hechos[0].listaPrecios || [])[0] || {}).texto === '100: $6.000',
  JSON.stringify((r600.hechos[0].listaPrecios || [])[0]));
check('el prompt la muestra completa',
  /100: \$6\.000 · 250: \$8\.000 · 500: \$10\.000 · 1000: \$14\.000/.test(r600.promptAgente));
check('le dice que son cantidades fijas',
  /CANTIDADES FIJAS/.test(r600.promptAgente));
check('le dice que conteste TODAS las cantidades que pidio',
  /Si pidio VARIAS cantidades, contestá todas/.test(r600.promptAgente));
// sin esto el guard lee la tabla como plata inventada y tumba el mensaje
check('TODOS los montos de la lista quedan autorizados',
  [6000, 8000, 10000, 14000].every((n) => r600.montosAutorizados.includes(n)),
  JSON.stringify(r600.montosAutorizados));

// CONTRACARA: un rango CONTINUO no es una lista de precios. Mostrar
// "51-250: $88" es ruido — cualquier cantidad del rango paga lo mismo.
const FILA_CONT = {
  producto_id: 'ic1', nombre_canonico: 'Impresiones papel obra 75 gr', score: '4.0',
  variante_id: 'icv1', variante: 'doble faz bn', precio_lista: '150', unidad: 'Hoja',
  mostrable: false, solo_descuentos: false, por_pagina: true, por_pack: false,
  tiene_reglas: true, nicho: null,
  atributos: { unidad_venta: 'hoja', multiplica: true },
  rangos_cantidad: [
    { value: 150, minQty: 1, maxQty: 50 }, { value: 88, minQty: 51, maxQty: 250 },
    { value: 70, minQty: 251, maxQty: null },
  ],
};
const cont = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
  { 'Armar Candidatos': correr('Armar Candidatos', [FILA_CONT], { 'Leer Selector': {
    userMessage: 'imprimir 200 hojas doble faz', conversation: [],
    conversationId: 385, accountId: 1,
    seleccion: { terminos: ['obra'], productos: [], cantidad: 200 },
  } }) });
check('un rango continuo NO es lista de precios', cont.hechos[0].listaPrecios === null,
  JSON.stringify(cont.hechos[0].listaPrecios));
check('el rango continuo sigue dando su total limpio', cont.hechos[0].total === 17600,
  JSON.stringify(cont.hechos[0].total));
check('y el prompt no se ensucia con la tabla',
  !/CANTIDADES FIJAS/.test(cont.promptAgente));

// ── El compositor no ofrece pedidos, no pide archivos, no da razones ───
console.log('\n=== Prompt del compositor: prohibiciones ===');
{
  const sysComp = wf.nodes.find((n) => n.name === 'Agente Compositor')
    .parameters.options.systemMessage;
  check('tiene prohibido tomar pedidos', /NUNCA TOMAS UN PEDIDO/.test(sysComp));
  check('tiene prohibido pedir archivos', /NO PIDAS ARCHIVOS/.test(sysComp));
  check('tiene prohibido inventar la causa de un dato faltante',
    /NO INVENTES POR QUE FALTA UN DATO/.test(sysComp));
  // el prompt de Calcular Montos ya no le sugiere la frase de los recargos
  const jsCalc = nodo('Calcular Montos').parameters.jsCode;
  check('el prompt ya NO sugiere "hay recargos que dependen del trabajo"',
    !/hay recargos que dependen del trabajo'/.test(jsCalc));
}

// ── El telefono no se ofrece: al local no se contesta ──────────────────
console.log('\n=== Canales: fuera el telefono ===');
{
  const conTel = wf.nodes.filter((n) => /476-0019|\(0223\)/.test(JSON.stringify(n.parameters || {})));
  check('ningun nodo ofrece el telefono', conTel.length === 0,
    conTel.map((n) => n.name).join(', '));
  const esc = wf.nodes.find((n) => n.name === 'Mensaje Escalación');
  const txt = JSON.stringify(esc.parameters);
  check('la escalacion sigue ofreciendo el mail', /terminalgrafica@gmail\.com/.test(txt));
  check('la escalacion sigue ofreciendo el local', /Rodríguez Peña 3865/.test(txt));
}

// ── TOTALES (decision de Martin 2026-07-29) ────────────────────────────
//
// Reemplaza la politica del 2026-07-28 ("no se da el total: multiplicar
// sub-cotizaria por el recargo UV"). Ahora se cotiza cerrado donde NO hay
// recargo posible. Tres condiciones: no es UV, multiplica=true, y la cantidad
// que dijo el cliente esta EN LA MISMA UNIDAD en que se cobra.
console.log('\n=== Totales: solo donde no hay recargo posible ===');
{
  const conCantidad = (cant) => ({
    userMessage: 'quiero ' + cant + ' hojas doble faz',
    conversation: [{ role: 'user', content: 'quiero ' + cant + ' hojas doble faz' }],
    conversationId: 385, accountId: 1, avisoDado: false,
    seleccion: { terminos: ['obra 75'], productos: [], cantidad: cant },
  });
  // impresiones: por hoja, multiplica, sin UV -> SI hay total
  const FILA_IMPR = { ...FILAS[1], atributos: { unidad_venta: 'hoja', multiplica: true } };
  const impr = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
    { 'Armar Candidatos': correr('Armar Candidatos', [FILA_IMPR], { 'Leer Selector': conCantidad(200) }) });
  const hi = impr.hechos[0];
  check('200 hojas x $88 -> total $17.600', hi && hi.total === 17600, JSON.stringify(hi));
  check('el total viaja como texto listo para copiar',
    hi && /17\.600 por 200 unidades/.test(hi.totalTexto || ''), hi && hi.totalTexto);
  check('el total esta AUTORIZADO (si no, el guard lo marca inventado)',
    (impr.montosAutorizados || []).includes(17600), JSON.stringify(impr.montosAutorizados));
  check('el unitario sigue autorizado', (impr.montosAutorizados || []).includes(88));
  check('el prompt le da el total ya calculado',
    /TOTAL YA CALCULADO/.test(impr.promptAgente));

  // ANILLADO: unidad_venta=trabajo con multiplica=true. El `true` significa
  // "3 anillados salen 3x", NO "x120 hojas". Es el 120x del lado del total.
  const anill = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
    { 'Armar Candidatos': correr('Armar Candidatos', [FILAS_ANILLADO[0]],
      { 'Leer Selector': { ...SOBRE_ANILLADO, seleccion: { ...SOBRE_ANILLADO.seleccion, cantidad: 120 } } }) });
  const ha2 = anill.hechos[0];
  check('anillar 120 hojas NO da total (la cantidad no son anillados)',
    ha2 && ha2.total === null, JSON.stringify(ha2));
  check('NO aparece $288.000 en ningun lado',
    !/288\.000|288000/.test(JSON.stringify(anill)), 'el 120x volvio');
  check('dice POR QUE no hay total', ha2 && ha2.motivoSinTotal === 'unidad_distinta',
    ha2 && ha2.motivoSinTotal);
  check('el prompt le explica la razon al compositor',
    /SOBRE EL TOTAL/.test(anill.promptAgente) && /NO son unidades de este producto/.test(anill.promptAgente));

  // PACK: multiplica=false. El precio ES el pack, multiplicarlo lo cobraria N veces.
  const pk = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
    { 'Armar Candidatos': correr('Armar Candidatos',
      [{ ...FILAS_PACK[0], atributos: { ...FILAS_PACK[0].atributos, multiplica: false } }],
      { 'Leer Selector': { ...SOBRE_PACK, seleccion: { ...SOBRE_PACK.seleccion, cantidad: 100 } } }) });
  check('un pack NO se multiplica por sus unidades', pk.hechos[0] && pk.hechos[0].total === null,
    JSON.stringify(pk.hechos[0]));
  check('dice que el precio ya es por el pack', pk.hechos[0] && pk.hechos[0].motivoSinTotal === 'no_multiplica');

  // UV: ya NO se excluye del total (Martin, 2026-07-31). Antes habia una tercera
  // condicion `tecnologia === 'uv'` que lo bloqueaba, porque el precio guardado
  // es el BASE y el recargo lo pone el taller. Se saco: el cliente que pregunta
  // "cuanto sale una lona de 3x2" tiene que recibir el total.
  //
  // DEUDA: cuando existan las variantes con recargo (UV exterior, UV blanco,
  // barniz), cada una trae su precio y este total pasa a ser exacto tambien
  // para esos casos. Hoy es el precio del trabajo sin adicionales.
  //
  // Se chequea con unidad_venta='unidad' porque es lo que aisla el cambio: con
  // 'm2' el total caeria igual por `cantidadEsLaUnidad` (la cantidad no esta en
  // la unidad de cobro) y el test pasaria sin probar nada sobre UV.
  const FILA_UV = { ...FILAS[1], nombre_canonico: 'Vinilo, Lona Brillo/Mate Uv',
    precio_lista: '26000', rangos_cantidad: null, por_pagina: false,
    atributos: { unidad_venta: 'unidad', multiplica: true, tecnologia: 'uv' } };
  const uv = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
    { 'Armar Candidatos': correr('Armar Candidatos', [FILA_UV], { 'Leer Selector': conCantidad(5) }) });
  check('UV SI se totaliza (exclusion eliminada 2026-07-31)',
    uv.hechos[0] && uv.hechos[0].total === 130000, JSON.stringify(uv.hechos[0]));
  check('ya no hay motivo "uv"', uv.hechos[0] && uv.hechos[0].motivoSinTotal === null,
    uv.hechos[0] && uv.hechos[0].motivoSinTotal);
  check('el total de UV queda autorizado (si no, el guard lo tumba)',
    (uv.montosAutorizados || []).includes(130000), JSON.stringify(uv.montosAutorizados));

  // el m2 sigue sin totalizar, pero por la OTRA condicion: la cantidad que dijo
  // el cliente no esta en la unidad en que se cobra.
  const uvM2 = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
    { 'Armar Candidatos': correr('Armar Candidatos',
      [{ ...FILA_UV, atributos: { ...FILA_UV.atributos, unidad_venta: 'm2' } }],
      { 'Leer Selector': conCantidad(5) }) });
  check('el m2 no totaliza por unidad_distinta, no por UV',
    uvM2.hechos[0] && uvM2.hechos[0].total === null
    && uvM2.hechos[0].motivoSinTotal === 'unidad_distinta',
    uvM2.hechos[0] && uvM2.hechos[0].motivoSinTotal);

  // sin cantidad no hay total que dar
  const sinCant = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
    { 'Armar Candidatos': correr('Armar Candidatos', [FILA_IMPR],
      { 'Leer Selector': { ...conCantidad(200), seleccion: { terminos: [], productos: [], cantidad: null } } }) });
  check('sin cantidad no hay total', sinCant.hechos[0] && sinCant.hechos[0].total === null);
  check('sin cantidad tampoco hay motivo (no aplica)',
    sinCant.hechos[0] && sinCant.hechos[0].motivoSinTotal === null);

  // el verificador tiene que ver el total, si no lo tumba como inventado
  const pvTot = correr('Prompt Verificador', {}, { 'Leer Compositor': {
    ...impr, borrador: 'Son $88 por página, $17.600 por las 200.',
    conversation: conCantidad(200).conversation, seleccion: conCantidad(200).seleccion,
  } });
  check('el verificador ve el TOTAL AUTORIZADO', /TOTAL AUTORIZADO/.test(pvTot.promptAgente));
  check('el verificador sabe que lo calculo el codigo',
    /los calculo el codigo/.test(pvTot.promptAgente));
  check('el guard NO marca el total como inventado',
    (pvTot.numerosNoAutorizados || []).length === 0, JSON.stringify(pvTot.numerosNoAutorizados));
}

// ── AVISO DE CANAL: una vez por conversacion ───────────────────────────
console.log('\n=== Aviso de canal (una sola vez) ===');
{
  const FILA_IMPR = { ...FILAS[1], atributos: { unidad_venta: 'hoja', multiplica: true } };
  // EL FLAG SE MOCKEA EN `Decidir`, NO EN EL SOBRE.
  //
  // Antes este fixture lo ponia en el sobre de `Leer Selector` y pasaba — pero en
  // produccion el mail se tipeo DOS VECES en la misma conversacion (2026-07-29).
  // El test mentia: al armar el sobre a mano garantizaba una propagacion que en
  // el flujo real atraviesa 7 nodos, y cualquiera que no copie la clave la deja
  // en undefined (=falso, "primera vez", siempre). El nodo ahora lee
  // $('Decidir') por nombre, asi que el test tiene que mockear ESE nodo.
  const conAviso = (avisoDado) => correr('Calcular Montos',
    { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
    {
      'Decidir': { avisoDado },
      'Armar Candidatos': correr('Armar Candidatos', [FILA_IMPR], { 'Leer Selector': {
        userMessage: 'cuanto sale?', conversation: [], conversationId: 386, accountId: 1,
        seleccion: { terminos: ['obra'], productos: [], cantidad: 200 },
      } }),
    });

  const primera = conAviso(false);
  check('la 1a vez le pide cerrar con el canal', /CERRA CON EL CANAL/.test(primera.promptAgente));
  check('nombra el mail', /terminalgrafica@gmail\.com/.test(primera.promptAgente));

  const repetida = conAviso(true);
  check('la 2a vez le prohibe repetirlo', /NO repitas que el canal es informativo/.test(repetida.promptAgente));
  check('la 2a vez NO le pide cerrar con el canal', !/CERRA CON EL CANAL/.test(repetida.promptAgente));

  // EL FLAG NO PUEDE VENIR DEL SOBRE. Este es el test que faltaba: si alguien
  // vuelve a leer `d.avisoDado`, el sobre dice true y Decidir dice false, asi
  // que el mail se repetiria. Gana Decidir.
  const soloEnSobre = correr('Calcular Montos',
    { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
    {
      'Decidir': { avisoDado: false },
      'Armar Candidatos': correr('Armar Candidatos', [FILA_IMPR], { 'Leer Selector': {
        userMessage: 'cuanto sale?', conversation: [], conversationId: 386, accountId: 1,
        avisoDado: true,   // el sobre miente
        seleccion: { terminos: ['obra'], productos: [], cantidad: 200 },
      } }),
    });
  check('el flag sale de Decidir, no del sobre heredado',
    /CERRA CON EL CANAL/.test(soloEnSobre.promptAgente));
}

// ── EL ENVIO PUEDE FALLAR Y EL LOG NO PUEDE MENTIR ─────────────────────
//
// Caso real (2026-07-29): Chatwoot devolvio "Service temporarily unavailable",
// el cliente nunca recibio la respuesta, y como el nodo tiene
// onError:continueRegularOutput el flujo siguio como si todo hubiera salido
// bien — Log Turno escribio el mensaje en `final` y la base afirmaba una entrega
// que no ocurrio. Martin lo descubrio mirando WhatsApp y reenvio a mano.
console.log('\n=== Chequear Envio: el log no puede mentir ===');
{
  const SOBRE_V = {
    conversationId: 382, accountId: 1, userMessage: 'cuanto sale?',
    final: 'Sale $800 la hoja.', accion: 'respuesta_verificada',
    notas: 'v10-agents falla=ninguna', senales: { nHechos: 1 },
  };

  // Chatwoot acepto: devuelve el mensaje creado con su id
  const ok = correr('Chequear Envio', { id: 99123, content: 'Sale $800 la hoja.' },
    { 'Leer Verificador': SOBRE_V });
  check('con id de Chatwoot se considera entregado', ok.entregado === true);
  check('guarda el id para poder rastrearlo', ok.idMensajeChatwoot === 99123);
  check('la accion no se toca', ok.accion === 'respuesta_verificada');
  check('no ensucia las notas', !/ENVIO-FALLIDO/.test(ok.notas));

  // EL CASO DEL 503: el nodo emite el item de error, sin id
  const err = correr('Chequear Envio',
    { error: { message: 'Service temporarily unavailable' } },
    { 'Leer Verificador': SOBRE_V });
  check('un 503 NO se considera entregado', err.entregado === false);
  check('la accion pasa a envio_fallido (el log deja de mentir)',
    err.accion === 'envio_fallido', err.accion);
  check('el motivo queda en las notas',
    /ENVIO-FALLIDO\(Service temporarily unavailable\)/.test(err.notas), err.notas);
  check('queda en senales para poder contarlos', err.senales.envioFallido === true);

  // SIN id Y SIN error: tampoco se creo nada. Es el caso silencioso.
  const vacio = correr('Chequear Envio', {}, { 'Leer Verificador': SOBRE_V });
  check('sin id de mensaje tampoco se da por entregado', vacio.entregado === false);
  check('lo dice explicito en las notas',
    /no devolvio id/.test(vacio.notas), vacio.notas);

  // el sobre del verificador tiene que llegar intacto: Log Turno lee de ACA
  check('conserva las columnas que Log Turno mapea',
    ok.conversationId === 382 && ok.final === 'Sale $800 la hoja.');
}

// ── El compositor cotiza, pero no calcula ──────────────────────────────
console.log('\n=== Prompt del compositor: cotiza sin calcular ===');
{
  const sysComp = wf.nodes.find((n) => n.name === 'Agente Compositor')
    .parameters.options.systemMessage;
  check('se le permite dar totales', /COTIZAS TOTALES/.test(sysComp));
  check('pero tiene prohibido calcularlos', /NUNCA/.test(sysComp) && /lo multiplicas vos/.test(sysComp));
  check('sigue prohibido tomar pedidos', /NUNCA TOMAS UN PEDIDO/.test(sysComp));
}

// ── solo_descuentos ES TELEMETRIA, NO SILENCIO ─────────────────────────
//
// Bug del 2026-07-29 ("papel kraft a4" -> "los precios de lista no se
// publican"). El flag toca 54 variantes en 21 productos (folletos, laser color,
// plastificados, tarjetas) y TODAS tienen precio cargado. La spec original
// (db/precio-freshness.sql) dice "telemetria... precio_lista es TECHO" y
// "resto (discount/supercharge) -> numero de lista + caveat neutro".
console.log('\n=== solo_descuentos: se dice el precio + caveat ===');
{
  const FILA_KRAFT = {
    producto_id: 'kr1', nombre_canonico: 'Papel Kraft 130 Gr', score: '5.0',
    variante_id: 'kv1', variante: 'A4', precio_lista: '800', unidad: 'Hoja',
    mostrable: true, solo_descuentos: true, por_pagina: false, por_pack: false,
    tiene_reglas: false, nicho: null, rangos_cantidad: null,
    atributos: { unidad_venta: 'hoja', multiplica: true },
  };
  const SOBRE_KRAFT = {
    userMessage: 'papel kraft a4', conversation: [{ role: 'user', content: 'papel kraft a4' }],
    conversationId: 387, accountId: 1, avisoDado: false,
    seleccion: { terminos: ['papel kraft'], productos: [], cantidad: null },
  };
  const armK = correr('Armar Candidatos', [FILA_KRAFT], { 'Leer Selector': SOBRE_KRAFT });
  const kraft = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
    { 'Armar Candidatos': armK });

  check('el precio SE DICE (antes moria en caveat)', kraft.hechos.length === 1,
    JSON.stringify(kraft.hechos));
  check('el monto es $800', kraft.hechos[0] && kraft.hechos[0].monto === 800);
  check('$800 queda autorizado', (kraft.montosAutorizados || []).includes(800));
  check('avisa que puede haber un precio mejor',
    kraft.caveats.some((c) => /precio mejor/.test(c.nota)), JSON.stringify(kraft.caveats));
  check('el caveat NO dice que no se publica',
    !kraft.caveats.some((c) => /no se publica/.test(c.nota)), JSON.stringify(kraft.caveats));
  check('el prompt del compositor trae el precio',
    /\$800/.test(kraft.promptAgente), kraft.promptAgente.slice(0, 200));

  // el candidato no puede decir "solo con descuento": el agente lo leia como
  // "no se puede cotizar"
  check('el candidato NO dice "solo con descuento"',
    !/solo con descuento/.test(armK.promptAgente), armK.promptAgente.split('\n')[3]);
  check('el candidato dice que el precio es el TECHO',
    /TECHO/.test(armK.promptAgente), armK.promptAgente.split('\n')[3]);

  // el verificador tiene que saber que decirlo es correcto
  const pvK = correr('Prompt Verificador', {}, { 'Leer Compositor': {
    ...kraft, borrador: 'El papel kraft A4 sale $800 la hoja.',
    conversation: SOBRE_KRAFT.conversation, seleccion: SOBRE_KRAFT.seleccion,
  } });
  check('el verificador ve "hay descuentos posibles"',
    /hay descuentos posibles/.test(pvK.promptAgente));
  check('el verificador NO ve "solo_descuentos: true" crudo',
    !/solo_descuentos: true/.test(pvK.promptAgente));
  check('el prompt le dice que decir el precio es correcto',
    /NO rechaces un mensaje por decir el precio/.test(pvK.promptAgente));
  check('el guard no marca $800 como inventado',
    (pvK.numerosNoAutorizados || []).length === 0, JSON.stringify(pvK.numerosNoAutorizados));

  // NO se calcula el descuento (decision de Martin): solo se avisa
  check('NO intenta calcular el descuento',
    !kraft.caveats.some((c) => /\d+\s*%/.test(c.nota)), JSON.stringify(kraft.caveats));
}

// ── Flags que se ignoran A PROPOSITO (que nadie los "arregle") ─────────
console.log('\n=== Flags de precio ignorados por decision ===');
{
  const FILA_OVERRIDE = {
    producto_id: 'op1', nombre_canonico: 'OPP Brillo', score: '4.5',
    variante_id: 'ov1', variante: '.', precio_lista: '2400', unidad: 'Hoja',
    mostrable: true, solo_descuentos: false, por_pagina: false, por_pack: false,
    tiene_reglas: false, tiene_override: true, nicho: null, rangos_cantidad: null,
    atributos: { unidad_venta: 'hoja', multiplica: true },
  };
  const sobreOv = {
    userMessage: 'cuanto sale opp brillo', conversation: [], conversationId: 388, accountId: 1,
    seleccion: { terminos: ['opp brillo'], productos: [], cantidad: null },
  };
  const ovr = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
    { 'Armar Candidatos': correr('Armar Candidatos', [FILA_OVERRIDE], { 'Leer Selector': sobreOv }) });
  // decision de Martin: se dice el precio de lista SIN considerar el override
  check('tiene_override NO silencia el precio (se dice la lista)',
    ovr.hechos.length === 1 && ovr.hechos[0].monto === 2400, JSON.stringify(ovr.hechos));

  // precio viejo: la regla de frescura se elimino, el precio se dice igual
  const FILA_VIEJA = { ...FILA_OVERRIDE, tiene_override: false,
    precio_actualizado: '2025-01-01T00:00:00+00:00' };
  const vieja = correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
    { 'Armar Candidatos': correr('Armar Candidatos', [FILA_VIEJA], { 'Leer Selector': sobreOv }) });
  check('un precio viejo se dice igual (regla de frescura eliminada)',
    vieja.hechos.length === 1 && vieja.hechos[0].monto === 2400, JSON.stringify(vieja.hechos));
}

console.log('\n' + '='.repeat(58));
console.log(fallos ? 'FALLA: ' + fallos + ' de ' + (ok + fallos) : 'TODO OK: ' + ok + ' casos');
process.exit(fallos ? 1 : 0);
