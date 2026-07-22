// Harness de runtime para los nodos Code de faq-bot-v7.json (Parsear Respuesta +
// Armar Respuesta Precio). node --check solo valida sintaxis; esto EJECUTA el codigo
// con mocks de $ / $input y cubre los caminos: answer, backstop 1a mencion, precio
// single, campo mas, JSON ilegible, plata tipeada, limpio, caveat, tabla de rangos,
// mas mixto, sql_error, backstop dorso, rank filter y el cotizador v7 (totales,
// paginas/copias, gates df/cap/por_pagina, extras con cantidad).
// Correr tras CUALQUIER edicion de esos nodos:  node tests/code-harness.js
// (Nacido del incidente 2026-07-21: "obj is not defined" — scope bug invisible para --check.)
const fs = require('fs');
const path = require('path');
const WF = path.join(__dirname, '..', 'n8n', 'flows', 'faq-bot-v7.json');
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

  // P7: hallazgo R1 ronda 2 — el LLM escribe la direccion CON lead-in ("a nuestro email X");
  // la cascada debe colapsar todo a "a nuestro mail", sin Frankenstein "email nuestro mail".
  r = await parsear(JSON.stringify({ action: 'answer', reply: 'Para cotizarlo, envíanos el archivo a nuestro email terminalgrafica@gmail.com. El equipo lo revisará.', motivo: '' }), decidir({ avisoDado: true }));
  console.log('P7 lead-in email:', r[0].json.reply.includes('a nuestro mail.') && !r[0].json.reply.includes('email nuestro mail') && !r[0].json.reply.includes('@') ? 'OK' : 'FAIL ' + r[0].json.reply);

  // P8: la clase gemela con "dirección (de correo)".
  r = await parsear(JSON.stringify({ action: 'answer', reply: 'Escribinos a nuestra dirección de correo terminalgrafica@gmail.com con el detalle.', motivo: '' }), decidir({ avisoDado: true }));
  console.log('P8 lead-in dirección:', r[0].json.reply.includes('a nuestro mail con el detalle') && !r[0].json.reply.includes('dirección') && !r[0].json.reply.includes('@') ? 'OK' : 'FAIL ' + r[0].json.reply);

  // P9/P10: campo cantidad (v10.7) — entero valido pasa (tambien como string numerica); basura -> null.
  r = await parsear(JSON.stringify({ action: 'precio', producto: 'Impresiones a3 tonner negro', variante: 'única', cantidad: 200, reply: 'Salen {{PRECIO}}.' }), decidir());
  console.log('P9 cantidad:', r[0].json.precio.cantidad === 200 ? 'OK' : 'FAIL ' + JSON.stringify(r[0].json.precio.cantidad));
  r = await parsear(JSON.stringify({ action: 'precio', producto: 'X', variante: 'A4', cantidad: 'unas 200', reply: '{{PRECIO}}' }), decidir());
  console.log('P10 cantidad basura:', r[0].json.precio.cantidad === null ? 'OK' : 'FAIL ' + r[0].json.precio.cantidad);

  // ===== ARMAR =====
  const armar = (precioObj, rows, dec, errored) => runNodeCode('armar.js', {
    $: (name) => ({ first: () => ({ json: name === 'Decidir' ? dec : { precio: precioObj, conversationId: 9, accountId: 1, userMessage: dec.userMessage } }) }),
    $input: { all: () => rows.map((j) => ({ json: j })).concat(errored ? [{ json: { error: { message: 'column x does not exist' } } }] : []), first: () => ({ json: rows[0] || {} }) },
  });

  const base = { idx: 1, mostrable: true, por_pagina: false, solo_descuentos: false, tiene_reglas: false, tiene_override: false, n_reglas_cantidad: 0, rangos_cantidad: null, unidad: 'Hoja', precio_actualizado: new Date().toISOString(), producto_id: 'u1', variante: 'A3', nombre_canonico: 'Carteleria en Pvc c/ Papel obra/130 gr', match_rank: 1, precio_lista: 13000 };
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

  // A12: replay OPP (ronda 2) — el LLM emite el RUBRO como producto y el producto como
  // variante; Get Precio v3 resuelve via rank 3. Mono "." con override -> email con la
  // razon VERDADERA (override, no sin_match) y el nombre canonico, no el rubro.
  r = await armar({ ...pBase, producto: 'Soportes Especiales', variante: 'OPP Mate/Holografico/Plata/Crystal/Glitter/Kraft' },
    [{ ...base, variante: '.', tiene_override: true, match_rank: 3, nombre_canonico: 'OPP Mate/Holografico/Plata/Crystal/Glitter/Kraft', precio_lista: 2500 }],
    decidir({ userMessage: 'Holografico' }));
  console.log('A12 rank3 override:', r[0].json.estado === 'fallback: override' && r[0].json.reply.includes('OPP Mate/Holografico') && !r[0].json.reply.includes('Soportes Especiales') && r[0].json.notas.includes('(resuelto por variante)') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.reply + ' | ' + r[0].json.notas);

  // A13: rank 3 sobre multi-variante -> TODAS las filas del producto = ambiguo honesto,
  // nombrando el producto resuelto (todas las filas comparten producto_id).
  r = await armar({ ...pBase, producto: 'Soportes Especiales', variante: 'Vinilos de Corte' },
    [{ ...base, variante: 'Chico', match_rank: 3, nombre_canonico: 'Vinilos de Corte', producto_id: 'u9' },
     { ...base, variante: 'Grande', match_rank: 3, nombre_canonico: 'Vinilos de Corte', producto_id: 'u9', precio_lista: 15000 }],
    decidir({ userMessage: 'vinilos' }));
  console.log('A13 rank3 ambiguo:', r[0].json.estado === 'fallback: ambiguo' && r[0].json.reply.includes('Vinilos de Corte') && !r[0].json.reply.includes('Soportes Especiales') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.reply);

  // A14: rank 3 sobre mono-variante SIN override -> numero real (la clase que antes
  // perdia un precio que el sistema si tenia).
  r = await armar({ ...pBase, producto: 'Soportes Especiales', variante: 'OPP Brillo' },
    [{ ...base, variante: '.', match_rank: 3, nombre_canonico: 'OPP Brillo', precio_lista: 2400 }],
    decidir({ userMessage: 'el brillo' }));
  console.log('A14 rank3 numero:', r[0].json.estado === 'ok' && r[0].json.reply.includes('$2.400,00') && r[0].json.notas.includes('(resuelto por variante)') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.reply);

  // A15: cantidad-first (v10.7) — borde INCLUSIVE del bracket (50 = maxQty del 1er rango)
  // -> numero unico con la cantidad DENTRO de la frase, nunca la tabla.
  r = await armar({ ...pBase, producto: 'Impresiones a3 tonner negro', variante: 'única', cantidad: 50 },
    [rangosRow], decidir({ userMessage: 'necesito 50 impresiones a3 en negro' }));
  console.log('A15 bracket borde:', r[0].json.estado === 'ok_bracket' && r[0].json.reply.includes('Por 50 unidades') && r[0].json.reply.includes('$500,00 c/u') && r[0].json.notas.includes('(cantidad=50)') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.reply);

  // A16: GAP entre brackets (rangosRow no cubre 151-500) -> tabla completa, NUNCA el precio base.
  r = await armar({ ...pBase, producto: 'Impresiones a3 tonner negro', variante: 'única', cantidad: 200 },
    [rangosRow], decidir({ userMessage: 'necesito 200' }));
  console.log('A16 gap→tabla:', r[0].json.estado === 'ok_rangos' && r[0].json.reply.includes('según cantidad:') && !r[0].json.reply.includes('Por 200') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.reply.split('\n')[0]);

  // A17: cantidad sobre precio FIJO -> se ignora en el render, queda en notas (telemetria
  // para la futura pregunta de descuentos por cantidad).
  r = await armar({ ...pBase, cantidad: 300 }, [base], decidir({ userMessage: '300 de la a3' }));
  console.log('A17 cantidad en fijo:', r[0].json.estado === 'ok' && r[0].json.reply.includes('$13.000,00') && r[0].json.notas.includes('(cantidad=300)') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.notas);

  // A18: stale ELIMINADO (fuente viva) — precio viejo ya no bloquea; airbag (precio>90d) en notas.
  r = await armar(pBase, [{ ...base, precio_actualizado: '2026-01-01T00:00:00Z' }], decidir({ userMessage: 'precio a3?' }));
  console.log('A18 sin stale + airbag:', r[0].json.estado === 'ok' && r[0].json.reply.includes('$13.000,00') && r[0].json.notas.includes('(precio>90d)') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.notas);

  // ===== v7 COTIZADOR =====
  // P11: paginas/copias validos (tambien como string numerica).
  r = await parsear(JSON.stringify({ action: 'precio', producto: 'IMPRESIONES', variante: 'simple faz b/n', paginas: '180', copias: 2, reply: 'Sale {{PRECIO}}.' }), decidir());
  console.log('P11 paginas/copias:', r[0].json.precio.paginas === 180 && r[0].json.precio.copias === 2 && r[0].json.precio.flags.length === 0 ? 'OK' : 'FAIL ' + JSON.stringify(r[0].json.precio));

  // P12: copias SIN paginas -> se ignoran ambos + flag de telemetria.
  r = await parsear(JSON.stringify({ action: 'precio', producto: 'X', variante: 'A4', copias: 3, reply: '{{PRECIO}}' }), decidir());
  console.log('P12 copias sin paginas:', r[0].json.precio.copias === null && r[0].json.precio.paginas === null && r[0].json.precio.flags.includes('copias_sin_paginas') ? 'OK' : 'FAIL ' + JSON.stringify(r[0].json.precio));

  // P13: cantidad en items de 'mas' (validacion tolerante; basura -> null).
  r = await parsear(JSON.stringify({ action: 'precio', producto: 'X', variante: 'A4', reply: '{{PRECIO}}', mas: [{ producto: 'Y', variante: 'B', cantidad: '150' }, { producto: 'Z', variante: 'C', cantidad: 'muchas' }] }), decidir());
  console.log('P13 mas cantidad:', r[0].json.precio.mas[0].cantidad === 150 && r[0].json.precio.mas[1].cantidad === null ? 'OK' : 'FAIL ' + JSON.stringify(r[0].json.precio.mas));

  // A19: ok_bracket ahora con TOTAL estimado (50 x $500 = $25.000) en la misma frase.
  r = await armar({ ...pBase, producto: 'Impresiones a3 tonner negro', variante: 'única', cantidad: 50 },
    [rangosRow], decidir({ userMessage: 'necesito 50 impresiones a3 en negro, total?' }));
  console.log('A19 bracket total:', r[0].json.estado === 'ok_bracket' && r[0].json.reply.includes('$500,00 c/u — total estimado $25.000,00') && r[0].json.notas.includes('(total=25000)') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.reply);

  // A20: modo paginas — bracket key = paginas, max() contra el lookup del total,
  // hint de volumen (copias>=2 y u(total)<u(paginas)). 30 pag x 2 copias: b1=$500
  // (1-50), b2(60)=$450 -> unit max = $500, total 60x500 = $30.000 + linea volumen.
  const ppRow = { ...rangosRow, por_pagina: true };
  r = await armar({ ...pBase, producto: 'Impresiones a3 tonner negro', variante: 'única', paginas: 30, copias: 2 },
    [ppRow], decidir({ userMessage: 'apuntes de 30 paginas, 2 copias' }));
  console.log('A20 paginas max+hint:', r[0].json.estado === 'ok_paginas' && r[0].json.reply.includes('Por 30 páginas x 2 copias (60 impresiones)') && r[0].json.reply.includes('$500,00 c/u — total estimado $30.000,00') && r[0].json.reply.includes('volumen total puede quedar mas abajo') && r[0].json.notas.includes('(paginas=30x2)') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.reply + ' | ' + r[0].json.notas);

  // A21: GAP en la key paginas (200 cae en 151-500) -> tabla completa, sin total, sin rescate.
  r = await armar({ ...pBase, producto: 'Impresiones a3 tonner negro', variante: 'única', paginas: 200, copias: 1 },
    [ppRow], decidir({ userMessage: 'libro de 200 paginas' }));
  console.log('A21 gap paginas:', r[0].json.estado === 'ok_rangos' && !r[0].json.reply.includes('total estimado') && r[0].json.notas.includes('(gap paginas)') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.notas);

  // A22: paginas sobre producto NO por_pagina -> se ignoran (jamas lona x 6 panios).
  r = await armar({ ...pBase, paginas: 6, copias: 1 }, [base], decidir({ userMessage: 'mi banner tiene 6 panios' }));
  console.log('A22 no por_pagina:', r[0].json.estado === 'ok' && !r[0].json.reply.includes('total estimado') && r[0].json.notas.includes('(paginas ignoradas: no por_pagina)') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.notas);

  // A23: gate doble faz — variante d/f + paginas -> TABLA sin total ni bracket + linea fija
  // (unidad pagina-vs-hoja desconocida hasta TG; ni el unitario del bracket es honesto).
  r = await armar({ ...pBase, producto: 'Impresiones a3 tonner negro', variante: 'doble faz b/n', paginas: 40, copias: 1 },
    [{ ...ppRow, variante: 'doble faz b/n' }], decidir({ userMessage: 'son 40 paginas doble faz' }));
  console.log('A23 df gate:', r[0].json.estado === 'ok_rangos' && r[0].json.reply.includes('El total del doble faz te lo confirma el equipo') && !r[0].json.reply.includes('total estimado') && r[0].json.notas.includes('(df_gate)') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.reply.split('\n').pop());

  // A24: cap comercial — cantidad absurda (20000 > 10000) -> tabla + linea volumen, sin total gigante.
  r = await armar({ ...pBase, producto: 'Impresiones a3 tonner negro', variante: 'única', cantidad: 20000 },
    [rangosRow], decidir({ userMessage: 'necesito 20000, total?' }));
  console.log('A24 cap volumen:', r[0].json.estado === 'ok_rangos' && r[0].json.reply.includes('Para ese volumen, el total te lo cotiza el equipo') && !r[0].json.reply.includes('total estimado') && r[0].json.notas.includes('(cap_volumen)') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.notas);

  // A25: ok_caveat con solo_descuentos=true -> total permitido (lista = techo garantizado),
  // plantilla FORZADA aunque haya template.
  r = await armar({ ...pBase, cantidad: 100 },
    [{ ...base, mostrable: false, tiene_reglas: true, solo_descuentos: true, precio_lista: 800 }], decidir({ userMessage: '100 en obra 106, total?' }));
  console.log('A25 caveat total:', r[0].json.estado === 'ok_caveat' && r[0].json.reply.includes('$800,00 c/u — por 100 unidades, total estimado $80.000,00') && !r[0].json.reply.includes('¿Algo más?') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.reply);

  // A26: ok_caveat con RECARGO posible (solo_descuentos=false) -> unitario + caveat, JAMAS total
  // (la lista seria piso: un total grande sub-cotiza — el agujero que cazo Fable r1).
  r = await armar({ ...pBase, cantidad: 100 },
    [{ ...base, mostrable: false, tiene_reglas: true, solo_descuentos: false, precio_lista: 800 }], decidir({ userMessage: '100 unidades, total?' }));
  console.log('A26 caveat sin total:', r[0].json.estado === 'ok_caveat' && !r[0].json.reply.includes('total estimado') && r[0].json.reply.includes('$800,00') && r[0].json.notas.includes('(cantidad=100)') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.reply);

  // A27: extra de 'mas' con cantidad y tabla -> bracket + total corto por item, sin gran total.
  r = await armar({ ...pBase, mas: [{ producto: 'Impresiones a3 tonner negro', variante: 'única', cantidad: 50 }] },
    [base, { ...rangosRow, idx: 2 }], decidir({ userMessage: 'la carteleria y 50 impresiones a3' }));
  console.log('A27 extra total:', r[0].json.reply.includes('$13.000,00') && r[0].json.reply.includes('por 50 unidades sale $500,00 c/u — total estimado $25.000,00') && !/total combinado|suma/i.test(r[0].json.reply) ? 'OK' : 'FAIL ' + r[0].json.reply);

  // A28: paginas con precio FIJO por_pagina (sin tabla), copias=1 -> total = paginas x lista,
  // plantilla forzada con el detalle en la frase.
  r = await armar({ ...pBase, paginas: 180, copias: 1 },
    [{ ...base, por_pagina: true, precio_lista: 100 }], decidir({ userMessage: 'documento de 180 paginas' }));
  console.log('A28 paginas fijo:', r[0].json.estado === 'ok' && r[0].json.reply.includes('$100,00 c/u — por 180 páginas, total estimado $18.000,00') && !r[0].json.reply.includes('x 1 copias') ? 'OK' : 'FAIL ' + r[0].json.estado + ' | ' + r[0].json.reply);

  // ===== v7 ronda 3: backstop papel_especial (recargos opt-in de papel) =====
  // A29: bookcel pedido sobre por_pagina -> sin numero (el recargo lo suma el mostrador).
  r = await armar({ ...pBase, producto: 'Impresiones a3 tonner negro', variante: 'única', cantidad: 300 },
    [{ ...rangosRow, por_pagina: true }], decidir({ userMessage: 'necesito 300 impresiones simple faz b/n en bookcel de color, total?' }));
  console.log('A29 bookcel:', r[0].json.estado === 'fallback: papel_especial' && !r[0].json.reply.includes('$') ? 'OK' : 'FAIL ' + r[0].json.estado);

  // A30: color nombrado SIN la palabra color (papel celeste) — el agujero grande de la regex corta.
  r = await armar({ ...pBase, cantidad: 300 },
    [{ ...base, por_pagina: true }], decidir({ userMessage: 'simple faz color en papel celeste, 300' }));
  console.log('A30 papel celeste:', r[0].json.estado === 'fallback: papel_especial' ? 'OK' : 'FAIL ' + r[0].json.estado);

  // A31: goldens de NO-match de la regex — variantes color legitimas y B1 no disparan;
  // y FUERA de por_pagina el backstop no existe (scope).
  r = await armar(pBase, [{ ...base, por_pagina: true }], decidir({ userMessage: 'la impresión a color simple faz color, cuánto sale?' }));
  const noMatch1 = r[0].json.estado === 'ok';
  r = await armar(pBase, [{ ...base, por_pagina: true }], decidir({ userMessage: 'a color en papel de obra, precio?' }));
  const noMatch2 = r[0].json.estado === 'ok';
  r = await armar(pBase, [base], decidir({ userMessage: 'carteleria en papel de color, precio?' }));
  const scopeOut = r[0].json.estado === 'ok';
  console.log('A31 regex goldens:', noMatch1 && noMatch2 && scopeOut ? 'OK' : 'FAIL ' + [noMatch1, noMatch2, scopeOut].join(','));

  // A32: upgrade vago de gramaje ("mas grueso") sobre por_pagina -> sin numero.
  r = await armar({ ...pBase, producto: 'Impresiones a3 tonner negro', variante: 'única' },
    [{ ...rangosRow, por_pagina: true }], decidir({ userMessage: 'y si me lo haces en un papel mas grueso, cuanto sale?' }));
  console.log('A32 mas grueso:', r[0].json.estado === 'fallback: papel_especial' ? 'OK' : 'FAIL ' + r[0].json.estado);

  // A33 (hallazgo suite-5 real): variante de la DB que se llama IGUAL que el producto
  // -> jamas "La opción X de X", ni en main ni en extras.
  r = await armar({ ...pBase, mas: [{ producto: 'Anillado Plastico a4/oficio 48 hs', variante: 'Anillado Plastico a4/oficio 48 hs' }] },
    [base, { ...base, idx: 2, variante: 'Anillado Plastico a4/oficio 48 hs', nombre_canonico: 'Anillado Plastico a4/oficio 48 hs', precio_lista: 2400, producto_id: 'u7' }],
    decidir({ userMessage: 'y el anillado?' }));
  const okExtra = r[0].json.reply.includes('Anillado Plastico a4/oficio 48 hs sale $2.400,00') && !r[0].json.reply.includes('de Anillado Plastico');
  r = await armar({ ...pBase, producto: 'Anillado Plastico a4/oficio 48 hs', variante: 'Anillado Plastico a4/oficio 48 hs' },
    [{ ...base, variante: 'Anillado Plastico a4/oficio 48 hs', nombre_canonico: 'Anillado Plastico a4/oficio 48 hs', precio_lista: 2400 }],
    decidir({ userMessage: 'cuanto sale el anillado 48hs?' }));
  const okMain = r[0].json.reply.includes('$2.400,00') && !r[0].json.reply.includes('La opción Anillado');
  console.log('A33 variante==producto:', okExtra && okMain ? 'OK' : 'FAIL extra=' + okExtra + ' main=' + okMain + ' | ' + r[0].json.reply);

}
main().then(() => console.log('HARNESS DONE')).catch((e) => { console.error('HARNESS CRASH:', e); process.exit(1); });
