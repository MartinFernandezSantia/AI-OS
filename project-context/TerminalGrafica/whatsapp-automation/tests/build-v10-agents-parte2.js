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

const lista = filas.map((r, i) => ({
  idx: i + 1,
  producto: r.nombre_canonico,
  variante: (r.variante && String(r.variante).trim()) || 'única',
  unidad: r.unidad || null,
  precioLista: r.precio_lista,
  precioTexto: fmt(r.precio_lista),
  soloDescuentos: !!r.solo_descuentos,
  porPagina: !!r.por_pagina,
  porPack: r.por_pack || null,
  tieneReglas: !!r.tiene_reglas,
  mostrable: r.mostrable !== false,
  nicho: r.nicho || null,
  score: r.score,
}));

const visibles = lista.filter((c) => c.mostrable);

const texto = visibles.map((c) => [
  '[' + c.idx + ']',
  c.producto,
  '| variante: ' + c.variante,
  c.precioTexto ? '| precio: ' + c.precioTexto + (c.unidad ? ' por ' + c.unidad : '') : '| precio: no publicado',
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
let out = {};
try {
  const raw = $input.first().json;
  out = raw.output || raw.data || raw;
  if (typeof out === 'string') out = JSON.parse(out);
} catch (e) { out = {}; }

const candidatos = Array.isArray(d.candidatos) ? d.candidatos : [];
const porIdx = new Map(candidatos.map((c) => [Number(c.idx), c]));

const elegidosRaw = Array.isArray(out.elegidos) ? out.elegidos : [];

// GUARD: el agente solo puede nombrar idx que existan y sean mostrables. Un idx
// inventado se descarta en silencio (y se cuenta, para poder auditarlo).
let idxInvalidos = 0;
const elegidos = [];
for (const e of elegidosRaw) {
  const c = porIdx.get(Number(e.idx));
  if (!c || !c.mostrable) { idxInvalidos++; continue; }
  elegidos.push({ ...c, confianza: Number(e.confianza) || 0, porque: String(e.porque || '') });
}

const UMBRAL = 0.45;
const confiables = elegidos.filter((c) => c.confianza >= UMBRAL);

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
  if (!Number.isFinite(Number(c.precioLista)) || Number(c.precioLista) <= 0) {
    caveats.push({ producto: base, nota: 'no tiene precio cargado en el catalogo' });
    continue;
  }

  const unidad = c.porPagina ? 'por pagina'
    : c.porPack ? ('el pack de ' + c.porPack)
    : c.unidad ? ('por ' + c.unidad)
    : null;

  hechos.push({
    producto: base,
    texto: fmt(c.precioLista) + (unidad ? ' ' + unidad : ''),
    monto: Number(c.precioLista),
    confianza: c.confianza,
    // NO se calcula el total aunque haya cantidad: hay recargo UV y precio_lista
    // es el BASE (decision v9.2, 2026-07-28). El total lo confirma un humano.
    tieneReglas: !!c.tieneReglas,
  });
}

// Los montos autorizados: el verificador chequea contra ESTA lista.
const montosAutorizados = hechos.map((h) => h.monto);

const hayAlgoQueDecir = hechos.length > 0 || caveats.length > 0;

return [{ json: {
  ...d,
  hechos,
  caveats,
  montosAutorizados,
  elegidos: confiables,
  idxInvalidos,
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
return [{ json: { ...d, borrador: mensaje, huboCompositor: mensaje.length > 0 } }];
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

const crudas = (d.filasCrudas || []).map((r, i) => [
  '  fila ' + (i + 1) + ':',
  r.nombre_canonico,
  '| variante: ' + (r.variante || 'única'),
  '| precio_lista: ' + r.precio_lista,
  '| unidad: ' + (r.unidad || '-'),
  '| mostrable: ' + (r.mostrable !== false),
  '| solo_descuentos: ' + !!r.solo_descuentos,
  '| score: ' + r.score,
].join(' ')).join('\\n');

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
    noAutorizados.length
      ? 'ALERTA AUTOMATICA: el mensaje contiene montos que NO estan autorizados: ' + noAutorizados.join(', ')
      : 'Chequeo automatico de montos: OK.',
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
const aprobado = aprobadoLLM && !montoInventado;

const falla = montoInventado ? 'precio_inventado' : String(out.falla || (aprobado ? 'ninguna' : 'otra'));

return [{ json: {
  ...d,
  aprobado,
  aprobadoLLM,
  montoInventado,
  falla,
  motivoVerificador: String(out.motivo || ''),
  queFalta: String(out.queFalta || ''),
  final: aprobado ? d.borrador : '',
  accion: aprobado ? 'respuesta_verificada' : 'handoff',
  notas: 'v10-agents falla=' + falla + ' idxInv=' + (d.idxInvalidos || 0),
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

paso('7 nodos Code puente (incl. Calcular Montos: unico productor de montos)');

// ───────────────────────────────────────────────────────────────────────────
// CABLEADO
// ───────────────────────────────────────────────────────────────────────────
const C = [
  // entrada y firewall (heredado de v9)
  ['Chatwoot Webhook', 'Verificar HMAC'],
  ['Verificar HMAC', 'Filtro Ingreso'],
  ['Filtro Ingreso', '¿Tiene Texto?'],
  ['¿Tiene Texto?', 'Wait — Debounce', 'main', 0],
  ['¿Tiene Texto?', 'Respuesta No-Texto', 'main', 1],
  ['Wait — Debounce', 'Get Historial'],
  ['Get Historial', 'Decidir'],
  ['Decidir', 'Switch Ruteo'],
  ['Switch Ruteo', 'Descartar (debounce/dup)', 'main', 0],
  ['Switch Ruteo', 'Saludo Bienvenida', 'main', 1],
  ['Switch Ruteo', 'Mensaje Anti-Injection', 'main', 2],
  ['Switch Ruteo', 'Firewall Tier-1', 'main', 3],
  ['Firewall Tier-1', 'Switch Firewall'],
  ['Switch Firewall', 'Mensaje Firewall Refusal', 'main', 0],
  ['Switch Firewall', 'Aviso Rate Firewall', 'main', 1],
  ['Switch Firewall', 'Descartar Firewall (drop)', 'main', 2],
  ['Switch Firewall', 'Guardrails Tier-2', 'main', 3],
  ['Guardrails Tier-2', '¿Violación Real Tier-2?', 'main', 0],
  ['Guardrails Tier-2', 'Router Fail Tier-2', 'main', 1],
  ['Router Fail Tier-2', '¿Violación Real Tier-2?'],
  ['¿Violación Real Tier-2?', 'Strike Tier-2', 'main', 0],
  // pasa el firewall -> arranca la cadena de agentes
  ['¿Violación Real Tier-2?', 'Prompt Intención', 'main', 1],
  ['Strike Tier-2', 'Switch Strike Tier-2'],
  ['Switch Strike Tier-2', 'Mensaje Refusal Tier-2', 'main', 0],
  ['Switch Strike Tier-2', 'Silencio Tier-2', 'main', 1],

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
  ['¿Aprobado?', 'Label Escalación', 'main', 1],

  // salidas
  ['Enviar Mensaje', 'Log Turno'],
  ['Label Escalación', 'Mensaje Escalación'],
  ['Mensaje Escalación', 'Log Escalación'],
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
