// Test de los NODOS CODE del flow, contra el JSON ya emitido:
//
//   node n8n/build-flow.mjs && node n8n/test-auditor.mjs
//
// Corre "Auditar Cotización", "Materiales Declarados" y "Responder" TAL CUAL quedaron en el
// JSON, con un $input/$() falsos que imitan a n8n. Cubre lo que el harness del builder no
// puede: leer la metadata que llega de Postgres y armar el mensaje final.
//
// `build-flow.mjs --test` prueba la ARITMÉTICA (46 casos del Excel). Esto prueba el CABLEADO
// y, desde v2, LO QUE SALE AL CHAT: el precio ya no lo escribe el modelo, así que lo que hay
// que verificar es que el número correcto llegue al mensaje y que un marcador sin precio
// NUNCA salga crudo.
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

/**
 * Un chunk AGRUPADO: las tres presentaciones de un mismo producto (100/500/1000 tarjetas)
 * en un solo chunk. `material` es la primera; las otras viven en `variantes`. Modela lo que
 * emite chunk.ts cuando los materiales comparten Familia.
 */
const MD_TARJETAS = {
  estrategia: "coleccion-material",
  coleccion: "Tarjetas personales",
  material: "Tarjetas 9x5 simple faz x100",
  familia: "Tarjetas 9x5 simple faz",
  unidad: "paquete de 100 tarjetas",
  modo: "item",
  es_base: false,
  sin_minimo: false,
  escala: [{ desde: 1, hasta: null, precio: 13200 }],
  variantes: [
    { material: "Tarjetas 9x5 simple faz x100", unidad: "paquete de 100 tarjetas", modo: "item", sin_minimo: false, escala: [{ desde: 1, hasta: null, precio: 13200 }] },
    { material: "Tarjetas 9x5 simple faz x500", unidad: "paquete de 500 tarjetas", modo: "item", sin_minimo: false, escala: [{ desde: 1, hasta: null, precio: 28000 }] },
    { material: "Tarjetas 9x5 simple faz x1000", unidad: "paquete de 1000 tarjetas", modo: "item", sin_minimo: false, escala: [{ desde: 1, hasta: null, precio: 42000 }] },
  ],
};

/** El modelo ahora declara SOLO qué cotizar: material, medida de una pieza y cantidad. */
const cot = (material, ancho_cm, alto_cm, cantidad) => ({
  material_catalogo: material,
  ancho_cm,
  alto_cm,
  cantidad,
});

