// BUILD v10-AGENTS · PARTE 2 — nodos puente, calculo deterministico, cableado.
//
// Se carga desde build-v10-agents.js. No se corre solo.
const fs = require('fs');
const path = require('path');
const P = require('./build-v10-agents.js');
const { wf, add, conectar, paso, log, CHECK, OUT, aplicarTarget, pos } = P;

const codeNode = (nombre, jsCode, x, y) => add({
  parameters: { jsCode },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos(x, y),
  name: nombre,
});

// ───────────────────────────────────────────────────────────────────────────
// PUENTE 1 · sobre -> prompt del Agente Intención
// ───────────────────────────────────────────────────────────────────────────
codeNode('Prompt Intención', `
// Arma el prompt del clasificador. El sobre viene de \`Decidir\` y ya trae la
// conversacion deduplicada.
const d = $('Decidir').first().json;
const conv = Array.isArray(d.conversation) ? d.conversation : [];
const ultimos = conv.slice(-6)
  .map((m) => (m.role === 'user' ? 'CLIENTE: ' : 'NOSOTROS: ') + String(m.content || ''))
  .join('\\n');

return [{ json: {
  ...d,
  promptAgente: [
    'CONVERSACION RECIENTE:',
    ultimos || '(sin historial)',
    '',
    'ULTIMO MENSAJE DEL CLIENTE:',
    String(d.userMessage || ''),
  ].join('\\n'),
} }];
`.trim(), -800, 0);

// ───────────────────────────────────────────────────────────────────────────
// PUENTE 2 · intención -> ruteo
// ───────────────────────────────────────────────────────────────────────────
codeNode('Leer Intención', `
// Normaliza la salida del Agente 1. Si el agente fallo (onError:continue) o
// devolvio algo que no matchea el schema, se cae a 'precio': es la rama con
// verificacion completa, asi que un error de clasificacion se degrada hacia la
// ruta MAS controlada, no hacia la mas suelta.
const d = $('Prompt Intención').first().json;
let out = {};
try {
  const raw = $input.first().json;
  out = raw.output || raw.data || raw;
  if (typeof out === 'string') out = JSON.parse(out);
} catch (e) { out = {}; }

const VALIDAS = ['precio', 'info', 'producto', 'seguimiento', 'otro'];
let intencion = String(out.intencion || '').toLowerCase();
if (!VALIDAS.includes(intencion)) intencion = 'precio';

const confianza = Number(out.confianza);

// Confianza baja = tratarlo como pedido de precio (ruta verificada), no como info.
if (Number.isFinite(confianza) && confianza < 0.5 && intencion === 'info') intencion = 'precio';

return [{ json: {
  ...d,
  intencion,
  confianzaIntencion: Number.isFinite(confianza) ? confianza : 0,
  respuestaInfo: String(out.respuestaInfo || '').trim(),
  motivoIntencion: String(out.motivo || ''),
} }];
`.trim(), -400, 0);

add({
  parameters: {
    rules: {
      values: [
        { conditions: { options: { caseSensitive: false, version: 2 }, combinator: 'and', conditions: [{ leftValue: '={{ $json.intencion }}', rightValue: 'info', operator: { type: 'string', operation: 'equals' } }] }, outputKey: 'info' },
        { conditions: { options: { caseSensitive: false, version: 2 }, combinator: 'and', conditions: [{ leftValue: '={{ $json.intencion }}', rightValue: 'otro', operator: { type: 'string', operation: 'equals' } }] }, outputKey: 'otro' },
      ],
    },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'catalogo' },
  },
  type: 'n8n-nodes-base.switch',
  typeVersion: 3.4,
  position: pos(-200, 0),
  name: 'Switch Intención',
});

// Rama info: el agente ya trajo la respuesta de la tool. Si vino vacia, no se
// inventa nada: se deriva.
codeNode('Salida Info', `
const d = $('Leer Intención').first().json;
const texto = String(d.respuestaInfo || '').trim();
return [{ json: { ...d, final: texto, accion: 'info', hayRespuesta: texto.length > 0 } }];
`.trim(), 0, -300);

// ───────────────────────────────────────────────────────────────────────────
// PUENTE 3 · selector -> Extraer Palabras
//
// El SQL `Buscar Candidatos` espera exactamente el contrato que produce
// `Extraer Palabras` en v9. En vez de reescribir el SQL, se le da a Extraer
// Palabras lo que espera, con los terminos del Agente 2 en lugar de los del
// LLM monolitico de v9. Asi la busqueda buena (IDF + guards) queda intacta.
// ───────────────────────────────────────────────────────────────────────────
codeNode('Prompt Selector', `
const d = $('Leer Intención').first().json;
const conv = Array.isArray(d.conversation) ? d.conversation : [];
const ultimos = conv.slice(-6)
  .map((m) => (m.role === 'user' ? 'CLIENTE: ' : 'NOSOTROS: ') + String(m.content || ''))
  .join('\\n');
return [{ json: { ...d, promptAgente: [
  'CONVERSACION:', ultimos || '(sin historial)', '',
  'PEDIDO A RESOLVER:', String(d.userMessage || ''),
].join('\\n') } }];
`.trim(), 0, 0);

codeNode('Leer Selector', `
// Traduce la salida del Agente 2 al contrato que ya espera \`Extraer Palabras\`:
// { precio: { producto }, opciones: { productos } }.
const d = $('Prompt Selector').first().json;
let out = {};
try {
  const raw = $input.first().json;
  out = raw.output || raw.data || raw;
  if (typeof out === 'string') out = JSON.parse(out);
} catch (e) { out = {}; }

const terminos = (Array.isArray(out.terminos) ? out.terminos : []).filter(Boolean).map(String);
const productos = (Array.isArray(out.productos) ? out.productos : []).filter(Boolean).map(String);

return [{ json: {
  ...d,
  seleccion: {
    terminos,
    productos,
    cantidad: Number.isFinite(Number(out.cantidad)) ? Number(out.cantidad) : null,
    necesitaAclaracion: !!out.necesitaAclaracion,
    pregunta: String(out.pregunta || ''),
  },
  // contrato que consume Extraer Palabras (heredado de v9)
  precio: { producto: terminos.join(' ') },
  opciones: { productos },
} }];
`.trim(), 400, 0);

