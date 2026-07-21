// Harness de runtime para los nodos Code de faq-bot-v6.json (Parsear Respuesta +
// Armar Respuesta Precio). node --check solo valida sintaxis; esto EJECUTA el codigo
// con mocks de $ / $input y cubre los caminos: answer, backstop 1a mencion, precio
// single, campo mas, JSON ilegible, plata tipeada, limpio, caveat, tabla de rangos,
// mas mixto, sql_error, backstop dorso y rank filter.
// Correr tras CUALQUIER edicion de esos nodos:  node tests/code-harness.js
// (Nacido del incidente 2026-07-21: "obj is not defined" — scope bug invisible para --check.)
const fs = require('fs');
const path = require('path');
const WF = path.join(__dirname, '..', 'n8n', 'flows', 'faq-bot-v6.json');
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
const jsOf = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;
const CODES = { 'parsear.js': jsOf('Parsear Respuesta'), 'armar.js': jsOf('Armar Respuesta Precio') };

function runNodeCode(file, mocks) {
  const code = CODES[file];
  const fn = new Function('$', '$input', 'return (async () => {\n' + code + '\n})()');
  return fn(mocks.$, mocks.$input);
}

const decidir = (over = {}) => ({ conversationId: 9, accountId: 1, userMessage: 'hola', avisoDado: false, lastBotReplies: [], ...over });

