// Test de los NODOS CODE del flow, contra el JSON ya emitido:
//
//   node n8n/build-flow.mjs && node n8n/test-auditor.mjs
//
// Corre "Auditar Cotización", "Materiales Declarados" y "Responder" TAL CUAL quedaron en el
// JSON, con un $input/$() falsos que imitan a n8n. Cubre lo que el harness del builder no
// puede: leer la metadata que llega de Postgres y compararla contra lo que declaró el modelo.
//
// `build-flow.mjs --test` prueba la ARITMÉTICA (46 casos del Excel). Esto prueba el CABLEADO:
// formas de dato raras (metadata como string, salida sin .output), turnos sin cotizaciones,
// materiales inventados, y que el veredicto llegue al mensaje del chat.
import { readFileSync } from "node:fs";
import path from "node:path";

const AQUI = import.meta.dirname;
const flow = JSON.parse(readFileSync(path.join(AQUI, "flows/cotizador-v1.json"), "utf8"));
const codigo = flow.nodes.find((n) => n.name === "Auditar Cotización").parameters.jsCode;
const codigoMat = flow.nodes.find((n) => n.name === "Materiales Declarados").parameters.jsCode;
const codigoResp = flow.nodes.find((n) => n.name === "Responder").parameters.jsCode;

/** Corre un nodo Code con $input/$() simulados. */
function correrCode(js, { items = [], nodos = {} }) {
  const $input = {
    first: () => items[0],
    all: () => items,
  };
  const $ = (nombre) => {
    if (!(nombre in nodos)) throw new Error(`el nodo "${nombre}" no ejecutó en esta rama`);
    return { first: () => nodos[nombre][0], all: () => nodos[nombre] };
  };
  return new Function("$input", "$", js)($input, $);
}

// La metadata REAL que la ingesta del visor escribe (chunk colección+material).
const MD_PAPEL = {
  estrategia: "coleccion-material",
  coleccion: "Stickers con forma",
  material: "Papel autoadhesivo troquelado o medio corte",
  unidad: "pliego A3",
  modo: "pliego",
  productos: 8,
  es_base: true,
  escala: [
    { desde: 1, hasta: 1, precio: 2500 },
    { desde: 2, hasta: 10, precio: 2200 },
    { desde: 11, hasta: 50, precio: 2000 },
    { desde: 51, hasta: 100, precio: 1900 },
    { desde: 101, hasta: null, precio: 1710 },
  ],
  geometria: { util_ancho: 28, util_alto: 44, separacion: 0.3 },
};
const MD_LONA = {
  estrategia: "coleccion-material",
  coleccion: "Banners y lonas",
  material: "Lona",
  unidad: "m2",
  modo: "m2",
  es_base: false,
  escala: [{ desde: 1, hasta: null, precio: 16000, minimo_facturable: 0.5 }],
};

