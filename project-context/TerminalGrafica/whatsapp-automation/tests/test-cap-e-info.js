// TEST de los dos fixes de la ronda del 2026-07-31 en WhatsApp real:
//
//   · CAP DE VOLUMEN — "necesito 999999 impresiones a3, cuánto en total?" cotizó
//     $399.999.600. v10 no heredó el cap_volumen de v7. El cap va al TOTAL, no al
//     turno: el precio unitario se sigue diciendo (decisión de Martin).
//
//   · RAMA INFO — rediseñada el 2026-08-03: Intención dejó de redactar info (era
//     clasificador + redactor a la vez). Ahora un Agente Info dedicado redacta
//     grounded en bot.info_negocio (o escala). Se testea lo determinístico
//     (Prompt Info inyecta la tabla, Leer Info normaliza); la salida LLM se mockea.
//
// Corre el jsCode REAL extraído del workflow (no una copia), así el test no puede
// quedar desincronizado de los nodos.
//
//   node tests/test-cap-e-info.js
//   WF=faq-bot-v9-test.json node tests/test-cap-e-info.js
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'n8n', 'flows');
const wf = JSON.parse(fs.readFileSync(path.join(DIR, process.env.WF || 'faq-bot-v10-live.json'), 'utf8'));
const nodo = (n) => wf.nodes.find((x) => x.name === n);

// mismo runner que tests/test-v10-relevancia.js
function correr(nombreNodo, entrada, contexto) {
  const js = nodo(nombreNodo).parameters.jsCode;
  const $ = (n) => {
    if (!(n in contexto)) throw new Error('el nodo pide $(' + n + ') y el test no lo mockeó');
    const v = contexto[n];
    const arr = Array.isArray(v) ? v : [v];
    return { first: () => ({ json: arr[0] }), all: () => arr.map((j) => ({ json: j })) };
  };
  const $input = {
    first: () => ({ json: Array.isArray(entrada) ? entrada[0] : entrada }),
    all: () => (Array.isArray(entrada) ? entrada : [entrada]).map((j) => ({ json: j })),
  };
  const fn = new Function('$', '$input', '$execution', '$runIndex', js);
  const r = fn($, $input, { id: 'test' }, 0);
  return Array.isArray(r) ? r[0].json : r;
}

let fail = 0;
const check = (t, cond, extra) => {
  console.log((cond ? '  ok    ' : '  FALLA ') + t + (cond ? '' : '  <<< ' + (extra || '')));
  if (!cond) fail++;
};

console.log('\n=== A-1: el cap de volumen (999999 impresiones a3) ===');
const FILA = {
  producto_id: 1, nombre_canonico: 'Impresiones a3 tonner negro', variante_id: 1,
  variante: 'única', precio_lista: '400', unidad: 'Hoja', por_pagina: true, por_pack: null,
  rangos_cantidad: null, tiene_reglas: false, solo_descuentos: false, mostrable: true,
  atributos: { unidad_venta: 'hoja', multiplica: true }, atributos_producto: {},
  score: 5, n_tokens: 3, idx: 1, orden: 1, familias: [], ejes_variantes: {},
};
const calcular = (cant) => {
  const armados = correr('Armar Candidatos', [FILA], {
    'Leer Selector': {
      userMessage: 'x', conversation: [],
      seleccion: { terminos: [], productos: [], cantidad: cant },
    },
  });
  return correr('Calcular Montos', { output: { elegidos: [{ idx: 1, confianza: 0.9 }] } },
    { 'Armar Candidatos': armados, 'Decidir': { avisoDado: false } });
};

const gigante = calcular(999999);
const h = gigante.hechos[0];
check('NO emite el total de nueve cifras', h && h.total === null, JSON.stringify(h && h.total));
check('el motivo es volumen', h && h.motivoSinTotal === 'volumen', h && h.motivoSinTotal);
check('SI conserva el precio unitario', h && h.monto === 400, JSON.stringify(h && h.monto));
check('$399.999.600 no aparece en ningun lado',
  !/399\.?999\.?600/.test(JSON.stringify(gigante)), 'el total gigante volvio');
check('el unitario queda autorizado', (gigante.montosAutorizados || []).includes(400));
check('el prompt explica el volumen sin inventar causa',
  /mucho volumen/.test(gigante.promptAgente) && /NO multipliques/.test(gigante.promptAgente));