async function main() {
  // ===== PARSEAR =====
  const parsear = (llmContent, dec) => runNodeCode('parsear.js', {
    $: (name) => ({ first: () => ({ json: name === 'Decidir' ? dec : {} }) }),
    $input: { first: () => ({ json: { choices: [{ message: { content: llmContent } }] } }), all: () => [] },
  });

  let r;
  r = await parsear(JSON.stringify({ action: 'answer', reply: 'Hola, tenemos A4 y A3.', motivo: '' }), decidir());
  console.log('P1 answer:', r[0].json.action === 'answer' ? 'OK' : 'FAIL ' + JSON.stringify(r[0].json));

  r = await parsear(JSON.stringify({ action: 'answer', reply: 'Escribinos a terminalgrafica@gmail.com con eso.', motivo: '' }), decidir({ avisoDado: true }));
  console.log('P2 backstop mail:', r[0].json.reply.includes('nuestro mail') && !r[0].json.reply.includes('@') ? 'OK' : 'FAIL ' + r[0].json.reply);

  r = await parsear(JSON.stringify({ action: 'precio', producto: 'Carteleria en Pvc c/ Papel obra/130 gr', variante: 'A3*', reply: 'La A3 sale {{PRECIO}}. ¿Algo más?' }), decidir());
  console.log('P3 precio single:', r[0].json.action === 'precio' && r[0].json.precio.variante === 'A3' && r[0].json.precio.forzarPlantilla === false && Array.isArray(r[0].json.precio.mas) && r[0].json.precio.mas.length === 0 ? 'OK' : 'FAIL ' + JSON.stringify(r[0].json.precio));

  r = await parsear(JSON.stringify({ action: 'precio', producto: 'Carteleria en Pvc c/ Papel obra/130 gr', variante: 'A3', reply: 'La A3 sale {{PRECIO}}.', mas: [{ producto: 'Impresión Autocad lineal Color/Negro', variante: 'A4' }] }), decidir());
  console.log('P4 precio mas:', r[0].json.precio.mas.length === 1 && r[0].json.precio.mas[0].variante === 'A4' ? 'OK' : 'FAIL ' + JSON.stringify(r[0].json.precio));

  r = await parsear('esto no es json', decidir());
  console.log('P5 ilegible:', r[0].json.action === 'handoff' ? 'OK' : 'FAIL');

  r = await parsear(JSON.stringify({ action: 'precio', producto: 'X', variante: 'A4', reply: 'Sale $500 o {{PRECIO}}.' }), decidir());
  console.log('P6 plata tipeada:', r[0].json.precio.forzarPlantilla === true ? 'OK' : 'FAIL');

  // ===== ARMAR =====
  const armar = (precioObj, rows, dec, errored) => runNodeCode('armar.js', {
    $: (name) => ({ first: () => ({ json: name === 'Decidir' ? dec : { precio: precioObj, conversationId: 9, accountId: 1, userMessage: dec.userMessage } }) }),
    $input: { all: () => rows.map((j) => ({ json: j })).concat(errored ? [{ json: { error: { message: 'column x does not exist' } } }] : []), first: () => ({ json: rows[0] || {} }) },
  });

  const base = { idx: 1, mostrable: true, solo_descuentos: false, tiene_reglas: false, tiene_override: false, n_reglas_cantidad: 0, rangos_cantidad: null, unidad: 'Hoja', precio_actualizado: new Date().toISOString(), producto_id: 'u1', variante: 'A3', nombre_canonico: 'Carteleria en Pvc c/ Papel obra/130 gr', match_rank: 1, precio_lista: 13000 };
  const pBase = { producto: 'Carteleria en Pvc c/ Papel obra/130 gr', variante: 'A3', template: 'La A3 sale {{PRECIO}}. ¿Algo más?', forzarPlantilla: false, mas: [] };

  r = await armar(pBase, [base], decidir({ userMessage: 'precio a3?' }));
  console.log('A1 limpio:', r[0].json.reply.includes('$13.000,00') && !r[0].json.reply.includes('precio de lista;') ? 'OK' : 'FAIL ' + r[0].json.reply);

  r = await armar(pBase, [{ ...base, mostrable: false, tiene_reglas: true, solo_descuentos: true, precio_lista: 800 }], decidir({ userMessage: 'precio?' }));
  console.log('A2 caveat:', r[0].json.reply.includes('$800,00 (precio de lista;') ? 'OK' : 'FAIL ' + r[0].json.reply);

  const rangosRow = { ...base, mostrable: false, tiene_reglas: true, n_reglas_cantidad: 1, rangos_cantidad: [{ value: 500, minQty: 1, maxQty: 50 }, { value: 450, minQty: 51, maxQty: 150 }, { value: 400, minQty: 501, maxQty: null }], variante: '.', unidad: 'a3', precio_lista: 500, nombre_canonico: 'Impresiones a3 tonner negro' };
  r = await armar({ ...pBase, producto: 'Impresiones a3 tonner negro', variante: 'única' }, [rangosRow], decidir({ userMessage: 'cuanto salen?' }));
  const rep = r[0].json.reply;
  console.log('A3 rangos:', rep.includes('- 1 a 50: $500,00 c/u') && rep.includes('501 o más') && !rep.includes('. de') && !rep.includes('por a3') && !rep.includes('El precio final') ? 'OK' : 'FAIL\n' + rep);

  r = await armar({ ...pBase, mas: [{ producto: 'Impresiones a3 tonner negro', variante: 'única' }, { producto: 'NoExiste', variante: 'X' }] },
    [base, { ...rangosRow, idx: 2 }], decidir({ userMessage: 'precios?' }));
  const rep2 = r[0].json.reply;
  console.log('A4 mas mixto:', rep2.includes('$13.000,00') && rep2.includes('va por cantidad') && rep2.includes('NoExiste te lo cotiza el equipo por mail') && r[0].json.notas.includes('|| mas:') ? 'OK' : 'FAIL\n' + rep2 + '\n' + r[0].json.notas);

  r = await armar(pBase, [], decidir({ userMessage: 'precio?' }), true);
  console.log('A5 sql_error:', r[0].json.estado === 'fallback: sql_error' && r[0].json.notas.includes('column x') ? 'OK' : 'FAIL ' + r[0].json.estado);

  r = await armar(pBase, [base], decidir({ userMessage: 'la a3 pero doble faz cuanto sale?' }));
  console.log('A6 dorso:', r[0].json.estado === 'fallback: dorso' && !r[0].json.reply.includes('$') ? 'OK' : 'FAIL ' + r[0].json.estado);

  r = await armar(pBase, [base, { ...base, match_rank: 2, variante: 'A3', producto_id: 'u2' }], decidir({ userMessage: 'precio?' }));
  console.log('A7 rank filter:', r[0].json.reply.includes('$13.000,00') && r[0].json.filasSql === 2 ? 'OK' : 'FAIL ' + r[0].json.estado + ' ' + r[0].json.filasSql);

  r = await armar({ ...pBase, template: 'El precio de lista es {{PRECIO}}.' },
    [{ ...base, mostrable: false, tiene_reglas: true, solo_descuentos: true, precio_lista: 2200 }], decidir({ userMessage: 'precio?' }));
  const rep3 = r[0].json.reply;
  console.log('A8 anti-eco:', rep3.includes('$2.200,00 (el precio final') && !rep3.includes('(precio de lista;') ? 'OK' : 'FAIL ' + rep3);
  r = await armar({ ...pBase, producto: 'Impresiones a3 tonner negro', variante: 'única' },
    [{ ...base, mostrable: false, tiene_reglas: true, n_reglas_cantidad: 1, rangos_cantidad: [{ value: 500, minQty: 1, maxQty: 50 }], variante: '.', unidad: 'a3', nombre_canonico: 'Impresiones a3 tonner negro' }],
    decidir({ userMessage: 'que sale?' }));
  console.log('A9 única oculta:', r[0].json.reply.startsWith('Impresiones a3 tonner negro, precio de lista según cantidad:') && !/única de/i.test(r[0].json.reply) ? 'OK' : 'FAIL ' + r[0].json.reply.split('\n')[0]);

  // A10: replay del hallazgo de Martin (ronda 2) — el LLM ecoa el nombre COMPLETO del
  // producto como variante sobre un mono-variante "." -> el encabezado no debe duplicar
  // ("X de X"). vv se resuelve SOLO desde row.variante (DB), nunca desde el eco.
  r = await armar({ ...pBase, producto: 'Impresiones a3 tonner negro', variante: 'Impresiones a3 tonner negro' },
    [rangosRow], decidir({ userMessage: 'necesito 200 impresiones a3 en tonner negro, cuánto me sale?' }));
  console.log('A10 eco producto como variante:', r[0].json.reply.startsWith('Impresiones a3 tonner negro, precio de lista según cantidad:') && !r[0].json.reply.includes(' de Impresiones') ? 'OK' : 'FAIL ' + r[0].json.reply.split('\n')[0]);

  // A11: mismo eco pero en un extra de 'mas' (camino vvx).
  r = await armar({ ...pBase, mas: [{ producto: 'Sellos automáticos', variante: 'Sellos automáticos' }] },
    [base, { ...base, idx: 2, variante: '.', nombre_canonico: 'Sellos automáticos', precio_lista: 9000, producto_id: 'u3' }],
    decidir({ userMessage: 'precios?' }));
  console.log('A11 eco extra:', r[0].json.reply.includes('Sellos automáticos sale $9.000,00') && !r[0].json.reply.includes('La opción Sellos') ? 'OK' : 'FAIL ' + r[0].json.reply);

}
main().then(() => console.log('HARNESS DONE')).catch((e) => { console.error('HARNESS CRASH:', e); process.exit(1); });