// ───────────────────────────────────────────────────────────────────────────
// PUENTE 4 · candidatos SQL -> prompt del Agente Relevancia
//
// Aca se arma la LISTA CERRADA. Cada candidato lleva un \`idx\` estable: el
// agente elige por idx, no por nombre, asi no puede referirse a algo que no
// esta en la lista.
// ───────────────────────────────────────────────────────────────────────────
codeNode('Armar Candidatos', `
// Junta las filas de Buscar Candidatos (una por variante) en una lista cerrada
// y numerada, y guarda las filas CRUDAS enteras para el verificador final.
const d = $('Leer Selector').first().json;
const filas = $input.all().map((i) => i.json).filter((r) => r && r.producto_id);

const fmt = (n) => (n == null || !Number.isFinite(Number(n)))
  ? null
  : '$' + new Intl.NumberFormat('es-AR').format(Number(n));

// COMO SE COBRA: \`unidad_venta\` MANDA sobre \`unidad\`.
//
// Bug del 2026-07-29 (loop de reintento): "cuanto sale anillar 120 hojas" ->
// el bot dijo "$2.400 por hoja". Un anillado se cobra POR TRABAJO: los $2.400
// son el anillado entero. Si el cliente multiplica por 120 se lleva $288.000
// de una cotizacion de $2.400 (120x).
//
// La columna \`unidad\` del catalogo dice "Hoja" en 142 de 165 variantes, pero
// solo 48 se cobran de verdad por hoja. El dato bueno vive en
// atributos.unidad_venta: unidad(48) · hoja(40) · pack(26) · trabajo(18) ·
// m2 · metro. \`unidad\` es basura heredada de la carga; no se corrige en la
// base (es de TG) — se ignora cuando unidad_venta dice otra cosa.
//
// Esto NO lo pesco ningun test: el harness mockea filas donde las dos columnas
// coincidian. Lo encontro el verificador en produccion, rechazando dos veces
// seguidas — tenia razon las dos.
const COBRO = {
  trabajo: 'por trabajo',
  pack: null,       // el texto del pack lo arma porPack, que ya trae la cantidad
  unidad: 'por unidad',
  hoja: 'por hoja',
  pagina: 'por pagina',
  m2: 'por m2',
  metro: 'por metro',
};
const comoSeCobra = (r) => {
  const uv = String(((r.atributos || {}).unidad_venta) || '').toLowerCase().trim();
  if (uv && Object.prototype.hasOwnProperty.call(COBRO, uv)) return { clave: uv, texto: COBRO[uv] };
  // sin unidad_venta se cae a \`unidad\`, que es lo que habia antes
  const u = String(r.unidad || '').trim();
  return { clave: null, texto: u ? 'por ' + u : null };
};

const lista = filas.map((r, i) => ({
  idx: i + 1,
  producto: r.nombre_canonico,
  variante: (r.variante && String(r.variante).trim()) || 'única',
  unidad: r.unidad || null,
  unidadVenta: ((r.atributos || {}).unidad_venta) || null,
  cobro: comoSeCobra(r),
  precioLista: r.precio_lista,
  precioTexto: fmt(r.precio_lista),
  soloDescuentos: !!r.solo_descuentos,
  porPagina: !!r.por_pagina,
  porPack: r.por_pack || null,
  tieneReglas: !!r.tiene_reglas,
  // OJO CON \`mostrable\`: en la vista de v9 es \`(not tiene_reglas)\`, o sea
  // "el precio es un numero limpio, sin escalera por cantidad". NO es un flag
  // de visibilidad. Filtrar por el fue el bug del 2026-07-29: las impresiones
  // tienen rangos por cantidad -> tiene_reglas=true -> mostrable=false, asi
  // que los 29 candidatos correctos se filtraron y al agente le llego
  // "(la busqueda no devolvio nada)". El agente contesto bien sobre una lista
  // vacia; el que mentia era este nodo.
  precioLimpio: r.mostrable === true,
  rangos: Array.isArray(r.rangos_cantidad) ? r.rangos_cantidad : null,
  nicho: r.nicho || null,
  score: r.score,
}));

// TODOS los candidatos van al agente. La visibilidad real ya la resolvio el SQL
// (bot.taxonomia filtra los ocultos antes de llegar aca).
const texto = lista.map((c) => [
  '[' + c.idx + ']',
  c.producto,
  '| variante: ' + c.variante,
  c.precioTexto ? '| precio: ' + c.precioTexto + (c.cobro.texto ? ' ' + c.cobro.texto : '') : '| precio: no publicado',
  c.porPagina ? '| se cobra por pagina' : '',
  c.porPack ? '| pack de ' + c.porPack : '',
  c.soloDescuentos ? '| solo con descuento' : '',
].filter(Boolean).join(' ')).join('\\n');

return [{ json: {
  ...d,
  candidatos: lista,
  // FILAS CRUDAS COMPLETAS: es lo que el verificador final tiene que ver.
  // No se recortan ni se resumen a proposito (decision de Martin 2026-07-29).
  filasCrudas: filas,
  nFilas: filas.length,
  promptAgente: [
    'PEDIDO DEL CLIENTE:',
    String(d.userMessage || ''),
    '',
    'CANDIDATOS DEL CATALOGO (lista cerrada, elegi por idx):',
    texto || '(la busqueda no devolvio nada)',
  ].join('\\n'),
} }];
`.trim(), 800, 0);