const normal = calcular(200);
check('un pedido normal SIGUE dando total', normal.hechos[0] && normal.hechos[0].total === 80000,
  JSON.stringify(normal.hechos[0] && normal.hechos[0].total));
check('el total normal queda autorizado', (normal.montosAutorizados || []).includes(80000));

const borde = calcular(500);   // 500 x 400 = 200.000 exacto
check('el borde exacto ($200.000) SI se dice', borde.hechos[0] && borde.hechos[0].total === 200000,
  JSON.stringify(borde.hechos[0] && borde.hechos[0].total));
const pasado = calcular(501);  // 200.400
check('un peso arriba del borde ya no', pasado.hechos[0] && pasado.hechos[0].total === null);

console.log('\n=== Rama info (rediseño 2026-08-03): Prompt Info + Leer Info ===');
// El diseño nuevo separa clasificar de redactar: Intención solo clasifica; Datos
// Info trae toda la tabla; Prompt Info se la inyecta al Agente Info (LLM), que
// redacta grounded o escala; Leer Info normaliza. Aca se corre lo DETERMINISTICO
// (Prompt Info y Leer Info); la salida del LLM se mockea (el harness no lo ejecuta).
const FILAS_INFO = [
  { clave: 'horario_semana', valor: 'Lunes a viernes de 8 a 20.' },
  { clave: 'horario_sabado', valor: 'Sabados de 9 a 13.' },
  { clave: 'direccion', valor: 'Rodríguez Peña 3865' },
];
const promptInfo = (userMessage, filas) => correr('Prompt Info', {}, {
  'Leer Intención': { userMessage, intencion: 'info' },
  'Datos Info': filas,
});
const leerInfo = (pInfoJson, agentOut) => correr('Leer Info', { output: agentOut },
  { 'Prompt Info': pInfoJson });

// --- Prompt Info: le inyecta al agente TODA la tabla + la pregunta ---
const pi = promptInfo('¿a qué hora abren los sábados?', FILAS_INFO);
check('Prompt Info cuenta las filas disponibles', pi.infoFilas === 3, pi.infoFilas);
check('inyecta el horario del sabado', /Sabados de 9 a 13/.test(pi.promptInfo), pi.promptInfo);
check('inyecta TODAS las filas (no filtra, de eso decide el LLM)',
  /Rodríguez Peña/.test(pi.promptInfo) && /Lunes a viernes/.test(pi.promptInfo));
check('incluye la pregunta del cliente', /abren los sábados/.test(pi.promptInfo));

const piVacio = promptInfo('¿a qué hora abren?', []);
check('tabla vacia -> infoFilas 0', piVacio.infoFilas === 0);
check('tabla vacia -> (sin datos) en el prompt', /\(sin datos\)/.test(piVacio.promptInfo));

const piCaida = promptInfo('¿a qué hora abren?', [{ error: 'connection refused' }]);
check('base caida -> filas filtradas, infoFilas 0', piCaida.infoFilas === 0);

// --- Leer Info: normaliza {respuesta, escalar} -> hayRespuesta ---
const resp = leerInfo(pi, { respuesta: 'Los sábados abrimos de 9 a 13.', escalar: false });
check('agente contesta -> hayRespuesta true', resp.hayRespuesta === true, JSON.stringify(resp.final));
check('pasa la redaccion del agente tal cual', resp.final === 'Los sábados abrimos de 9 a 13.');
check('lo marca en notas', /fuente=agente/.test(resp.notas), resp.notas);

const esc = leerInfo(pi, { respuesta: '', escalar: true });
check('agente pide escalar -> hayRespuesta false (mail)', esc.hayRespuesta === false, JSON.stringify(esc.final));
check('escala queda en notas', /fuente=escala/.test(esc.notas), esc.notas);

const vacia = leerInfo(pi, { respuesta: '', escalar: false });
check('respuesta vacia -> escala igual (no manda vacio)', vacia.hayRespuesta === false);

const sinTabla = leerInfo(piVacio, { respuesta: 'Abrimos siempre', escalar: false });
check('sin filas en la tabla NO se contesta aunque el agente redacte',
  sinTabla.hayRespuesta === false, JSON.stringify(sinTabla.final));

const baseCaida = leerInfo(piCaida, { respuesta: 'algo', escalar: false });
check('base caida degrada a escalacion, no a crash', baseCaida.hayRespuesta === false);

console.log('\n' + (fail ? 'FALLA: ' + fail : 'TODO OK'));
process.exit(fail ? 1 : 0);