const casos = [
  // ── Chunk agrupado: las 3 presentaciones viven en UN chunk ──────────────────────────
  {
    nombre: "agrupado · 100 tarjetas → la primera variante, $13.200",
    agente: {
      output: {
        respuesta: "100 tarjetas simple faz te salen {P1}.",
        cotizaciones: [cot("Tarjetas 9x5 simple faz x100", 9, 5, 1)],
      },
    },
    filas: [{ metadata: MD_TARJETAS }],
    esperaOk: true,
    esperaEnMensaje: ["$13.200"],
  },
  {
    nombre: "agrupado · 500 tarjetas → variante que NO es la primera del chunk",
    // El caso que motivó agrupar: el material declarado no es `md.material`, vive en
    // `variantes`. Sin leerlas, el auditor no lo encontraría y derivaría a consulta.
    agente: {
      output: {
        respuesta: "500 tarjetas simple faz te salen {P1}.",
        cotizaciones: [cot("Tarjetas 9x5 simple faz x500", 9, 5, 1)],
      },
    },
    filas: [{ metadata: MD_TARJETAS }],
    esperaOk: true,
    esperaEnMensaje: ["$28.000"],
    noEsperaEnMensaje: ["$13.200", "$66.000"], // ni la 1ª variante ni 5 x el precio de 100
  },
  {
    nombre: "agrupado · 1000 tarjetas → la última variante, $42.000",
    agente: {
      output: {
        respuesta: "1000 tarjetas te salen {P1}.",
        cotizaciones: [cot("Tarjetas 9x5 simple faz x1000", 9, 5, 1)],
      },
    },
    filas: [{ metadata: MD_TARJETAS }],
    esperaOk: true,
    esperaEnMensaje: ["$42.000"],
  },
  {
    nombre: "agrupado · el modelo pide 5 paquetes de 100 en vez del pack de 500",
    // Cotiza $66.000 en vez de $28.000: caro, pero NO es un error del auditor — hizo la
    // cuenta que le pidieron. Queda registrado para saber qué pasa si el modelo elige mal
    // la presentación; el chunk lo desalienta con "no se calcula proporcionalmente".
    agente: {
      output: {
        respuesta: "Salen {P1}.",
        cotizaciones: [cot("Tarjetas 9x5 simple faz x100", 9, 5, 5)],
      },
    },
    filas: [{ metadata: MD_TARJETAS }],
    esperaOk: true,
    esperaEnMensaje: ["$66.000"],
  },
  {
    nombre: "agrupado · el modelo confunde tarjetas con paquetes (500 x $13.200)",
    // El riesgo grande: el esquema le pide "piezas que pidió el cliente" y la unidad de
    // cobro es un paquete de 100. Si declara 500, el total se va a $6.600.000 y el tope de
    // sanity ($600.000) lo ataja: deriva a consulta en vez de mandar un disparate.
    agente: {
      output: {
        respuesta: "500 tarjetas salen {P1}.",
        cotizaciones: [cot("Tarjetas 9x5 simple faz x100", 9, 5, 500)],
      },
    },
    filas: [{ metadata: MD_TARJETAS }],
    esperaOk: false,
    esperaEnMensaje: ["terminalgrafica@gmail.com"],
    noEsperaEnMensaje: ["$6.600.000"],
  },
  {
    nombre: "agrupado · cantidad intermedia (300) → no hay presentación, deriva",
    // TG no vende 300: no hay material que lo cubra. El modelo no debería declararlo, pero
    // si lo hace con un nombre inventado el auditor no lo encuentra y deriva.
    agente: {
      output: {
        respuesta: "300 tarjetas salen {P1}.",
        cotizaciones: [cot("Tarjetas 9x5 simple faz x300", 9, 5, 1)],
      },
    },
    filas: [{ metadata: MD_TARJETAS }],
    esperaOk: false,
    esperaEnMensaje: ["terminalgrafica@gmail.com"],
  },
  {
    nombre: "250 stickers 3x3 → el nodo calcula $6.600",
    agente: {
      output: {
        respuesta: "250 stickers de 3x3 te salen {P1}.",
        cotizaciones: [cot(MD_PAPEL.material, 3, 3, 250)],
      },
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: true,
    esperaEnMensaje: ["$6.600"],
  },
  {
    nombre: "lona 90x60 → redondeo al múltiplo más cercano ($8.600, no $8.700)",
    agente: {
      output: { respuesta: "La lona de 90x60 sale {P1}.", cotizaciones: [cot("Lona", 90, 60, 1)] },
    },
    filas: [{ metadata: MD_LONA }],
    esperaOk: true,
    esperaEnMensaje: ["$8.600"],
    noEsperaEnMensaje: ["$8.700", "$8.640"],
  },
  {
    nombre: "10 stickers 3x3 → mínimo por trabajo ($4.000)",
    agente: {
      output: {
        respuesta: "Salen {P1}, y por ese precio te llevás hasta 104 de esa medida.",
        cotizaciones: [cot(MD_PAPEL.material, 3, 3, 10)],
      },
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: true,
    esperaEnMensaje: ["$4.000", "hasta 104"],
  },
  {
    nombre: "100 stickers vinilo UV 5x5 → mínimo facturable del material",
    agente: {
      output: { respuesta: "Salen {P1}.", cotizaciones: [cot("Lona", 5, 5, 100)] },
    },
    filas: [{ metadata: MD_LONA }],
    esperaOk: true,
    // 0,25 m2 < mínimo 0,5 → 0,5 × 16.000 = $8.000
    esperaEnMensaje: ["$8.000"],
  },

  // ── Los casos donde NO puede salir un precio ────────────────────────────────────────
  {
    nombre: "pieza que NO entra (30x45) → deriva a consulta, sin número",
    agente: {
      output: { respuesta: "20 stickers de 30x45 salen {P1}.", cotizaciones: [cot(MD_PAPEL.material, 30, 45, 20)] },
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: false,
    esperaEnMensaje: ["terminalgrafica@gmail.com"],
    // El fallo de la Fase 4: el bot dijo "$5.000" por algo que no entra en el pliego.
    noEsperaEnMensaje: ["{P1}", "$"],
  },
  {
    nombre: "material INVENTADO por el modelo → deriva, no cotiza",
    agente: {
      output: {
        respuesta: "Los stickers en vinilo espejado salen {P1}.",
        cotizaciones: [cot("Vinilo espejado premium", 5, 5, 100)],
      },
    },
    filas: [{}], // alwaysOutputData: item vacío, sin metadata
    esperaOk: false,
    esperaEnMensaje: ["terminalgrafica@gmail.com"],
    noEsperaEnMensaje: ["{P1}"],
  },

  // ── El modelo saliéndose del contrato ───────────────────────────────────────────────
  {
    nombre: "el modelo escribe el precio A MANO en vez del marcador",
    agente: {
      output: {
        respuesta: "250 stickers de 3x3 te salen $7.000.",
        cotizaciones: [cot(MD_PAPEL.material, 3, 3, 250)],
      },
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: false, // el hallazgo tiene que aparecer: es un número sin respaldo
    // Y además NO puede salir: un precio que no pasó por el cálculo es justo lo que este
    // rediseño elimina. Sin esto el bot volvería a mandar el número inventado del modelo.
    esperaEnMensaje: ["terminalgrafica@gmail.com"],
    noEsperaEnMensaje: ["$7.000"],
  },
  {
    nombre: "marcadores y cotizaciones no cuadran (dos {Pn}, una cotización)",
    agente: {
      output: {
        respuesta: "Los stickers salen {P1} y las etiquetas {P2}.",
        cotizaciones: [cot(MD_PAPEL.material, 3, 3, 250)],
      },
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: false,
    // {P2} no tiene cotización → no puede salir crudo al chat.
    noEsperaEnMensaje: ["{P2}"],
  },

  // ── Turnos que no cotizan ──────────────────────────────────────────────────────────
  {
    nombre: "saludo — sin cotizaciones ni marcadores",
    agente: { output: { respuesta: "¡Hola! Soy el asistente de Terminal Gráfica. ¿Qué necesitás?", cotizaciones: [] } },
    filas: [{ material: null, sin_cotizaciones: true }],
    esperaOk: true,
    esperaEnMensaje: ["Terminal Gráfica"],
  },
  {
    nombre: "repregunta — pide el dato que falta, sin precio",
    agente: { output: { respuesta: "¿De qué medida los necesitás?", cotizaciones: [] } },
    filas: [{ material: null, sin_cotizaciones: true }],
    esperaOk: true,
    esperaEnMensaje: ["¿De qué medida"],
  },

  // ── Formas de dato raras (el cableado real de n8n) ─────────────────────────────────
  {
    nombre: "metadata como STRING JSON (algunos drivers la devuelven así)",
    agente: {
      output: { respuesta: "Salen {P1}.", cotizaciones: [cot(MD_PAPEL.material, 3, 3, 250)] },
    },
    filas: [{ metadata: JSON.stringify(MD_PAPEL) }],
    esperaOk: true,
    esperaEnMensaje: ["$6.600"],
  },
  {
    nombre: "salida PLANA (sin .output) — el parser a veces no anida",
    agente: {
      respuesta: "Salen {P1}.",
      cotizaciones: [cot(MD_PAPEL.material, 3, 3, 250)],
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: true,
    esperaEnMensaje: ["$6.600"],
  },
  {
    nombre: "DOS productos en un turno → cada marcador su precio, en orden",
    agente: {
      output: {
        respuesta: "Los stickers salen {P1} y la lona {P2}.",
        cotizaciones: [cot(MD_PAPEL.material, 3, 3, 250), cot("Lona", 90, 60, 1)],
      },
    },
    filas: [{ metadata: MD_PAPEL }, { metadata: MD_LONA }],
    esperaOk: true,
    esperaEnMensaje: ["stickers salen $6.600", "lona $8.600"],
  },
  {
    nombre: "DOS productos, el segundo no cotizable → deriva TODO el mensaje",
    agente: {
      output: {
        respuesta: "Los stickers salen {P1} y los grandes {P2}.",
        cotizaciones: [cot(MD_PAPEL.material, 3, 3, 250), cot(MD_PAPEL.material, 30, 45, 20)],
      },
    },
    filas: [{ metadata: MD_PAPEL }],
    esperaOk: false,
    // Media respuesta con precio y media sin es peor que derivar entera.
    esperaEnMensaje: ["terminalgrafica@gmail.com"],
    noEsperaEnMensaje: ["$6.600", "{P2}"],
  },
  {
    nombre: "respuesta VACÍA del agente → texto seguro, nunca un mensaje en blanco",
    agente: { output: { respuesta: "", cotizaciones: [] } },
    filas: [{ material: null, sin_cotizaciones: true }],
    esperaOk: true,
    esperaEnMensaje: ["terminalgrafica@gmail.com"],
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
  const problemas = [];
  if (a.ok !== c.esperaOk) problemas.push(`esperaba ok=${c.esperaOk}, dio ok=${a.ok}`);

  // El nodo Responder, con la salida real del auditor. ESTO es lo que ve el cliente.
  let out;
  try {
    out = correrCode(codigoResp, { items: r })[0].json.output;
  } catch (e) {
    console.log(`✗ ${c.nombre}\n    Responder EXPLOTÓ: ${e.message}`);
    fallos++;
    continue;
  }

  // El mensaje SIN la cola de auditoría: eso es lo que iría a producción.
  const limpio = out.split("\n\n⚠ auditoría:")[0].split("\n(marcadores sin precio:")[0];

  for (const t of c.esperaEnMensaje ?? []) {
    if (!limpio.includes(t)) problemas.push(`el mensaje no dice "${t}"`);
  }
  for (const t of c.noEsperaEnMensaje ?? []) {
    if (limpio.includes(t)) problemas.push(`el mensaje NO debería decir "${t}"`);
  }
  // Invariante global: ningún marcador crudo puede llegar al chat, pase lo que pase.
  if (/\{P\d+\}/.test(limpio)) problemas.push("quedó un marcador {Pn} sin sustituir");
  if (!a.ok && !out.includes("⚠ auditoría:")) problemas.push("el veredicto NO llegó al mensaje");

  if (problemas.length) fallos++;
  console.log(`${problemas.length ? "✗" : "✓"} ${c.nombre}`);
  console.log(`    ok=${a.ok}${a.hallazgos.length ? "  →  " + a.hallazgos.join(" · ") : ""}`);
  console.log(`    mensaje: ${limpio.replace(/\n/g, " ⏎ ")}`);
  for (const p of problemas) console.log(`    ✗ ${p}`);
}

// El nodo "Materiales Declarados" por separado.
console.log("\n— Materiales Declarados —");
const dosProd = casos.find((c) => c.nombre.startsWith("DOS productos en un turno")).agente;
const mats = correrCode(codigoMat, { items: [{ json: dosProd }] });
console.log(`  2 productos → ${mats.length} items: ${mats.map((m) => m.json.material).join(" | ")}`);
if (mats.length !== 2) fallos++;
const vacio = correrCode(codigoMat, { items: [{ json: { output: { respuesta: "hola", cotizaciones: [] } } }] });
console.log(`  saludo → ${vacio.length} item (sin_cotizaciones=${vacio[0].json.sin_cotizaciones})`);
if (vacio.length !== 1) { console.log("  ✗ un turno sin cotizaciones NO puede emitir 0 items"); fallos++; }
const dup = correrCode(codigoMat, { items: [{ json: { output: { cotizaciones: [{ material_catalogo: "Lona" }, { material_catalogo: "Lona" }] } } }] });
console.log(`  mismo material x2 → ${dup.length} item (dedup)`);
if (dup.length !== 1) fallos++;

console.log(fallos ? `\n✗ ${fallos} FALLOS` : "\n✓ todo el camino del cotizador anda");
process.exitCode = fallos ? 1 : 0;