// ───────────────────────────────────────────────────────────────────────────
// PUENTE 5 · CALCULAR MONTOS — EL NUCLEO DETERMINISTICO
//
// DECISION DE MARTIN: ningun agente tipea un numero. Este nodo es el unico
// lugar del flujo donde se produce un monto, y sale de \`precio_lista\` de la
// fila SQL. El compositor despues solo puede copiar \`texto\`.
// ───────────────────────────────────────────────────────────────────────────
codeNode('Calcular Montos', `
// UNICO PRODUCTOR DE MONTOS DEL FLUJO.
//
// Toma los candidatos que el Agente Relevancia eligio (por idx, contra la lista
// cerrada) y emite \`hechos[]\`: cada uno con el texto EXACTO que el compositor
// tiene permitido escribir. Si un monto no se puede afirmar con la informacion
// que hay, no se emite el hecho — se emite el caveat.
//
// Esta es la leccion de v8/v9 conservada: el LLM no ve las reglas de precio ni
// tipea montos. Los 4 confident-wrong del 27 y el 1,86x del 28 salieron todos de
// un LLM eligiendo un numero.
const d = $('Armar Candidatos').first().json;

// DESANIDADO ROBUSTO de la salida del agente.
//
// El nodo Agent con output parser no garantiza UNA forma: segun version y si
// returnIntermediateSteps esta prendido, \`elegidos\` puede venir en raw.output,
// raw.output.output, raw.data, como string JSON, o en la raiz. Buscar solo en
// tres lugares fijos hacia que una forma inesperada diera elegidos=[] — que es
// indistinguible de "el agente decidio que ninguno servia" y escala a mail sin
// dejar rastro. Se busca la CLAVE, no la ruta.
const desanidar = (raw, clave) => {
  const vistos = new Set();
  const pila = [raw];
  while (pila.length) {
    let n = pila.shift();
    if (typeof n === 'string') {
      const t = n.trim();
      if (t.startsWith('{') || t.startsWith('[')) { try { n = JSON.parse(t); } catch (e) { continue; } }
      else continue;
    }
    if (!n || typeof n !== 'object' || vistos.has(n)) continue;
    vistos.add(n);
    if (Array.isArray(n[clave])) return n;
    for (const k of ['output', 'data', 'json', 'result', 'response', 'text']) {
      if (n[k] !== undefined) pila.push(n[k]);
    }
  }
  return null;
};

const raw = $input.first().json;
const encontrado = desanidar(raw, 'elegidos');
const out = encontrado || {};
// Si NO se encontro la clave, el agente fallo de forma que no se puede
// interpretar. Eso NO es lo mismo que "no hay nada que decir": se marca para
// poder distinguir los dos casos en el log.
const salidaIlegible = !encontrado;

const candidatos = Array.isArray(d.candidatos) ? d.candidatos : [];
const porIdx = new Map(candidatos.map((c) => [Number(c.idx), c]));

const elegidosRaw = Array.isArray(out.elegidos) ? out.elegidos : [];

// GUARD: el agente solo puede nombrar idx que existan y sean mostrables.
let idxInvalidos = 0;
const elegidos = [];
for (const e of elegidosRaw) {
  const c = porIdx.get(Number(e.idx));
  // NO se filtra por \`mostrable\`: es \`(not tiene_reglas)\`, no un flag de
  // visibilidad (ver el comentario en Armar Candidatos). Solo se descarta un
  // idx que NO EXISTE en la lista cerrada.
  if (!c) { idxInvalidos++; continue; }
  // confianza ausente != confianza cero. Un agente que elige un producto y no
  // llena el campo esta diciendo "este es", no "no estoy seguro". Antes
  // \`Number(undefined) || 0\` daba 0 y el umbral lo descartaba: el turno moria
  // por un campo opcional que el LLM no lleno.
  const cf = Number(e.confianza);
  elegidos.push({
    ...c,
    confianza: Number.isFinite(cf) ? cf : 1,
    confianzaDeclarada: Number.isFinite(cf),
    porque: String(e.porque || ''),
  });
}

// UMBRAL BAJO A PROPOSITO (0.2, no 0.45).
//
// La confianza que emite un LLM no esta calibrada: 0.4 y 0.9 no significan lo
// mismo entre corridas ni entre modelos. Filtrar fuerte por ese numero es la
// misma clase de error que dejarlo tipear un precio — se le esta delegando una
// decision de negocio a un valor inventado.
//
// El umbral queda solo como red contra un candidato que el propio agente marca
// como malo (confianza muy baja). Quien decide de verdad si la respuesta sale
// es el VERIFICADOR, que ve el mensaje y las filas crudas. Mejor que el turno
// llegue al verificador y se rechace ahi con motivo, que morir mudo aca.
const UMBRAL = 0.2;
const confiables = elegidos.filter((c) => c.confianza >= UMBRAL);
const descartadosPorConfianza = elegidos.length - confiables.length;

const fmt = (n) => '$' + new Intl.NumberFormat('es-AR').format(Number(n));

// Construccion de hechos. Un hecho = un enunciado que el compositor puede decir.
const hechos = [];
const caveats = [];
for (const c of confiables) {
  const base = c.producto + (c.variante && c.variante !== 'única' ? ' (' + c.variante + ')' : '');

  if (c.soloDescuentos) {
    caveats.push({ producto: base, nota: 'el precio de lista no se publica; se cotiza con descuento por mail' });
    continue;
  }
  // precio_lista == 0 NO significa "sin precio": hay variantes cuyo precio vive
  // solo en la escalera por cantidad (idx 5/6/7 del caso real: precio_lista 0
  // con rangos de $480 a $150). Solo es "sin precio" si tampoco hay rangos.
  const tieneRangos = Array.isArray(c.rangos) && c.rangos.some((x) => Number(x.value) > 0);
  if ((!Number.isFinite(Number(c.precioLista)) || Number(c.precioLista) <= 0) && !tieneRangos) {
    caveats.push({ producto: base, nota: 'no tiene precio cargado en el catalogo' });
    continue;
  }

  // COMO SE COBRA. El orden importa: por_pagina y por_pack son flags explicitos
  // del producto y ganan. Despues manda \`cobro\` (que sale de unidad_venta), y
  // recien al final la columna \`unidad\` — que miente en 94 de 165 variantes
  // (ver el comentario largo en Armar Candidatos). Decir "por hoja" en algo que
  // se cobra por trabajo es un 120x si el cliente multiplica.
  const unidad = c.porPagina ? 'por pagina'
    : c.porPack ? ('el pack de ' + c.porPack)
    : (c.cobro && c.cobro.texto) ? c.cobro.texto
    : c.unidad ? ('por ' + c.unidad)
    : null;

  // Un precio POR TRABAJO no se multiplica por la cantidad. Si el cliente dijo
  // "120 hojas" y esto se cobra por trabajo, el monto ES el total: hay que
  // decirlo, porque si no el cliente multiplica solo.
  const esPorTrabajo = c.cobro && c.cobro.clave === 'trabajo';

  // ESCALERA POR CANTIDAD. \`precio_lista\` es el precio del PRIMER tramo (1-10),
  // no el que le corresponde al pedido. Para "200 paginas doble faz" el tramo
  // 51-250 vale $88 y precio_lista dice $150: informar precio_lista seria un
  // 1,7x — la misma clase de error que los confident-wrong del 27.
  //
  // El tramo se elige ACA, con la cantidad que el Selector ya extrajo, y de la
  // fila SQL. El LLM no ve las reglas ni elige el tramo.
  const cantidad = Number((d.seleccion || {}).cantidad);
  let monto = Number(c.precioLista);
  let tramo = null;
  if (Array.isArray(c.rangos) && c.rangos.length) {
    if (Number.isFinite(cantidad) && cantidad > 0) {
      const r = c.rangos.find((x) => {
        const min = Number(x.minQty) || 1;
        const max = x.maxQty == null ? Infinity : Number(x.maxQty);
        return cantidad >= min && cantidad <= max;
      });
      if (r && Number.isFinite(Number(r.value))) {
        monto = Number(r.value);
        tramo = { desde: r.minQty, hasta: r.maxQty, cantidad };
      }
    }
  }

  // Si precio_lista era 0 y la cantidad no cayo en ningun tramo (o no se dijo
  // cantidad), el monto seguiria en 0. En ese caso se informa el PISO de la
  // escalera como "desde", que es un dato cierto, en vez de un $0 falso.
  if (!(monto > 0) && tieneRangos) {
    const piso = Math.min(...c.rangos.map((x) => Number(x.value)).filter((v) => Number.isFinite(v) && v > 0));
    if (Number.isFinite(piso)) { monto = piso; tramo = null; }
  }
  if (!(monto > 0)) {
    caveats.push({ producto: base, nota: 'el precio depende de la cantidad; lo confirmamos por mail' });
    continue;
  }

  // "(por 120 unidades)" solo tiene sentido si el precio ES por unidad. En un
  // precio por trabajo diria "$2.400 por trabajo (por 120 unidades)", que es
  // justo la lectura que hay que evitar.
  const porTramo = (tramo && !esPorTrabajo)
    ? ' (por ' + tramo.cantidad + ' unidades)'
    : '';

  hechos.push({
    producto: base,
    texto: fmt(monto) + (unidad ? ' ' + unidad : '') + porTramo,
    monto,
    tramo,
    // se propaga para que el compositor sepa que ese numero NO se multiplica
    esPorTrabajo,
    comoSeCobra: (c.cobro && c.cobro.clave) || null,
    // el piso de la escalera, para que el compositor pueda decir "desde"
    desde: Array.isArray(c.rangos) && c.rangos.length
      ? Math.min(...c.rangos.map((x) => Number(x.value)).filter(Number.isFinite))
      : null,
    confianza: c.confianza,
    // NO se calcula el TOTAL aunque haya cantidad: hay recargo UV y el unitario
    // es el BASE (decision v9.2, 2026-07-28). El total lo confirma un humano.
    tieneReglas: !!c.tieneReglas,
  });
}

// Los montos autorizados: el verificador chequea contra ESTA lista.
const montosAutorizados = hechos.map((h) => h.monto);

const hayAlgoQueDecir = hechos.length > 0 || caveats.length > 0;

// POR QUE NO HAY NADA QUE DECIR. Sin esto, el turno escala y no queda registro
// de cual de las cuatro causas fue — que es exactamente lo que paso el
// 2026-07-29 con "200 paginas doble faz en obra 75": la busqueda traia los
// productos correctos y el turno murio igual, sin forma de saber por que.
let motivoVacio = null;
if (!hayAlgoQueDecir) {
  if (salidaIlegible) motivoVacio = 'salida_ilegible';                      // el agente devolvio algo no interpretable
  else if (!candidatos.length) motivoVacio = 'busqueda_vacia';              // el SQL no trajo filas
  else if (!elegidosRaw.length) motivoVacio = 'agente_no_eligio';           // el agente devolvio lista vacia
  else if (!elegidos.length) motivoVacio = 'idx_invalidos';                 // eligio idx que no existen
  else if (!confiables.length) motivoVacio = 'confianza_baja';              // todos por debajo del umbral
  else motivoVacio = 'sin_precio_publicable';                               // eligio, pero ninguno tiene precio
}

return [{ json: {
  ...d,
  hechos,
  caveats,
  montosAutorizados,
  elegidos: confiables,
  idxInvalidos,
  salidaIlegible,
  descartadosPorConfianza,
  motivoVacio,
  // se guarda la salida cruda del agente cuando no se pudo interpretar: es el
  // unico material para diagnosticar sin volver a mirar las ejecuciones a mano
  crudoAgente: salidaIlegible ? JSON.stringify(raw).slice(0, 800) : null,
  dudaNicho: !!out.dudaNicho,
  motivoRelevancia: String(out.motivo || ''),
  hayAlgoQueDecir,
  // el compositor recibe HECHOS, no prosa (decision v9.2)
  promptAgente: [
    'PEDIDO DEL CLIENTE:',
    String(d.userMessage || ''),
    '',
    'HECHOS AUTORIZADOS (copiá los montos EXACTO, no calcules nada):',
    hechos.length
      ? hechos.map((h) => '- ' + h.producto + ': ' + h.texto).join('\\n')
      : '(ninguno)',
    caveats.length ? '' : null,
    caveats.length ? 'ACLARACIONES QUE TENES QUE DECIR:' : null,
    caveats.length ? caveats.map((c) => '- ' + c.producto + ': ' + c.nota).join('\\n') : null,
    // PRECIO POR TRABAJO CON CANTIDAD A LA VISTA. Sin decirlo, el cliente que
    // pregunto "anillar 120 hojas" lee "$2.400" y multiplica por 120 (120x).
    hechos.some((h) => h.esPorTrabajo) && (d.seleccion || {}).cantidad ? '' : null,
    hechos.some((h) => h.esPorTrabajo) && (d.seleccion || {}).cantidad
      ? 'IMPORTANTE: los montos marcados "por trabajo" son el precio del trabajo COMPLETO,'
      : null,
    hechos.some((h) => h.esPorTrabajo) && (d.seleccion || {}).cantidad
      ? 'no por cada una de las ' + (d.seleccion || {}).cantidad + ' unidades. Decilo explicito para que el'
      : null,
    hechos.some((h) => h.esPorTrabajo) && (d.seleccion || {}).cantidad
      ? 'cliente no multiplique por su cuenta.'
      : null,
    '',
    'Cada hecho dice COMO se cobra (por trabajo, por unidad, por hoja, por m2...).',
    'Respetalo tal cual: cambiar la unidad cambia el precio aunque el numero sea el mismo.',
    '',
    'Si el cliente pidio un TOTAL por cantidad: no lo calcules, decile que se lo',
    'confirmamos por mail (hay recargos que dependen del trabajo).',
  ].filter((l) => l !== null).join('\\n'),
} }];
`.trim(), 1200, 0);

