// TEST de los dos fixes de la ronda del 2026-07-31 en WhatsApp real:
//
//   · CAP DE VOLUMEN — "necesito 999999 impresiones a3, cuánto en total?" cotizó
//     $399.999.600. v10 no heredó el cap_volumen de v7. El cap va al TOTAL, no al
//     turno: el precio unitario se sigue diciendo (decisión de Martin).
//
//   · RAMA INFO — "¿a qué hora abren los sábados?" hizo handoff con el horario
//     cargado en bot.info_negocio. El Agente Intención clasificó bien pero dejó
//     `respuestaInfo` vacío, y `Salida Info` no consultaba nada.
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

console.log('\n=== Rama info: "¿a que hora abren los sabados?" ===');
const FILAS_INFO = [
  { clave: 'horario_atencion', valor: 'Lunes a viernes de 8 a 20, sabados de 9 a 13.' },
  { clave: 'direccion', valor: 'Rodríguez Peña 3865' },
  { clave: 'formas_pago', valor: 'Efectivo, débito y transferencia.' },
];
const salidaInfo = (userMessage, respuestaInfo, filas) => correr('Salida Info', {}, {
  'Leer Intención': { userMessage, respuestaInfo, intencion: 'info' },
  'Datos Info': filas,
});

const sinAgente = salidaInfo('¿a qué hora abren los sábados?', '', FILAS_INFO);
check('AHORA contesta igual (antes escalaba)', sinAgente.hayRespuesta === true, JSON.stringify(sinAgente.final));
check('trae el horario real', /sabados de 9 a 13/i.test(sinAgente.final), sinAgente.final);
check('NO manda la tabla entera', !/Rodríguez Peña/.test(sinAgente.final), sinAgente.final);
check('marca que salio del respaldo', sinAgente.infoDelRespaldo === true);
check('lo deja en notas', /fuente=tabla/.test(sinAgente.notas), sinAgente.notas);

const conAgente = salidaInfo('¿a qué hora abren los sábados?', 'Los sábados abrimos de 9 a 13.', FILAS_INFO);
check('si el agente contesto, gana su redaccion', conAgente.final === 'Los sábados abrimos de 9 a 13.');
check('se marca como fuente agente', /fuente=agente/.test(conAgente.notas), conAgente.notas);

const sinDato = salidaInfo('¿tienen estacionamiento propio?', '', FILAS_INFO);
check('sin dato NO inventa: escala', sinDato.hayRespuesta === false, JSON.stringify(sinDato.final));
check('lo registra', /fuente=ninguna/.test(sinDato.notas), sinDato.notas);

const baseCaida = salidaInfo('¿a qué hora abren?', '', [{ error: 'connection refused' }]);
check('la base caida degrada a escalacion, no a crash', baseCaida.hayRespuesta === false);

const dir = salidaInfo('dónde queda el local?', '', FILAS_INFO);
check('la direccion sale para una pregunta de direccion', /Rodríguez Peña/.test(dir.final), dir.final);
check('y no le pega el horario', !/9 a 13/.test(dir.final), dir.final);

console.log('\n' + (fail ? 'FALLA: ' + fail : 'TODO OK'));
process.exit(fail ? 1 : 0);