const casos = [
  {
    nombre: "250 stickers 3x3 — el bot acierta",
    agente: {
      output: {
        respuesta: "250 stickers de 3x3 te salen $6.600.",
        cotizaciones: [{ material_catalogo: MD_PAPEL.material, modo: "pliego", ancho_cm: 3, alto_cm: 3, cantidad: 250, rinde: 104, unidades_cobradas: 3, precio_tramo: 2200, aplico_minimo: false, aplico_redondeo: false, total: 6600 }],
      },
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: true,
  },
  {
    nombre: "el bot se equivoca de RINDE (declara 40 en vez de 104)",
    agente: {
      output: {
        respuesta: "250 stickers de 3x3: $15.400.",
        cotizaciones: [{ material_catalogo: MD_PAPEL.material, modo: "pliego", ancho_cm: 3, alto_cm: 3, cantidad: 250, rinde: 40, unidades_cobradas: 7, precio_tramo: 2200, aplico_minimo: false, aplico_redondeo: false, total: 15400 }],
      },
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: false,
  },
  {
    nombre: "el bot busca el TRAMO por piezas en vez de por pliegos",
    agente: {
      output: {
        respuesta: "250 stickers de 3x3: $5.130.",
        cotizaciones: [{ material_catalogo: MD_PAPEL.material, modo: "pliego", ancho_cm: 3, alto_cm: 3, cantidad: 250, rinde: 104, unidades_cobradas: 3, precio_tramo: 1710, aplico_minimo: false, aplico_redondeo: false, total: 5130 }],
      },
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: false,
  },
  {
    nombre: "lona 90x60 — redondeo correcto ($8.600)",
    agente: {
      output: {
        respuesta: "La lona de 90x60 sale $8.600.",
        cotizaciones: [{ material_catalogo: "Lona", modo: "m2", ancho_cm: 90, alto_cm: 60, cantidad: 1, rinde: 0, unidades_cobradas: 0.54, precio_tramo: 16000, aplico_minimo: false, aplico_redondeo: true, total: 8600 }],
      },
    },
    filas: [{ metadata: MD_LONA }],
    esperaOk: true,
  },
  {
    nombre: "10 stickers 3x3 — mínimo por trabajo ($4.000)",
    agente: {
      output: {
        respuesta: "Salen $4.000, y por ese precio te llevás hasta 104 de esa medida.",
        cotizaciones: [{ material_catalogo: MD_PAPEL.material, modo: "pliego", ancho_cm: 3, alto_cm: 3, cantidad: 10, rinde: 104, unidades_cobradas: 1, precio_tramo: 2500, aplico_minimo: true, aplico_redondeo: false, total: 4000 }],
      },
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: true,
  },
  {
    nombre: "material INVENTADO por el modelo",
    agente: {
      output: {
        respuesta: "Los stickers en vinilo espejado salen $9.000.",
        cotizaciones: [{ material_catalogo: "Vinilo espejado premium", modo: "pliego", ancho_cm: 5, alto_cm: 5, cantidad: 100, rinde: 40, unidades_cobradas: 3, precio_tramo: 3000, aplico_minimo: false, aplico_redondeo: false, total: 9000 }],
      },
    },
    filas: [{}], // alwaysOutputData: item vacío, sin metadata
    esperaOk: false,
  },
  {
    nombre: "pieza que NO entra (30x45) y el bot igual cotiza",
    agente: {
      output: {
        respuesta: "20 stickers de 30x45 salen $12.000.",
        cotizaciones: [{ material_catalogo: MD_PAPEL.material, modo: "pliego", ancho_cm: 30, alto_cm: 45, cantidad: 20, rinde: 1, unidades_cobradas: 20, precio_tramo: 2000, aplico_minimo: false, aplico_redondeo: false, total: 12000 }],
      },
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: false,
  },
  {
    nombre: "saludo — sin cotizaciones, no hay nada que auditar",
    agente: { output: { respuesta: "¡Hola! Soy el asistente de Terminal Gráfica. ¿Qué necesitás?", cotizaciones: [] } },
    filas: [{ material: null, sin_cotizaciones: true }],
    esperaOk: true,
  },
  {
    nombre: "precio en el TEXTO sin desglose (el caso que más queremos ver)",
    agente: { output: { respuesta: "Eso te sale $12.000 aproximadamente.", cotizaciones: [] } },
    filas: [{ material: null, sin_cotizaciones: true }],
    esperaOk: false,
  },
  {
    nombre: "total por debajo del mínimo (sanity floor)",
    agente: {
      output: {
        respuesta: "Salen $900.",
        cotizaciones: [{ material_catalogo: MD_PAPEL.material, modo: "pliego", ancho_cm: 3, alto_cm: 3, cantidad: 5, rinde: 104, unidades_cobradas: 1, precio_tramo: 900, aplico_minimo: false, aplico_redondeo: false, total: 900 }],
      },
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: false,
  },
  {
    nombre: "metadata como STRING JSON (algunos drivers la devuelven así)",
    agente: {
      output: {
        respuesta: "250 stickers de 3x3 te salen $6.600.",
        cotizaciones: [{ material_catalogo: MD_PAPEL.material, modo: "pliego", ancho_cm: 3, alto_cm: 3, cantidad: 250, rinde: 104, unidades_cobradas: 3, precio_tramo: 2200, aplico_minimo: false, aplico_redondeo: false, total: 6600 }],
      },
    },
    filas: [{ metadata: JSON.stringify(MD_PAPEL) }],
    esperaOk: true,
  },
  {
    nombre: "salida PLANA (sin .output) — el parser a veces no anida",
    agente: {
      respuesta: "250 stickers de 3x3 te salen $6.600.",
      cotizaciones: [{ material_catalogo: MD_PAPEL.material, modo: "pliego", ancho_cm: 3, alto_cm: 3, cantidad: 250, rinde: 104, unidades_cobradas: 3, precio_tramo: 2200, aplico_minimo: false, aplico_redondeo: false, total: 6600 }],
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: true,
  },
  {
    nombre: "DOS productos en un turno (uno bien, uno mal)",
    agente: {
      output: {
        respuesta: "250 stickers 3x3: $6.600. La lona 90x60: $9.000.",
        cotizaciones: [
          { material_catalogo: MD_PAPEL.material, modo: "pliego", ancho_cm: 3, alto_cm: 3, cantidad: 250, rinde: 104, unidades_cobradas: 3, precio_tramo: 2200, aplico_minimo: false, aplico_redondeo: false, total: 6600 },
          { material_catalogo: "Lona", modo: "m2", ancho_cm: 90, alto_cm: 60, cantidad: 1, rinde: 0, unidades_cobradas: 0.54, precio_tramo: 16000, aplico_minimo: false, aplico_redondeo: true, total: 9000 },
        ],
      },
    },
    filas: [{ metadata: MD_PAPEL }, { metadata: MD_LONA }],
    esperaOk: false,
  },
];

let fallos = 0;
for (const c of casos) {
  let r;
  try {
    r = correrCode(codigo, { items: c.filas.map((json) => ({ json })), nodos: { Agente: [{ json: c.agente }] } });
  } catch (e) {
    console.log(`✗ ${c.nombre}\n    EXPLOTÓ: ${e.message}`);
    fallos++;
    continue;
  }
  const a = r[0].json.auditoria;
  const bien = a.ok === c.esperaOk;
  if (!bien) fallos++;
  console.log(`${bien ? "✓" : "✗"} ${c.nombre}`);
  console.log(`    ok=${a.ok}${a.hallazgos.length ? "  →  " + a.hallazgos.join(" · ") : ""}`);

  // Y el nodo Responder, con la salida real del auditor.
  const resp = correrCode(codigoResp, { items: r });
  const out = resp[0].json.output;
  if (!a.ok && !out.includes("⚠ auditoría:")) { console.log("    ✗ el veredicto NO llegó al mensaje"); fallos++; }
}

// El nodo "Materiales Declarados" por separado.
console.log("\n— Materiales Declarados —");
const dosProd = casos.at(-1).agente;
const mats = correrCode(codigoMat, { items: [{ json: dosProd }] });
console.log(`  2 productos → ${mats.length} items: ${mats.map((m) => m.json.material).join(" | ")}`);
if (mats.length !== 2) fallos++;
const vacio = correrCode(codigoMat, { items: [{ json: { output: { respuesta: "hola", cotizaciones: [] } } }] });
console.log(`  saludo → ${vacio.length} item (sin_cotizaciones=${vacio[0].json.sin_cotizaciones})`);
if (vacio.length !== 1) { console.log("  ✗ un turno sin cotizaciones NO puede emitir 0 items"); fallos++; }
const dup = correrCode(codigoMat, { items: [{ json: { output: { cotizaciones: [{ material_catalogo: "Lona" }, { material_catalogo: "Lona" }] } } }] });
console.log(`  mismo material x2 → ${dup.length} item (dedup)`);
if (dup.length !== 1) fallos++;

console.log(fallos ? `\n✗ ${fallos} FALLOS` : "\n✓ todo el camino del auditor anda");
process.exitCode = fallos ? 1 : 0;