// Sin nada que decir -> email. No se le pide al compositor que improvise.
add({
  parameters: {
    conditions: {
      options: { caseSensitive: true, version: 2 },
      combinator: 'and',
      conditions: [{ leftValue: '={{ $json.hayAlgoQueDecir }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    },
    options: {},
  },
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: pos(1300, 0),
  name: '¿Hay Algo Que Decir?',
});

// ───────────────────────────────────────────────────────────────────────────
// PUENTE 6 · compositor -> prompt del verificador (VE TODO)
// ───────────────────────────────────────────────────────────────────────────
codeNode('Leer Compositor', `
const d = $('Calcular Montos').first().json;
let out = {};
try {
  const raw = $input.first().json;
  out = raw.output || raw.data || raw;
  if (typeof out === 'string') out = JSON.parse(out);
} catch (e) { out = {}; }

const mensaje = String(out.mensaje || '').trim();

// QUE VUELTA ES. El contador NO puede vivir en el sobre: \`d\` sale de
// $('Calcular Montos'), que corre UNA sola vez, asi que en el reintento
// devolveria el mismo valor de siempre y el loop no terminaria nunca.
// $runIndex del compositor lo lleva n8n: 0 la primera pasada, 1 la segunda.
let intento = 1;
try { intento = Number($runIndex) + 1; } catch (e) { intento = 1; }
if (!Number.isFinite(intento) || intento < 1) intento = 1;

return [{ json: {
  ...d,
  borrador: mensaje,
  huboCompositor: mensaje.length > 0,
  intento,
  // se arrastra el feedback de la vuelta anterior para poder loguearlo aunque
  // el segundo intento salga aprobado (queremos saber que hubo que corregir)
  feedbackPrevio: String(d.feedbackPrevio || ''),
} }];
`.trim(), 1600, 0);

codeNode('Prompt Verificador', `
// El verificador ve TODO (decision de Martin 2026-07-29): el mensaje, el pedido,
// los hechos autorizados y EL RESULTADO CRUDO COMPLETO de la consulta SQL —
// incluidas las filas que el selector descarto. Sin eso no puede detectar
// "elegiste el producto equivocado", que es la clase de error mas cara.
const d = $('Leer Compositor').first().json;
const conv = Array.isArray(d.conversation) ? d.conversation : [];
const dialogo = conv.slice(-8)
  .map((m) => (m.role === 'user' ? 'CLIENTE: ' : 'NOSOTROS: ') + String(m.content || ''))
  .join('\\n');

// GUARD DETERMINISTICO PREVIO: extrae los numeros del borrador y los compara
// contra los montos autorizados. El agente igual audita, pero esto ya deja el
// dato crudo servido y no depende de que el LLM sepa comparar numeros.
const enTexto = (String(d.borrador || '').match(/\\$\\s?[\\d.]+/g) || [])
  .map((s) => Number(s.replace(/[^\\d]/g, '')))
  .filter((n) => Number.isFinite(n) && n > 0);
const autorizados = new Set((d.montosAutorizados || []).map(Number));
const noAutorizados = enTexto.filter((n) => !autorizados.has(n));

// LAS FILAS CRUDAS TIENEN QUE MOSTRAR LA ESCALERA.
//
// Bug del 2026-07-29 (2do rechazo): se mostraba solo \`precio_lista\` y el
// verificador leia "hechos dicen \$88" contra "la base dice 150" -> concluia
// PRECIO INVENTADO, correctamente para la informacion que le estabamos dando.
// El \$88 sale de \`rangos_cantidad\` (tramo 51-250), que no aparecia en el
// prompt. Mostrar la mitad de la evidencia es peor que no mostrarla: el
// auditor rechaza lo que esta bien.
const escalera = (r) => {
  const rs = Array.isArray(r.rangos_cantidad) ? r.rangos_cantidad : null;
  if (!rs || !rs.length) return '';
  return ' | escalera por cantidad: ' + rs.map((x) => {
    const hasta = x.maxQty == null ? '+' : '-' + x.maxQty;
    return (x.minQty || 1) + hasta + ': \$' + x.value;
  }).join(', ');
};

const crudas = (d.filasCrudas || []).map((r, i) => [
  '  fila ' + (i + 1) + ':',
  r.nombre_canonico,
  '| variante: ' + (r.variante || 'única'),
  // \`precio_lista\` es el precio del PRIMER tramo, no "el precio". Se nombra asi
  // para que el auditor no lo lea como el unico valor valido.
  '| precio base (tramo 1): ' + r.precio_lista,
  escalera(r),
  // COMO SE COBRA, no la columna \`unidad\`.
  //
  // Bug del 2026-07-29 (loop de reintento): el anillado tiene unidad="Hoja"
  // pero unidad_venta="trabajo". Mostrandole "unidad: Hoja" al auditor, este
  // rechazo "por hoja" (sabe que un anillado no se cobra asi), el compositor
  // lo saco, y entonces rechazo por sacarlo citando "los hechos dicen por
  // Hoja". Dos veredictos opuestos, los dos correctos para la evidencia que
  // le daba. La contradiccion estaba en el dato, no en el LLM.
  '| se cobra: ' + (((r.atributos || {}).unidad_venta) || ('(sin dato, columna unidad dice ' + (r.unidad || '-') + ')')),
  '| solo_descuentos: ' + !!r.solo_descuentos,
  '| score: ' + r.score,
].filter(Boolean).join(' ')).join('\\n');

return [{ json: {
  ...d,
  numerosNoAutorizados: noAutorizados,
  promptAgente: [
    'MENSAJE QUE ESTA POR SALIR:',
    '"""', String(d.borrador || ''), '"""',
    '',
    'CONVERSACION CON EL CLIENTE:',
    dialogo,
    '',
    'HECHOS AUTORIZADOS (los unicos montos que se pueden decir):',
    (d.hechos || []).map((h) => '- ' + h.producto + ': ' + h.texto).join('\\n') || '(ninguno)',
    '',
    'RESULTADO CRUDO COMPLETO DE LA BASE (' + (d.filasCrudas || []).length + ' filas, incluidas las descartadas):',
    crudas || '(sin filas)',
    '',
    'COMO SE CALCULARON LOS HECHOS (leelo antes de juzgar un monto):',
    (d.seleccion || {}).cantidad
      ? 'El cliente pidio ' + (d.seleccion || {}).cantidad + ' unidades.'
      : 'El cliente no dijo una cantidad concreta.',
    'Cuando un producto tiene ESCALERA POR CANTIDAD, el monto autorizado es el del',
    'TRAMO que corresponde a esa cantidad — NO el "precio base (tramo 1)".',
    'Que un monto no coincida con el precio base NO significa que este inventado:',
    'buscalo en la escalera de esa fila antes de rechazar.',
    '',
    'LA UNIDAD DE COBRO sale del campo "se cobra" de cada fila (por trabajo, por',
    'unidad, por hoja, por m2...). Ese es el dato bueno. Los hechos autorizados ya',
    'lo respetan. NO juzgues la unidad por el nombre del producto ni por lo que te',
    'parezca razonable: si "se cobra: trabajo", el mensaje tiene que decir que es',
    'por el trabajo completo, y eso es CORRECTO aunque suene raro.',
    '',
    noAutorizados.length
      ? 'ALERTA AUTOMATICA: el mensaje contiene montos que NO estan autorizados: ' + noAutorizados.join(', ')
      : 'CHEQUEO AUTOMATICO DE MONTOS: OK — todos los montos del mensaje estan en la\\n'
        + 'lista de hechos autorizados. Este chequeo es DETERMINISTICO (lo hace el codigo\\n'
        + 'comparando numero por numero), asi que NO lo contradigas: si dice OK, ningun\\n'
        + 'monto fue inventado.',
  ].join('\\n'),
} }];
`.trim(), 2000, 0);

codeNode('Leer Verificador', `
const d = $('Prompt Verificador').first().json;
let out = {};
try {
  const raw = $input.first().json;
  out = raw.output || raw.data || raw;
  if (typeof out === 'string') out = JSON.parse(out);
} catch (e) { out = {}; }

// El guard deterministico MANDA sobre el agente: si hay un monto no autorizado
// en el texto, se rechaza aunque el verificador haya dicho que si. Un LLM no
// puede habilitar un numero que el calculo no produjo.
const montoInventado = (d.numerosNoAutorizados || []).length > 0;
const aprobadoLLM = out.aprobado === true;
let fallaLLM = String(out.falla || '');

// EL CHEQUEO DE MONTOS ES DETERMINISTICO Y MANDA EN LAS DOS DIRECCIONES.
//
// Ya mandaba para RECHAZAR (un monto no autorizado tumba un OK del LLM). Faltaba
// la direccion inversa: si el codigo comparo numero por numero y NINGUNO esta
// fuera de la lista, el LLM NO puede alegar 'precio_inventado' — no es una
// opinion, es un hecho ya verificado.
//
// Bug del 2026-07-29 (2do rechazo): el verificador rechazo \$88 y \$120 diciendo
// que no estaban "en la base cruda", porque el prompt le mostraba solo
// precio_lista y no la escalera de donde salen. El chequeo automatico decia OK
// y el LLM lo contradijo igual. Se arreglo el prompt (ahora ve la escalera) y
// se agrega este piso: el veredicto del codigo sobre PLATA no se discute.
let vetoInvalido = false;
if (!montoInventado && /precio_inventado/.test(fallaLLM)) {
  vetoInvalido = true;
  fallaLLM = '';  // el rechazo por plata se descarta: el codigo ya dijo que no hubo
}

// El rechazo sobrevive solo si NO era por plata (producto equivocado, no
// contesta, dato inventado son juicios legitimos del LLM sobre el texto).
const rechazoLLM = !aprobadoLLM && !vetoInvalido;
const aprobado = !montoInventado && !rechazoLLM;

const falla = montoInventado ? 'precio_inventado'
  : (aprobado ? 'ninguna' : (fallaLLM || 'otra'));

// El sobre que sale de aca es el que leen Log Turno y Log Escalacion, asi que
// tiene que traer TODAS las columnas que esos dos mapean. Si falta una, el
// INSERT escribe null; y si la columna es NOT NULL el INSERT REBOTA ENTERO y,
// con onError:continueRegularOutput, falla EN SILENCIO — cero filas y ninguna
// senal de que algo anda mal. Es exactamente el bug del 2026-07-28 (Log Turno
// escribia null en \`accion\`), que dejo sin datos todo el trabajo de ese dia.
const productoResuelto = (d.hechos || []).map((h) => h.producto).join(' | ')
  || (d.elegidos || []).map((c) => c.producto).join(' | ')
  || null;

// ¿SE REINTENTA? (decision de Martin 2026-07-29: un rebote al compositor y basta)
//
// Tres condiciones, y las tres tienen que darse:
//
//  1. Es la PRIMERA vuelta. \`intento\` viene de $runIndex del compositor, que lo
//     lleva n8n — no de un contador nuestro que se pueda desincronizar.
//
//  2. NO fue por plata. \`montoInventado\` significa que el codigo encontro un
//     numero que el calculo no produjo. Reescribir la prosa no arregla eso: los
//     montos autorizados son IDENTICOS en la segunda vuelta (Calcular Montos no
//     se re-ejecuta), asi que el reintento solo gastaria dos llamadas mas para
//     llegar al mismo rechazo. Va derecho a mail.
//
//  3. Hay algo concreto que corregir. Si el auditor rechazo sin decir por que,
//     el compositor no tiene con que trabajar y el reintento es una moneda al
//     aire con la plata del cliente en el medio.
const intento = Number(d.intento) || 1;
const hayFeedback = String(out.motivo || '').trim().length > 0
  || String(out.queFalta || '').trim().length > 0;
const puedeReintentar = !aprobado && intento < 2 && !montoInventado && hayFeedback;

// por que NO se reintenta, para poder auditarlo desde bot.decisiones
const motivoNoReintento = (aprobado || puedeReintentar) ? null
  : (intento >= 2 ? 'ya_reintento'
    : montoInventado ? 'plata_no_es_reintentable'
    : 'sin_feedback_accionable');

return [{ json: {
  ...d,
  aprobado,
  aprobadoLLM,
  montoInventado,
  // el LLM quiso rechazar por plata cuando el codigo ya habia dicho que no
  // habia monto inventado. Se registra para vigilar si pasa seguido: seria
  // sintoma de que el prompt del verificador sigue mostrando mal la evidencia.
  vetoInvalido,
  falla,
  intento,
  puedeReintentar,
  motivoNoReintento,
  motivoVerificador: String(out.motivo || ''),
  // Log Escalacion mapea \`.motivo\`: se emite con ese nombre tambien.
  motivo: String(out.motivo || '') || ('v10 falla=' + falla),
  queFalta: String(out.queFalta || ''),
  final: aprobado ? d.borrador : '',
  accion: aprobado ? 'respuesta_verificada' : 'handoff',
  notas: 'v10-agents falla=' + falla + ' idxInv=' + (d.idxInvalidos || 0)
    + ' intento=' + intento
    + (puedeReintentar ? ' REINTENTA' : '')
    + (motivoNoReintento ? ' no-reintenta=' + motivoNoReintento : '')
    + (intento > 1 && aprobado ? ' RESCATADO-POR-REINTENTO' : '')
    + (d.feedbackPrevio ? ' feedback1=' + String(d.feedbackPrevio).slice(0, 160) : '')
    + (vetoInvalido ? ' VETO-INVALIDO(el LLM alego precio_inventado con chequeo OK)' : ''),
  // columnas que Log Turno espera y que la cadena de agentes no producia
  productoResuelto,
  filasSql: Number(d.nFilas) || 0,
  senales: {
    intencion: d.intencion || null,
    confianzaIntencion: d.confianzaIntencion || 0,
    nCandidatos: (d.candidatos || []).length,
    nElegidos: (d.elegidos || []).length,
    nHechos: (d.hechos || []).length,
    idxInvalidos: d.idxInvalidos || 0,
    dudaNicho: !!d.dudaNicho,
    montoInventado,
    aprobadoLLM,
    vetoInvalido,
    falla,
    intento,
    puedeReintentar,
    motivoNoReintento,
    // el reintento salvo un turno que antes moria en mail
    rescatadoPorReintento: intento > 1 && aprobado,
  },
} }];
`.trim(), 2400, 0);

add({
  parameters: {
    conditions: {
      options: { caseSensitive: true, version: 2 },
      combinator: 'and',
      conditions: [{ leftValue: '={{ $json.aprobado }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    },
    options: {},
  },
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: pos(2600, 0),
  name: '¿Aprobado?',
});

// ───────────────────────────────────────────────────────────────────────────
// REINTENTO · un solo rebote al compositor con el feedback del verificador
//
// DECISION DE MARTIN (2026-07-29): cuando el verificador desaprueba, el turno no
// muere — vuelve al compositor con el motivo para que corrija. UNA vez. Si el
// verificador rechaza de nuevo, ahi si escala a mail.
//
// POR QUE VUELVE AL COMPOSITOR Y NO MAS ATRAS:
//   El reintento reescribe PROSA, no plata. `Calcular Montos` no se re-ejecuta,
//   asi que `montosAutorizados` es identico en las dos vueltas. Eso es
//   deliberado: si el problema fuera el monto, redactar de nuevo no lo arregla —
//   por eso `precio_inventado` NO es reintentable (ver abajo).
// ───────────────────────────────────────────────────────────────────────────
add({
  parameters: {
    conditions: {
      options: { caseSensitive: true, version: 2 },
      combinator: 'and',
      conditions: [{ leftValue: '={{ $json.puedeReintentar }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    },
    options: {},
  },
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: pos(2600, 300),
  name: '¿Reintentar?',
});

codeNode('Prompt Reintento', `
// Rearma el prompt del compositor sumandole el feedback del auditor. Los HECHOS
// son los mismos de la primera vuelta (salen de Calcular Montos, que no se
// re-ejecuta): lo unico que cambia es que ahora sabe que fallo.
const v = $('Leer Verificador').first().json;
const base = $('Calcular Montos').first().json;

const queFalta = String(v.queFalta || '').trim();
const motivo = String(v.motivoVerificador || v.motivo || '').trim();

return [{ json: {
  ...base,
  intento: 2,
  feedbackPrevio: (motivo + (queFalta ? ' · ' + queFalta : '')).slice(0, 600),
  borradorRechazado: String(v.borrador || ''),
  fallaPrevia: String(v.falla || ''),
  promptAgente: [
    String(base.promptAgente || ''),
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'SEGUNDO INTENTO — TU MENSAJE ANTERIOR FUE RECHAZADO POR EL AUDITOR.',
    '',
    'Lo que escribiste antes:',
    '"""', String(v.borrador || ''), '"""',
    '',
    'Por que lo rechazo:',
    motivo || '(sin motivo)',
    queFalta ? '' : null,
    queFalta ? 'Que falta corregir:' : null,
    queFalta || null,
    '',
    'Reescribi el mensaje corrigiendo ESO. Los HECHOS AUTORIZADOS de arriba no',
    'cambiaron: son los mismos montos y no se tocan. Si el auditor dijo que el',
    'mensaje no contestaba lo que el cliente pregunto, contestalo derecho.',
    'Es tu ultima oportunidad: si vuelve a fallar, el cliente termina en un mail.',
  ].filter((l) => l !== null).join('\\n'),
} }];
`.trim(), 2600, 480);

paso('7 nodos Code puente (incl. Calcular Montos: unico productor de montos)');

// ───────────────────────────────────────────────────────────────────────────
// CABLEADO
// ───────────────────────────────────────────────────────────────────────────
// CADA salida de switch va con su indice EXPLICITO y en el orden en que el switch
// declara sus reglas. Los indices se verifican contra las reglas en
// validarSwitches(), abajo — no alcanza con escribirlos bien una vez.
//
// El orden REAL de v9, que es el que manda:
//   Switch Ruteo         0 skip · 1 greeting · 2 injection · 3 process · 4 cap
//   Switch Firewall      0 pass · 1 refusal · 2 silence · 3 drop · 4 fallback(=pass)
//   Switch Strike Tier-2 0 refusal · 1 silence · 2 fallback(=silencio)
const C = [
  // ENTRADA. Ojo el orden: en v9 el firewall corre ANTES de ¿Tiene Texto?, no
  // despues. Un adjunto sin texto tambien tiene que contar para el rate-limit.
  ['Chatwoot Webhook', 'Verificar HMAC', 'main', 0],
  ['Verificar HMAC', 'Filtro Ingreso', 'main', 0],
  ['Filtro Ingreso', 'Firewall Tier-1', 'main', 0],
  ['Firewall Tier-1', 'Switch Firewall', 'main', 0],

  // FIREWALL TIER-1. `pass` (0) y el fallback (4) siguen el flujo: un `action`
  // inesperado NO puede dejar mudo al bot, se comporta como pass (igual que v9).
  ['Switch Firewall', '¿Tiene Texto?', 'main', 0],              // pass
  ['Switch Firewall', 'Mensaje Firewall Refusal', 'main', 1],   // refusal
  ['Switch Firewall', 'Aviso Rate Firewall', 'main', 2],        // silence
  ['Switch Firewall', 'Descartar Firewall (drop)', 'main', 3],  // drop
  ['Switch Firewall', '¿Tiene Texto?', 'main', 4],              // fallback -> pass

  ['¿Tiene Texto?', 'Wait — Debounce', 'main', 0],
  ['¿Tiene Texto?', 'Respuesta No-Texto', 'main', 1],
  ['Wait — Debounce', 'Get Historial', 'main', 0],
  ['Get Historial', 'Decidir', 'main', 0],
  ['Decidir', 'Switch Ruteo', 'main', 0],

  // RUTEO. La salida 4 (cap) tiene que estar cableada: sin eso, una conversacion
  // que llega al tope de 25 respuestas/24h muere muda.
  ['Switch Ruteo', 'Descartar (debounce/dup)', 'main', 0],   // skip
  ['Switch Ruteo', 'Saludo Bienvenida', 'main', 1],          // greeting
  ['Switch Ruteo', 'Mensaje Anti-Injection', 'main', 2],     // injection
  ['Switch Ruteo', 'Guardrails Tier-2', 'main', 3],          // process
  ['Switch Ruteo', 'Mensaje Cap Email', 'main', 4],          // cap

  // TIER-2 semantico
  ['Guardrails Tier-2', '¿Violación Real Tier-2?', 'main', 0],
  ['Guardrails Tier-2', 'Router Fail Tier-2', 'main', 1],
  ['Router Fail Tier-2', '¿Violación Real Tier-2?', 'main', 0],
  ['¿Violación Real Tier-2?', 'Strike Tier-2', 'main', 0],
  // pasa el firewall -> arranca la cadena de agentes
  ['¿Violación Real Tier-2?', 'Prompt Intención', 'main', 1],
  ['Strike Tier-2', 'Switch Strike Tier-2', 'main', 0],
  ['Switch Strike Tier-2', 'Mensaje Refusal Tier-2', 'main', 0],  // refusal
  ['Switch Strike Tier-2', 'Silencio Tier-2', 'main', 1],         // silence
  ['Switch Strike Tier-2', 'Silencio Tier-2', 'main', 2],         // fallback

  // A1 intencion
  ['Prompt Intención', 'Agente Intención'],
  ['Agente Intención', 'Leer Intención'],
  ['Leer Intención', 'Switch Intención'],
  ['Switch Intención', 'Salida Info', 'main', 0],
  ['Switch Intención', 'Silencio Otro', 'main', 1],
  ['Switch Intención', 'Prompt Selector', 'main', 2],

  // rama info
  ['Salida Info', '¿Info Resuelta?'],
  ['¿Info Resuelta?', 'Enviar Mensaje', 'main', 0],
  ['¿Info Resuelta?', 'Label Escalación', 'main', 1],

  // A2 selector -> busqueda SQL heredada
  ['Prompt Selector', 'Agente Selector'],
  ['Agente Selector', 'Leer Selector'],
  ['Leer Selector', 'Extraer Palabras'],
  ['Extraer Palabras', 'Buscar Candidatos'],
  ['Buscar Candidatos', 'Armar Candidatos'],

  // A3 relevancia -> montos deterministicos
  ['Armar Candidatos', 'Agente Relevancia'],
  ['Agente Relevancia', 'Calcular Montos'],
  ['Calcular Montos', '¿Hay Algo Que Decir?'],
  ['¿Hay Algo Que Decir?', 'Agente Compositor', 'main', 0],
  ['¿Hay Algo Que Decir?', 'Label Escalación', 'main', 1],

  // A4 compositor -> A5 verificador
  ['Agente Compositor', 'Leer Compositor'],
  ['Leer Compositor', 'Prompt Verificador'],
  ['Prompt Verificador', 'Agente Verificador'],
  ['Agente Verificador', 'Leer Verificador'],
  ['Leer Verificador', '¿Aprobado?'],
  ['¿Aprobado?', 'Enviar Mensaje', 'main', 0],
  // rechazado -> se pregunta si da para reintentar antes de mandarlo a mail
  ['¿Aprobado?', '¿Reintentar?', 'main', 1],
  // EL LOOP: vuelve al compositor con el feedback. Una sola vez — lo garantiza
  // `puedeReintentar` (intento < 2), que se calcula en Leer Verificador.
  ['¿Reintentar?', 'Prompt Reintento', 'main', 0],
  ['¿Reintentar?', 'Label Escalación', 'main', 1],
  ['Prompt Reintento', 'Agente Compositor', 'main', 0],

  // salidas
  ['Enviar Mensaje', 'Log Turno', 'main', 0],
  ['Label Escalación', 'Mensaje Escalación', 'main', 0],
  ['Mensaje Escalación', 'Log Escalación', 'main', 0],
  ['Mensaje Cap Email', 'Label Cap', 'main', 0],
];

// Nodos chicos que faltaban del cableado
add({
  parameters: {},
  type: 'n8n-nodes-base.noOp',
  typeVersion: 1,
  position: pos(0, -500),
  name: 'Silencio Otro',
});
add({
  parameters: {
    conditions: {
      options: { caseSensitive: true, version: 2 },
      combinator: 'and',
      conditions: [{ leftValue: '={{ $json.hayRespuesta }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    },
    options: {},
  },
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: pos(200, -300),
  name: '¿Info Resuelta?',
});

for (const [a, b, tipo, salida] of C) conectar(a, b, tipo || 'main', salida || 0);
paso('cableado: ' + C.length + ' conexiones main');

// ───────────────────────────────────────────────────────────────────────────
// REFERENCIAS DE NODOS HEREDADOS
//
// En n8n un nodo Code puede leer CUALQUIER nodo del workflow con $('Nombre'),
// sin que exista conexion entre los dos. Esas referencias no aparecen en
// `connections`, asi que el guard de grafo no las ve: el JSON importa perfecto
// y revienta EN EJECUCION con "Referenced node doesn't exist".
//
// Paso en la primera corrida real (2026-07-29): `Extraer Palabras` leia
// $('Parsear Respuesta'), que es de la arquitectura de v9 y aca no existe.
//
// Los tres nodos heredados que leen nodos de v9 se re-apuntan a su equivalente
// de v10, y el guard de abajo verifica que no quede ninguna referencia colgada.
const REESCRIBIR = [
  // Extraer Palabras leia el JSON del LLM monolitico. En v10 el que decide los
  // terminos de busqueda es el Agente Selector, cuya salida normaliza
  // `Leer Selector` al MISMO contrato ({ precio: {producto}, opciones: {productos} }).
  ['Extraer Palabras', 'Parsear Respuesta', 'Leer Selector'],
  // Log Turno cuelga SIEMPRE de la rama aprobada, asi que Leer Verificador
  // corrio con seguridad.
  ['Log Turno', 'Aplicar Compositor', 'Leer Verificador'],
  // Log Escalacion NO: a `Label Escalación` se llega desde TRES lugares y solo
  // uno paso por el verificador (¿Info Resuelta?=false y ¿Hay Algo Que Decir?=
  // false no lo ejecutan). $('Leer Verificador') en esos casos vuelve a tirar
  // "Referenced node doesn't exist" en ejecucion. `Decidir` es el ultimo nodo
  // por el que pasan las tres ramas, asi que el motivo se arma abajo con un
  // fallback tolerante en vez de leer un nodo que puede no haber corrido.
  ['Log Escalación', 'Parsear Respuesta', 'Decidir'],
];

for (const [nodo, viejo, nuevo] of REESCRIBIR) {
  const n = wf.nodes.find((x) => x.name === nodo);
  if (!n) throw new Error('BUILD [refs]: no existe el nodo "' + nodo + '"');
  if (!wf.nodes.some((x) => x.name === nuevo)) {
    throw new Error('BUILD [refs]: el destino "' + nuevo + '" no existe');
  }
  const antes = JSON.stringify(n.parameters);
  // se cubren las dos formas de comilla que puede traer la expresion
  const despues = antes
    .split("$('" + viejo + "')").join("$('" + nuevo + "')")
    .split('$(\\"' + viejo + '\\")').join('$(\\"' + nuevo + '\\")');
  if (antes === despues) {
    throw new Error('BUILD [refs]: "' + nodo + '" no referencia a "' + viejo + '" (ya se aplico?)');
  }
  n.parameters = JSON.parse(despues);
  paso('refs · ' + nodo + ': $(' + viejo + ') -> $(' + nuevo + ')');
}

// `notas` de Log Escalacion venia de $('Parsear Respuesta').motivo, y el paso de
// arriba ya la re-apunto a `Decidir` — que no tiene ese campo. Se reescribe
// entera: a esta rama se llega desde TRES lugares distintos y cada uno sabe algo
// diferente, asi que se arma con try/catch en cascada (gana el que haya corrido).
// NUNCA null: la columna es NOT NULL y un INSERT rebotado se pierde en silencio,
// que es el bug del 2026-07-28.
{
  const le = wf.nodes.find((x) => x.name === 'Log Escalación');
  le.parameters.columns.value.notas =
    "={{ (() => {" +
    " try { const v = $('Leer Verificador').first().json; if (v && v.falla) return 'v10 rechazo=' + v.falla + (v.queFalta ? ' · ' + v.queFalta : ''); } catch (e) {}" +
    " try { const c = $('Calcular Montos').first().json; if (c && !c.hayAlgoQueDecir) return 'v10 vacio=' + (c.motivoVacio || '?') + ' cand=' + ((c.candidatos || []).length) + ' idxInv=' + (c.idxInvalidos || 0) + ' confBaja=' + (c.descartadosPorConfianza || 0) + (c.crudoAgente ? ' crudo=' + c.crudoAgente.slice(0, 200) : ''); } catch (e) {}" +
    " try { const i = $('Leer Intención').first().json; if (i && i.intencion === 'info') return 'v10 info_sin_dato'; } catch (e) {}" +
    " return 'v10 escalacion'; })() }}";
  paso('refs · Log Escalación.notas: cascada tolerante (3 ramas posibles)');
}

// GUARD: ninguna expresion puede referenciar un nodo que no existe.
{
  const nombres = new Set(wf.nodes.map((n) => n.name));
  const rotas = [];
  for (const n of wf.nodes) {
    const blob = JSON.stringify(n.parameters || {});
    const refs = new Set();
    // $('Nodo') y $("Nodo") tal como quedan serializados en el JSON
    for (const m of blob.matchAll(/\$\(\\?['"]([^'"\\]+)\\?['"]\)/g)) refs.add(m[1]);
    for (const r of refs) if (!nombres.has(r)) rotas.push(n.name + ' -> $(' + r + ')');
  }
  if (rotas.length) {
    throw new Error(
      'BUILD [refs]: hay expresiones que referencian nodos inexistentes.\n  ' +
      rotas.join('\n  ') +
      '\n  (n8n importa igual y falla EN EJECUCION con "Referenced node doesn\'t exist")'
    );
  }
  paso('guard de referencias: ninguna expresion $(...) apunta a un nodo inexistente');
}

// ───────────────────────────────────────────────────────────────────────────
// GUARD DE RUTEO — que cada salida de switch vaya a donde dice su regla
//
// El bug que motiva esto (2026-07-29, lo vio Martin leyendo el JSON): las cuatro
// salidas de `Switch Firewall` estaban corridas un lugar. La salida 0 es `pass`
// — el mensaje legitimo — y apuntaba a `Mensaje Firewall Refusal`. O sea que
// TODO cliente normal recibia "solo puedo ayudarte con consultas sobre Terminal
// Grafica" y no llegaba nunca al bot. El JSON era valido, el grafo estaba
// conectado, y los 37 invariantes daban verde: nada miraba la SEMANTICA de cada
// salida.
//
// EXPECTATIVAS declara, para cada switch, que outputKey tiene que ir a que nodo.
// Si alguien reordena las reglas o inserta una nueva, el build rompe.
const EXPECTATIVAS = {
  'Switch Ruteo': {
    skip: 'Descartar (debounce/dup)',
    greeting: 'Saludo Bienvenida',
    injection: 'Mensaje Anti-Injection',
    process: 'Guardrails Tier-2',
    cap: 'Mensaje Cap Email',
  },
  'Switch Firewall': {
    pass: '¿Tiene Texto?',
    refusal: 'Mensaje Firewall Refusal',
    silence: 'Aviso Rate Firewall',
    drop: 'Descartar Firewall (drop)',
    // el fallback se comporta como pass: un `action` inesperado no deja mudo al bot
    fallback: '¿Tiene Texto?',
  },
  'Switch Strike Tier-2': {
    refusal: 'Mensaje Refusal Tier-2',
    silence: 'Silencio Tier-2',
    fallback: 'Silencio Tier-2',
  },
  'Switch Intención': {
    info: 'Salida Info',
    otro: 'Silencio Otro',
    catalogo: 'Prompt Selector',
  },
};

const clavesDeSwitch = (nodo) => {
  const p = nodo.parameters || {};
  const keys = (p.rules && p.rules.values ? p.rules.values : []).map((r, i) => r.outputKey || ('regla' + i));
  const opts = p.options || {};
  if (opts.fallbackOutput === 'extra') keys.push(opts.renameFallbackOutput || 'fallback');
  return keys;
};

for (const [nombre, esperado] of Object.entries(EXPECTATIVAS)) {
  const nodo = wf.nodes.find((n) => n.name === nombre);
  if (!nodo) throw new Error('GUARD RUTEO: no existe el switch "' + nombre + '"');
  const keys = clavesDeSwitch(nodo);
  const salidas = (wf.connections[nombre] || {}).main || [];

  for (const [clave, destinoEsperado] of Object.entries(esperado)) {
    const idx = keys.indexOf(clave);
    if (idx === -1) {
      throw new Error('GUARD RUTEO: "' + nombre + '" no declara la salida "' + clave + '" (declara: ' + keys.join(', ') + ')');
    }
    const destinos = (salidas[idx] || []).map((x) => x.node);
    if (!destinos.includes(destinoEsperado)) {
      throw new Error(
        'GUARD RUTEO: "' + nombre + '" salida ' + idx + ' (' + clave + ') deberia ir a "' +
        destinoEsperado + '" y va a [' + (destinos.join(', ') || 'NADA') + ']'
      );
    }
  }
  // ninguna salida declarada puede quedar sin cablear: un switch mudo mata el turno
  keys.forEach((k, i) => {
    if (!(salidas[i] || []).length) {
      throw new Error('GUARD RUTEO: "' + nombre + '" salida ' + i + ' (' + k + ') quedo SIN CABLEAR');
    }
  });
}
paso('guard de ruteo: ' + Object.keys(EXPECTATIVAS).length + ' switches verificados contra sus reglas');

// ───────────────────────────────────────────────────────────────────────────
// VALIDACIONES — el build rompe antes de emitir un JSON invalido
// ───────────────────────────────────────────────────────────────────────────
const nombres = new Set(wf.nodes.map((n) => n.name));
const dup = wf.nodes.map((n) => n.name).filter((n, i, a) => a.indexOf(n) !== i);
if (dup.length) throw new Error('BUILD: nodos duplicados: ' + dup.join(', '));

for (const [src, conns] of Object.entries(wf.connections)) {
  if (!nombres.has(src)) throw new Error('BUILD: conexion desde nodo inexistente "' + src + '"');
  for (const grupos of Object.values(conns)) {
    for (const g of grupos) {
      for (const c of g) {
        if (!nombres.has(c.node)) throw new Error('BUILD: conexion hacia nodo inexistente "' + c.node + '" (desde ' + src + ')');
      }
    }
  }
}

// Todo agente necesita modelo + parser, o n8n lo importa roto.
for (const n of wf.nodes) {
  if (n.type !== '@n8n/n8n-nodes-langchain.agent') continue;
  const tieneModelo = Object.entries(wf.connections).some(([, c]) =>
    (c.ai_languageModel || []).some((g) => g.some((x) => x.node === n.name)));
  const tieneParser = Object.entries(wf.connections).some(([, c]) =>
    (c.ai_outputParser || []).some((g) => g.some((x) => x.node === n.name)));
  if (!tieneModelo) throw new Error('BUILD: el agente "' + n.name + '" no tiene modelo conectado');
  if (!tieneParser) throw new Error('BUILD: el agente "' + n.name + '" no tiene output parser');
}

// GUARD DEL EXPERIMENTO: ningun agente puede tener una tool que escriba.
for (const n of wf.nodes) {
  if (n.type !== 'n8n-nodes-base.postgresTool') continue;
  const q = String(n.parameters.query || '').toLowerCase();
  if (!/^\s*select/.test(q)) throw new Error('BUILD: la tool "' + n.name + '" no empieza con SELECT');
  if (/\b(insert|update|delete|drop|alter|truncate|grant)\b/.test(q)) {
    throw new Error('BUILD: la tool "' + n.name + '" contiene una sentencia de escritura');
  }
}
paso('validado: conexiones, agentes con modelo+parser, tools solo-SELECT');

// ───────────────────────────────────────────────────────────────────────────
// TARGET + ESCRITURA
// ───────────────────────────────────────────────────────────────────────────
// El experimento corre SIEMPRE contra el mock (nunca contra el Chatwoot de TG).
// aplicarTarget valida 12 URLs de Chatwoot; este flujo tiene menos nodos que
// hablan con Chatwoot, asi que se hace el remapeo de host a mano con la misma
// tabla, y las credenciales via el mismo modulo.
// DOS TARGETS:
//
//   --target mock  (default) → pega al mock de Chatwoot en localhost. Para correr
//                              suites sin tocar WhatsApp ni gastar mensajes pagos.
//   --target live            → MISMAS PUNTAS QUE EL BOT PRINCIPAL: el Chatwoot real,
//                              la credencial real. Es lo que hay que usar para
//                              conectarlo por WhatsApp y probarlo a mano.
//
// En los DOS casos el path del webhook es propio (`chatwoot-v10`), NUNCA el de
// prod: los dos workflows conviven en la misma instancia de n8n y compartir path
// haria que un mensaje real caiga en el experimento (o que n8n rechace el
// duplicado). Para probarlo por WhatsApp se apunta un webhook de Chatwoot a esa
// URL, sin tocar el del bot que esta andando.
const { TARGETS } = require('./target');
const argTarget = process.argv.indexOf('--target');
const TARGET = argTarget !== -1 ? process.argv[argTarget + 1] : 'mock';
if (!['mock', 'live'].includes(TARGET)) throw new Error('BUILD: --target debe ser mock|live');

const HOST_PROD = 'https://chatwoot.silvercoastwebagency.com';
const cfg = TARGET === 'live' ? TARGETS.prod : TARGETS.test;

let urls = 0;
for (const n of wf.nodes) {
  const u = n.parameters && n.parameters.url;
  if (typeof u === 'string' && u.includes(HOST_PROD)) {
    // en live el host ya es el correcto: no se reescribe nada
    if (TARGET !== 'live') n.parameters.url = u.split(HOST_PROD).join(cfg.chatwootHost);
    urls++;
  }
}
const porNombreProd = {};
for (const [visible, cred] of Object.entries(TARGETS.prod.credenciales)) porNombreProd[cred.name] = visible;
let creds = 0;
for (const n of wf.nodes) {
  if (!n.credentials) continue;
  for (const [tipo, cred] of Object.entries(n.credentials)) {
    const visible = porNombreProd[cred.name] || cred.name;
    const destino = cfg.credenciales[visible];
    if (!destino) continue;
    n.credentials[tipo] = { id: destino.id, name: destino.name };
    creds++;
  }
}
// El path SIEMPRE es propio, en los dos targets. Ver el comentario de arriba.
for (const n of wf.nodes) {
  if (n.type !== 'n8n-nodes-base.webhook') continue;
  const p = n.parameters.path;
  if (p === TARGETS.prod.webhookPath) n.parameters.path = 'chatwoot-v10';
  else if (p === TARGETS.prod.refreshPath) n.parameters.path = 'refrescar-catalogo-v10';
  if (n.webhookId) n.webhookId = n.webhookId.replace(/.$/, 'a');
}
wf.name = TARGET === 'live' ? 'faq-bot-v10-agents (live)' : 'faq-bot-v10-agents';
paso('target ' + TARGET + ': host ' + (TARGET === 'live' ? HOST_PROD : cfg.chatwootHost)
  + ' (' + urls + ' urls), ' + creds + ' credenciales, webhook /chatwoot-v10');

const json = JSON.stringify(wf, null, 2);

if (CHECK) {
  const actual = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (actual.trim() !== json.trim()) {
    console.error('DESACTUALIZADO: ' + path.basename(OUT) + ' no coincide con el build.');
    process.exit(1);
  }
  console.log('OK: ' + path.basename(OUT) + ' esta al dia.');
} else {
  fs.writeFileSync(OUT, json);
  console.log('BUILD v10-agents -> ' + OUT);
  log.forEach((l) => console.log('  · ' + l));
  const porTipo = {};
  for (const n of wf.nodes) {
    const t = n.type.split('.').pop();
    porTipo[t] = (porTipo[t] || 0) + 1;
  }
  console.log('\\n  nodos: ' + wf.nodes.length);
  Object.entries(porTipo).sort((a, b) => b[1] - a[1]).forEach(([t, k]) => console.log('    ' + String(k).padStart(3) + '  ' + t));
}
