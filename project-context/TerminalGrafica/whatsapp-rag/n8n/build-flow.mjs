// Builder del workflow n8n del bot cotizador (Fase 3). FUENTE DE VERDAD del flow:
//
//   node n8n/build-flow.mjs            → n8n/flows/cotizador-v1.json
//   node n8n/build-flow.mjs --test     → corre los casos del Excel contra el auditor y sale
//
// Emite un flow de ~10 nodos: Chat Trigger → Agente (RAG + Memoria + salida estructurada)
// → Traer Escalas → Auditar Cotización → Responder. A diferencia del bot lite, acá el LLM
// SÍ escribe los números: el guardarraíl es una AUDITORÍA determinista (re-cálculo con la
// metadata del chunk), no una inyección de montos.
//
// Todo lo que depende del Excel se hornea acá al construir: el system prompt (vía
// armar-prompt.mjs), los Parámetros y la fórmula de encaje. El .xlsx sigue siendo la
// fuente única; este script es el único lugar que la traduce a JSON de n8n.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { abrir, cadenasDe, dec } from "../visor/scripts/lib-xlsx.mjs";
import { prompt as SYSTEM_PROMPT, tokens as TOKENS_PROMPT } from "./armar-prompt.mjs";

const AQUI = import.meta.dirname;
const SALIDA = process.argv.find((a) => a.endsWith(".json")) || path.join(AQUI, "flows/cotizador-v1.json");
const SOLO_TEST = process.argv.includes("--test");

// Modelo de chat: Google Gemini NATIVO, igual que el bot lite después de su migración (el plan
// de Fase 3 decía OpenRouter, pero nativo comparte la credencial con los embeddings: una menos
// que cablear, y es el camino ya probado en este n8n). Un solo lugar para cambiarlo.
const GEMINI_MODEL = "models/gemini-3.1-flash-lite";
const EMBEDDING_MODEL = "models/gemini-embedding-001"; // el MISMO que la ingesta del visor
const TABLA_RAG = "bot.rag_catalog"; // schema-cualificada: sin schema consulta public y devuelve [] EN VERDE
const TOP_K = 5; // de 7 chunks en total; subido a mano en n8n antes del humo. Revisar en Fase 4.
/** Credencial Postgres. Se re-cablea en la UI al importar; el id acá es el del n8n de dev. */
const BOT_DB = { id: "vxRQvyIwYEqGpJqc", name: "Bot Readonly DB" };

// ══════════════════════════════════════════════════════════════════════════════════════
// Lectura del Excel
// ══════════════════════════════════════════════════════════════════════════════════════
// OJO: acá NO se puede usar el lector posicional de armar-prompt.mjs. Las celdas vacías no
// existen como <c> en el XML, así que una fila de Materiales sin "Mínimo facturable" corre
// las columnas siguientes una posición y la geometría termina leyéndose como el mínimo. Para
// Instrucciones/Parámetros/Casos (columnas contiguas) da igual; para Materiales rompe.
// Este lector mapea por REFERENCIA de celda (A1) → índice de columna real.

const { entradas } = abrir();
const leer = (n) => entradas.find((e) => e.nombre === n).contenido.toString("utf8");
const wbXml = leer("xl/workbook.xml");
const HOJAS = [...wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"[^>]*\/?>/g)].map((m) => ({ nombre: m[1], rid: m[2] }));
const RID_TARGET = Object.fromEntries(
  [...leer("xl/_rels/workbook.xml.rels").matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]),
);
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));

/** "AB12" → 27 (índice 0-based de la columna). */
function indiceColumna(ref) {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Una hoja como matriz densa: `m[fila][columna]`, respetando huecos. */
function matriz(nombreHoja) {
  const h = HOJAS.find((x) => x.nombre === nombreHoja);
  if (!h) throw new Error(`el Excel no tiene la hoja "${nombreHoja}"`);
  const xml = leer("xl/" + RID_TARGET[h.rid].replace(/^\//, ""));
  const out = [];
  for (const fila of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas = [];
    // El `/>` del alternativo cubre las celdas self-closing (<c r="G2" s="11"/>): sin eso, un
    // [\s\S]*? se traga todo hasta el próximo </c> y desalinea la fila entera.
    for (const c of fila[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (c[1].match(/r="([A-Z]+\d+)"/) || [])[1];
      const v = (c[2] || "").match(/<v>([\s\S]*?)<\/v>/);
      if (!ref || !v) continue;
      celdas[indiceColumna(ref)] = dec(String(/t="s"/.test(c[1]) ? (CADENAS[Number(v[1])] ?? v[1]) : v[1])).trim();
    }
    out[Number(fila[1]) - 1] = celdas;
  }
  return out;
}

/** Matriz → objetos con el header como schema. Una columna sin dato NO genera propiedad
 *  (misma regla que visor/lib/parse.ts: el header ES el schema). */
function objetos(rows) {
  const H = (rows[0] || []).map((h) => String(h ?? "").trim());
  return rows
    .slice(1)
    .filter((r) => r && r.some((c) => String(c ?? "").trim()))
    .map((r) => {
      const o = {};
      H.forEach((h, i) => {
        const v = String(r[i] ?? "").trim();
        if (h && v) o[h] = v;
      });
      return o;
    });
}

/** Número tolerante a coma decimal y separador de miles (calca visor/lib/parse.ts). */
function num(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const limpio = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

const MATERIALES = objetos(matriz("Materiales"));
const CASOS = objetos(matriz("Casos de prueba"));

// ── Parámetros: se HORNEAN como constantes del auditor ────────────────────────────────
const PARAMS_FILAS = objetos(matriz("Parámetros"));
const paramNum = (nombre) => {
  const f = PARAMS_FILAS.find((p) => p["Parámetro"] === nombre);
  const n = f ? num(f["Valor"]) : null;
  // Si el cliente renombra la fila, el auditor se quedaría con un default inventado y
  // aprobaría totales que están mal. Mejor romper el build.
  if (n === null) throw new Error(`falta el parámetro "${nombre}" en la hoja Parámetros`);
  return n;
};
const MINIMO_TRABAJO = paramNum("Mínimo por trabajo");
const REDONDEO = paramNum("Redondeo");
/** Tope de orden de magnitud del sanity floor. El caso más caro del catálogo hoy es
 *  $64.000 (banner 4x1 m); un total por encima de esto es un error de tipeo del modelo,
 *  no un pedido grande. Se deriva del catálogo (×8) para que no envejezca a mano. */
const TOPE_MAGNITUD = (() => {
  const maxCaso = Math.max(...CASOS.map((c) => num(c["Precio correcto"]) ?? 0));
  return Math.max(500000, Math.ceil((maxCaso * 8) / 100000) * 100000);
})();

// ══════════════════════════════════════════════════════════════════════════════════════
// La fórmula de encaje — UN SOLO string
// ══════════════════════════════════════════════════════════════════════════════════════
// Cuarta copia (viven en visor/lib/geometria.ts y visor/scripts/lib-xlsx.mjs). Para que esta
// no derive, el builder la tiene como string ÚNICO: se evalúa acá para los tests y se emite
// tal cual dentro del nodo Code. No hay dos textos que mantener sincronizados.
const FUENTE_RINDE = `
/** Piezas de ancho×alto cm que entran en el área útil, probando las DOS orientaciones.
 *  El epsilon absorbe el error binario (28,3/2,83 debe dar 10, no floor(9,999…)). */
function rinde(ancho, alto, geo) {
  const { util_ancho: ua, util_alto: uh, separacion: sep } = geo || {};
  if (!(ancho > 0) || !(alto > 0) || !(ua > 0) || !(uh > 0)) return 0;
  const eje = (util, pieza) => Math.floor((util + sep) / (pieza + sep) + 1e-9);
  return Math.max(eje(ua, ancho) * eje(uh, alto), eje(ua, alto) * eje(uh, ancho), 0);
}`.trim();

// ══════════════════════════════════════════════════════════════════════════════════════
// El re-cálculo determinista — también UN SOLO string
// ══════════════════════════════════════════════════════════════════════════════════════
// Es la fórmula de la PARTE 1 de Instrucciones, en código. Se emite dentro del nodo Code y
// se evalúa acá contra los 46 casos del Excel: si el Excel y este código no coinciden, el
// build falla. Ese es el punto — el auditor tiene que reproducir la planilla del cliente.
const FUENTE_COTIZAR = `
/**
 * El tramo de la escala que contiene \`n\` unidades de cobro. \`hasta\` vacío = "de acá en
 * adelante" (así lo define la PARTE 2 del Excel).
 *
 * El PRIMER tramo cubre además todo lo que quede por debajo de su \`desde\`: en modo m2 las
 * unidades son fraccionarias (0,5 m2) y el "Desde 1" de una tarifa plana no es una cota que
 * el catálogo pretenda aplicar — no existe un tramo más barato que el primero. Sin esto,
 * media lona no matchea ningún tramo y el auditor la declara no cotizable.
 */
function tramoDe(escala, n) {
  const orden = (escala || []).slice().sort((a, b) => Number(a.desde) - Number(b.desde));
  for (let i = 0; i < orden.length; i++) {
    const t = orden[i];
    const desde = i === 0 ? -Infinity : Number(t.desde);
    const hasta = t.hasta === null || t.hasta === undefined ? Infinity : Number(t.hasta);
    if (n >= desde && n <= hasta) return t;
  }
  return null;
}

/** Redondeo al múltiplo MÁS CERCANO (no hacia arriba): 8.640 → 8.600 con paso 100.
 *  Es lo que dice la hoja Parámetros y lo que reproduce el caso de la lona 90x60. */
const redondear = (n, paso) => (paso > 0 ? Math.round(n / paso) * paso : n);

/**
 * Re-calcula una cotización desde los datos del CATÁLOGO (no desde lo que declaró el LLM).
 * Devuelve { ok, total, ... } o { ok: false, motivo } cuando no se puede cotizar.
 */
function cotizar({ modo, ancho_cm, alto_cm, cantidad, escala, geometria, rinde_cargado }) {
  const a = Number(ancho_cm), h = Number(alto_cm), q = Number(cantidad);
  if (!(a > 0) || !(h > 0) || !(q > 0)) return { ok: false, motivo: 'medida o cantidad inválida' };
  if (!Array.isArray(escala) || !escala.length) return { ok: false, motivo: 'el material no tiene escala en el catálogo' };

  let unidades, r = null;
  if (modo === 'pliego') {
    // El rinde cargado a mano gana sobre el cálculo (unidades no geométricas: bobina, plancha).
    r = rinde_cargado != null ? Number(rinde_cargado) : rinde(a, h, geometria);
    if (!(r > 0)) return { ok: false, motivo: 'la pieza no entra en la unidad de cobro (rinde 0) — derivar a consulta' };
    unidades = Math.ceil(q / r - 1e-9);
  } else if (modo === 'm2') {
    const m2Pieza = (a * h) / 10000;
    unidades = m2Pieza * q;
    // El mínimo facturable vive en el tramo (columna "Mínimo facturable" del material).
    const min = Number((escala.find((t) => t.minimo_facturable != null) || {}).minimo_facturable || 0);
    if (min > 0 && unidades < min) unidades = min;
  } else {
    return { ok: false, motivo: 'modo desconocido: ' + modo };
  }

  // El tramo se busca por UNIDADES DE COBRO (pliegos / m2), nunca por piezas pedidas.
  const tramo = tramoDe(escala, unidades);
  if (!tramo) return { ok: false, motivo: 'ningún tramo de la escala cubre ' + unidades + ' unidades' };

  const bruto = unidades * Number(tramo.precio);
  const conMinimo = Math.max(bruto, MINIMO_TRABAJO);
  const total = redondear(conMinimo, REDONDEO);
  return {
    ok: true,
    rinde: r,
    unidades_cobradas: unidades,
    precio_tramo: Number(tramo.precio),
    aplico_minimo: conMinimo > bruto + 1e-9,
    aplico_redondeo: Math.abs(total - conMinimo) > 1e-9,
    total,
  };
}`.trim();

// ══════════════════════════════════════════════════════════════════════════════════════
// Tests del builder — el gate que impide emitir un auditor que no reproduce el Excel
// ══════════════════════════════════════════════════════════════════════════════════════

/** Evalúa los dos strings de arriba en este proceso, con los parámetros horneados. */
function cargarMotor() {
  const fn = new Function(
    "MINIMO_TRABAJO",
    "REDONDEO",
    `${FUENTE_RINDE}\n${FUENTE_COTIZAR}\nreturn { rinde, cotizar, tramoDe };`,
  );
  return fn(MINIMO_TRABAJO, REDONDEO);
}

/** Escala + geometría + unidad de un material, tal como el auditor los va a leer de
 *  `metadata` en `bot.rag_catalog`. Acá se arman desde el Excel para poder testear sin base. */
function catalogoDe(material) {
  const filas = MATERIALES.filter((m) => m["Material"] === material);
  if (!filas.length) return null;
  const escala = filas
    .map((m) => ({
      desde: num(m["Desde"]) ?? 1,
      hasta: num(m["Hasta"]),
      precio: num(m["Precio por unidad"]) ?? 0,
      ...(num(m["Mínimo facturable"]) !== null && { minimo_facturable: num(m["Mínimo facturable"]) }),
    }))
    .sort((a, b) => a.desde - b.desde);
  const unidad = filas[0]["Unidad"] ?? "";
  const geoFila = filas.find((m) => m["Área útil ancho (cm)"] && m["Área útil alto (cm)"]);
  return {
    unidad,
    modo: modoDe(unidad),
    escala,
    geometria: geoFila
      ? {
          util_ancho: num(geoFila["Área útil ancho (cm)"]),
          util_alto: num(geoFila["Área útil alto (cm)"]),
          separacion: num(geoFila["Separación (cm)"]) ?? 0,
        }
      : null,
  };
}

/** Modo por PREFIJO de la unidad (calca visor/lib/parse.ts): "pliego A4" es modo pliego.
 *  Con igualdad, una unidad nueva caería al modo equivocado sin ningún aviso. */
function modoDe(unidad) {
  const u = String(unidad).trim().toLowerCase();
  if (u.startsWith("pliego")) return "pliego";
  if (u.startsWith("m2") || u.startsWith("m²")) return "m2";
  return "otro";
}

/** Los 7 rindes históricos + los bordes. Los cargó el cliente a mano: fijan la fórmula. */
const RINDES_HISTORICOS = [
  // [ancho, alto, geometría, esperado]
  [3, 3, "TROQ", 104],
  [5, 5, "TROQ", 40],
  [9, 5, "TROQ", 24],
  [7, 7, "TROQ", 18],
  [10, 10, "TROQ", 8],
  [6, 3, "TROQ", 56], // gana la orientación ROTADA
  [14, 10, "TROQ", 6], // ídem
  [12, 8, "TROQ", 10], // el ejemplo trabajado de la hoja Instrucciones
  [4, 4, "IMPR", 77], // sin separación
  [3, 3, "IMPR", 150],
  [30, 45, "TROQ", 0], // no entra en ninguna orientación
];
const GEOS = {
  TROQ: { util_ancho: 28, util_alto: 44, separacion: 0.3 },
  IMPR: { util_ancho: 31, util_alto: 46, separacion: 0 },
};

function correrTests() {
  const motor = cargarMotor();
  const fallos = [];

  for (const [a, h, g, esperado] of RINDES_HISTORICOS) {
    const got = motor.rinde(a, h, GEOS[g]);
    if (got !== esperado) fallos.push(`rinde ${a}x${h} (${g}): esperaba ${esperado}, dio ${got}`);
  }

  // Los 46 casos de la hoja: el auditor tiene que reproducir el precio que validó el cliente.
  let okCasos = 0;
  for (const c of CASOS) {
    const material = c["Material"];
    const cat = catalogoDe(material);
    if (!cat) {
      fallos.push(`caso "${c["Pedido"]}": el material "${material}" no está en Materiales`);
      continue;
    }
    const esperado = num(c["Precio correcto"]);
    const r = motor.cotizar({
      modo: cat.modo,
      ancho_cm: num(c["Ancho (cm)"]),
      alto_cm: num(c["Alto (cm)"]),
      cantidad: num(c["Cantidad"]),
      escala: cat.escala,
      geometria: cat.geometria,
      // La columna del caso es el rinde ESPERADO, no un dato de entrada: si se lo pasáramos,
      // el test no probaría la fórmula de encaje, solo la aritmética que viene después.
      rinde_cargado: null,
    });

    if (esperado === null) {
      // Caso "Derivar a consulta": el texto en la columna de precio es el resultado esperado.
      if (r.ok) fallos.push(`caso "${c["Pedido"]}": esperaba NO cotizable, dio $${r.total}`);
      else okCasos++;
      continue;
    }
    if (!r.ok) {
      fallos.push(`caso "${c["Pedido"]}": esperaba $${esperado}, no cotizó (${r.motivo})`);
      continue;
    }
    if (r.total !== esperado) {
      fallos.push(`caso "${c["Pedido"]}": esperaba $${esperado}, dio $${r.total}`);
      continue;
    }
    // Donde el Excel declara el rinde, también se verifica: un total correcto con el rinde
    // equivocado sería una coincidencia que enmascara un bug.
    const rindeEsperado = num(c["Piezas por unidad de cobro"]);
    if (rindeEsperado !== null && cat.modo === "pliego" && r.rinde !== rindeEsperado) {
      fallos.push(`caso "${c["Pedido"]}": total OK pero rinde ${r.rinde} ≠ ${rindeEsperado}`);
      continue;
    }
    okCasos++;
  }

  return { fallos, okCasos, totalCasos: CASOS.length };
}

// ══════════════════════════════════════════════════════════════════════════════════════
// Contrato de la salida estructurada del agente
// ══════════════════════════════════════════════════════════════════════════════════════
// Un item por cotización del turno; [] si el turno no cotiza (saludo, repregunta). El
// auditor no confía en NADA de esto: lo usa para saber QUÉ re-calcular y contra qué comparar.
const ESQUEMA_SALIDA = {
  type: "object",
  required: ["respuesta", "cotizaciones"],
  properties: {
    respuesta: {
      type: "string",
      description: "El mensaje tal cual se le manda al cliente por WhatsApp.",
    },
    cotizaciones: {
      type: "array",
      description: "Una entrada por producto cotizado en ESTE turno. Vacío si no cotizaste.",
      items: {
        type: "object",
        required: [
          "material_catalogo",
          "modo",
          "ancho_cm",
          "alto_cm",
          "cantidad",
          "unidades_cobradas",
          "precio_tramo",
          "total",
        ],
        properties: {
          material_catalogo: {
            type: "string",
            description: "El nombre del material EXACTO como vino de buscar_catalogo.",
          },
          modo: { type: "string", enum: ["pliego", "m2"], description: "Según la unidad del material." },
          ancho_cm: { type: "number", description: "Ancho de UNA pieza, en cm." },
          alto_cm: { type: "number", description: "Alto de UNA pieza, en cm." },
          cantidad: { type: "number", description: "Piezas que pidió el cliente." },
          rinde: {
            type: "number",
            description: "Piezas por unidad de cobro. Solo en modo pliego; 0 si no aplica.",
          },
          unidades_cobradas: { type: "number", description: "Pliegos, o m2 facturados." },
          precio_tramo: { type: "number", description: "Precio unitario del tramo que aplicó." },
          aplico_minimo: { type: "boolean", description: "Si aplicaste mínimo por trabajo o facturable." },
          aplico_redondeo: { type: "boolean" },
          total: { type: "number", description: "El número que le dijiste al cliente." },
        },
      },
    },
  },
};

// ══════════════════════════════════════════════════════════════════════════════════════
// Nodos Code
// ══════════════════════════════════════════════════════════════════════════════════════

/** Traer Escalas necesita UNA fila por material declarado. Sale del Agente (1 item con N
 *  cotizaciones) y entra a un Postgres que corre una query por item. Sin cotizaciones emite
 *  un item marcado para que la rama no se corte (un nodo sin items no ejecuta a los que siguen). */
const CODE_MATERIALES = [
  "// El Agente emite UN item con la respuesta + N cotizaciones. Traer Escalas necesita una",
  "// query POR MATERIAL, así que acá se abre en N items (deduplicados por material).",
  "const j = $input.first().json;",
  "// La salida del output parser puede venir en .output (n8n la anida) o plana.",
  "const salida = j.output && typeof j.output === 'object' ? j.output : j;",
  "const cotizaciones = Array.isArray(salida.cotizaciones) ? salida.cotizaciones : [];",
  "const materiales = [...new Set(cotizaciones.map((c) => String(c && c.material_catalogo || '')).filter(Boolean))];",
  "// Sin materiales igual emitimos UN item: si este nodo devuelve [], los nodos siguientes",
  "// no ejecutan y el turno muere sin respuesta (el mismo footgun de Leer Decisiones en el v9).",
  "if (!materiales.length) return [{ json: { material: null, sin_cotizaciones: true } }];",
  "return materiales.map((material) => ({ json: { material } }));",
].join("\n");

/** El auditor. Re-calcula cada cotización con la metadata del catálogo y compara. NO corrige:
 *  en v1 estamos midiendo y queremos VER los fallos en el chat de prueba. */
function codeAuditor() {
  return [
    "// AUDITOR DETERMINISTA. Re-calcula cada cotización desde la metadata del CATÁLOGO y la",
    "// compara contra lo que declaró el modelo. En v1 NO corrige: adjunta el veredicto para",
    "// que el chat de prueba lo muestre (estamos midiendo la Fase 4, queremos ver los fallos).",
    "//",
    "// Parámetros HORNEADOS por el builder desde la hoja Parámetros del Excel. Si cambian allá,",
    "// hay que re-generar el flow (node n8n/build-flow.mjs) y re-importarlo.",
    `const MINIMO_TRABAJO = ${MINIMO_TRABAJO};`,
    `const REDONDEO = ${REDONDEO};`,
    `const TOPE_MAGNITUD = ${TOPE_MAGNITUD};`,
    "",
    FUENTE_RINDE,
    "",
    FUENTE_COTIZAR,
    "",
    "// ── Entrada ───────────────────────────────────────────────────────────────────────",
    "const jAgente = $('Agente').first().json;",
    "const salida = jAgente.output && typeof jAgente.output === 'object' ? jAgente.output : jAgente;",
    "const respuesta = String(salida.respuesta ?? '').trim();",
    "const cotizaciones = Array.isArray(salida.cotizaciones) ? salida.cotizaciones : [];",
    "",
    "// La metadata de cada material, indexada por nombre. Traer Escalas devuelve una fila por",
    "// chunk; el chunk colección+material tiene UNA escala, así que la primera alcanza.",
    "const porMaterial = {};",
    "for (const it of $input.all()) {",
    "  const r = it.json || {};",
    "  if (!r.metadata) continue;",
    "  const md = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;",
    "  const nombre = String(md.material || '');",
    "  if (nombre && !porMaterial[nombre]) porMaterial[nombre] = md;",
    "}",
    "",
    "// ── Auditoría ─────────────────────────────────────────────────────────────────────",
    "const hallazgos = [];",
    "const detalle = [];",
    "",
    "for (const c of cotizaciones) {",
    "  const etiqueta = String(c.material_catalogo || '(sin material)');",
    "  const md = porMaterial[etiqueta];",
    "  if (!md) {",
    "    // El modelo declaró un material que no existe en el catálogo: el número no tiene respaldo.",
    "    hallazgos.push('material \"' + etiqueta + '\" no está en el catálogo (o lo escribió distinto)');",
    "    detalle.push({ material: etiqueta, estado: 'sin_catalogo', total_declarado: c.total });",
    "    continue;",
    "  }",
    "  const esperado = cotizar({",
    "    modo: md.modo,",
    "    ancho_cm: c.ancho_cm,",
    "    alto_cm: c.alto_cm,",
    "    cantidad: c.cantidad,",
    "    escala: md.escala,",
    "    geometria: md.geometria,",
    "    rinde_cargado: null,",
    "  });",
    "",
    "  if (!esperado.ok) {",
    "    hallazgos.push(etiqueta + ': no es cotizable (' + esperado.motivo + ') pero el bot cotizó $' + c.total);",
    "    detalle.push({ material: etiqueta, estado: 'no_cotizable', motivo: esperado.motivo, total_declarado: c.total });",
    "    continue;",
    "  }",
    "",
    "  // El MODO lo manda el catálogo, no el modelo: si declaró otro, el resto del desglose",
    "  // se calculó con la fórmula equivocada aunque el total dé bien de casualidad.",
    "  if (c.modo && c.modo !== md.modo) hallazgos.push(etiqueta + ': modo declarado ' + c.modo + ', catálogo dice ' + md.modo);",
    "  if (md.modo === 'pliego' && c.rinde != null && Number(c.rinde) !== esperado.rinde) {",
    "    hallazgos.push(etiqueta + ': rinde declarado ' + c.rinde + ', calculado ' + esperado.rinde);",
    "  }",
    "  if (c.unidades_cobradas != null && Math.abs(Number(c.unidades_cobradas) - esperado.unidades_cobradas) > 1e-6) {",
    "    hallazgos.push(etiqueta + ': unidades declaradas ' + c.unidades_cobradas + ', calculadas ' + esperado.unidades_cobradas);",
    "  }",
    "  if (c.precio_tramo != null && Number(c.precio_tramo) !== esperado.precio_tramo) {",
    "    hallazgos.push(etiqueta + ': precio de tramo declarado $' + c.precio_tramo + ', el que aplica es $' + esperado.precio_tramo);",
    "  }",
    "  if (Number(c.total) !== esperado.total) {",
    "    hallazgos.push(etiqueta + ': TOTAL declarado $' + c.total + ', calculado $' + esperado.total);",
    "  }",
    "",
    "  detalle.push({",
    "    material: etiqueta,",
    "    estado: Number(c.total) === esperado.total ? 'ok' : 'difiere',",
    "    total_declarado: c.total,",
    "    total_calculado: esperado.total,",
    "    rinde_declarado: c.rinde ?? null,",
    "    rinde_calculado: esperado.rinde,",
    "    unidades_calculadas: esperado.unidades_cobradas,",
    "    precio_tramo_calculado: esperado.precio_tramo,",
    "    aplico_minimo: esperado.aplico_minimo,",
    "    aplico_redondeo: esperado.aplico_redondeo,",
    "  });",
    "}",
    "",
    "// ── Sanity floor ──────────────────────────────────────────────────────────────────",
    "// Corre SIEMPRE, incluso si el desglose vino vacío o roto: son las cotas que ningún total",
    "// puede violar, independientemente de si el re-cálculo de arriba pudo hacerse.",
    "for (const c of cotizaciones) {",
    "  const t = Number(c.total);",
    "  const etiqueta = String(c.material_catalogo || '(sin material)');",
    "  if (!Number.isFinite(t) || t <= 0) { hallazgos.push(etiqueta + ': total inválido (' + c.total + ')'); continue; }",
    "  if (t < MINIMO_TRABAJO) hallazgos.push(etiqueta + ': total $' + t + ' por debajo del mínimo por trabajo ($' + MINIMO_TRABAJO + ')');",
    "  if (REDONDEO > 0 && Math.abs(t % REDONDEO) > 1e-6) hallazgos.push(etiqueta + ': total $' + t + ' no es múltiplo de ' + REDONDEO);",
    "  if (t > TOPE_MAGNITUD) hallazgos.push(etiqueta + ': total $' + t + ' fuera de rango (tope $' + TOPE_MAGNITUD + ')');",
    "}",
    "",
    "// Un número en el texto sin cotización estructurada: el desglose no se puede auditar y el",
    "// cliente igual recibe un precio. Es el caso que más queremos ver en la Fase 4.",
    "if (!cotizaciones.length && /\\$\\s?\\d/.test(respuesta)) {",
    "  hallazgos.push('la respuesta menciona un precio pero el desglose vino vacío: no se pudo auditar');",
    "}",
    "",
    "return [{ json: {",
    "  respuesta,",
    "  auditoria: {",
    "    ok: hallazgos.length === 0,",
    "    hallazgos,",
    "    cotizaciones: detalle,",
    "  },",
    "} }];",
  ].join("\n");
}

/** Responder: punto único de convergencia hacia el chat. En v1 el veredicto se MUESTRA. */
const CODE_RESPONDER = [
  "// Lo que ve el chat de prueba. En v1 el veredicto de la auditoría va PEGADO al mensaje:",
  "// estamos midiendo y queremos ver los fallos sin abrir la ejecución en n8n. En producción",
  "// (Fase 5) esta cola se saca y la política de fallo se decide con los datos de la Fase 4.",
  "const j = $input.first().json;",
  "const a = j.auditoria || { ok: true, hallazgos: [] };",
  "let output = String(j.respuesta ?? '').trim();",
  "// GUARD contra mensaje vacío: si el agente devolvió respuesta vacía, el cliente recibiría",
  "// un mensaje en blanco. Caemos a un texto seguro antes de pegar el veredicto.",
  "if (!output) output = 'Disculpá, no pude terminar de armar esa respuesta. ¿Me lo repetís o lo vemos por mail (terminalgrafica@gmail.com)?';",
  "if (!a.ok) output += '\\n\\n⚠ auditoría: ' + (a.hallazgos || []).join(' · ');",
  "return [{ json: { output, auditoria: a } }];",
].join("\n");

// ══════════════════════════════════════════════════════════════════════════════════════
// El flow
// ══════════════════════════════════════════════════════════════════════════════════════

const DESC_TOOL = [
  "Busca en el catálogo real de Terminal Gráfica por significado. Devuelve, por colección y",
  "material: la descripción, las medidas de referencia con su rinde, la geometría de la unidad",
  "de cobro (área útil y separación) y la escala de precios por tramo. Pasale lo que pide el",
  "cliente en sus palabras (ej.: 'stickers redondos para autos', 'cartel para vidriera').",
].join(" ");

const flow = {
  name: "cotizador-v1",
  nodes: [
    {
      parameters: { public: false, options: {} },
      id: "cot-chat-trigger",
      name: "Cuando llega un mensaje",
      type: "@n8n/n8n-nodes-langchain.chatTrigger",
      typeVersion: 1.1,
      position: [0, 0],
      webhookId: "cotizador-v1-chat",
    },
    {
      parameters: {
        promptType: "define",
        text: "={{ $json.chatInput }}",
        hasOutputParser: true,
        options: { systemMessage: SYSTEM_PROMPT },
      },
      id: "cot-agente",
      name: "Agente",
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.9,
      position: [240, 0],
      // El parser de salida a veces rechaza un JSON truncado del primer intento; reintentar
      // es más barato que perder el turno. Sin onError: en v1 (chat de prueba) queremos que
      // un fallo del agente se vea como fallo, no que lo tape un fallback.
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 1000,
    },
    {
      parameters: { jsCode: CODE_MATERIALES },
      id: "cot-materiales",
      name: "Materiales Declarados",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [560, 0],
    },
    {
      // Re-consulta la metadata POR LO DECLARADO, sin confiar en lo que el modelo dice haber
      // leído (mismo patrón que "Buscar Precios" del bot lite). Una query por item.
      parameters: {
        operation: "executeQuery",
        query: "select metadata\n  from bot.rag_catalog\n where metadata->>'material' = $1\n limit 1",
        options: { queryReplacement: "={{ [ String($json.material || '') ] }}" },
      },
      id: "cot-traer-escalas",
      name: "Traer Escalas",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [780, 0],
      credentials: { postgres: BOT_DB },
      // Sin filas (turno sin cotizaciones, o material inexistente) el nodo emitiría 0 items y
      // el auditor NO ejecutaría: el turno moriría sin respuesta. Con esto emite un item vacío
      // y el auditor decide (justamente, "material que no está en el catálogo" es un hallazgo).
      alwaysOutputData: true,
    },
    {
      parameters: { jsCode: codeAuditor() },
      id: "cot-auditor",
      name: "Auditar Cotización",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1000, 0],
      // El auditor recibe TODOS los items de Traer Escalas de una (una fila por material) y
      // emite un solo item con el veredicto del turno completo.
      executeOnce: false,
    },
    {
      parameters: { jsCode: CODE_RESPONDER },
      id: "cot-responder",
      name: "Responder",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1220, 0],
    },
    {
      parameters: { modelName: GEMINI_MODEL, options: { temperature: 0.2, maxOutputTokens: 1200 } },
      id: "cot-modelo",
      name: "Modelo",
      type: "@n8n/n8n-nodes-langchain.lmChatGoogleGemini",
      typeVersion: 1,
      position: [140, 240],
    },
    {
      parameters: {
        sessionIdType: "customKey",
        sessionKey: "={{ $('Cuando llega un mensaje').first().json.sessionId }}",
        contextWindowLength: 10,
      },
      id: "cot-memoria",
      name: "Memoria",
      type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
      typeVersion: 1.3,
      position: [300, 240],
    },
    {
      // PGVector en modo TOOL: embebe la consulta del agente y hace KNN sobre bot.rag_catalog.
      parameters: {
        mode: "retrieve-as-tool",
        toolName: "buscar_catalogo",
        toolDescription: DESC_TOOL,
        // Schema-cualificada a propósito: sin el `bot.` consulta public y devuelve [] EN VERDE.
        tableName: TABLA_RAG,
        topK: TOP_K,
        options: {
          // OJO: el nodo espera los nombres anidados bajo `values`. Sin ese nivel n8n los
          // DESCARTA al importar (options queda {}) sin decir nada. Pasó en la v1: se salvó
          // de casualidad porque los defaults del nodo son estos mismos cuatro nombres.
          columnNames: {
            values: {
              idColumnName: "id",
              vectorColumnName: "embedding",
              contentColumnName: "text",
              metadataColumnName: "metadata",
            },
          },
        },
      },
      id: "cot-pgvector",
      name: "buscar_catalogo",
      type: "@n8n/n8n-nodes-langchain.vectorStorePGVector",
      typeVersion: 1.3,
      position: [460, 240],
      credentials: { postgres: BOT_DB },
    },
    {
      // MISMO modelo que la ingesta del visor, o los vectores no comparan y el retrieval
      // devuelve cualquier cosa (en verde, sin error).
      parameters: { modelName: EMBEDDING_MODEL },
      id: "cot-embeddings",
      name: "Embeddings (Google Gemini)",
      type: "@n8n/n8n-nodes-langchain.embeddingsGoogleGemini",
      typeVersion: 1,
      position: [460, 440],
    },
    {
      parameters: { schemaType: "manual", inputSchema: JSON.stringify(ESQUEMA_SALIDA, null, 2) },
      id: "cot-salida",
      name: "Salida · Agente",
      type: "@n8n/n8n-nodes-langchain.outputParserStructured",
      typeVersion: 1.2,
      position: [640, 240],
    },
    {
      parameters: {
        content: [
          "## Cotizador v1 — qué cablear al importar",
          "",
          "Generado por `n8n/build-flow.mjs` desde `Catalogo-TG-v2.xlsx`. **No editar acá**:",
          "los cambios se pierden en la próxima generación. Prompt y parámetros salen del Excel.",
          "",
          "**1) Modelo** y **Embeddings (Google Gemini)**: la MISMA credencial *Google Gemini(PaLM) API*",
          `(API key de Google AI Studio). Chat: \`${GEMINI_MODEL}\`. Embeddings: \`${EMBEDDING_MODEL}\` —`,
          "el MISMO modelo que usó la ingesta del visor, o los vectores no comparan.",
          "",
          `**2) buscar_catalogo** y **Traer Escalas**: credencial Postgres \`BOT_DB\` (pooler 5432,`,
          "user `bot_runtime.<ref>`, SSL Ignore). Table Name: `bot.rag_catalog`, **schema-cualificada**",
          "(sin el `bot.` consulta public y devuelve [] en verde, sin error).",
          "",
          "**3) Antes de probar**: la tabla tiene que estar re-ingestada desde el visor con",
          "`escala` y `es_base` en la metadata. El auditor los necesita.",
          "",
          `**Parámetros horneados**: mínimo por trabajo $${MINIMO_TRABAJO} · redondeo $${REDONDEO} ·`,
          `tope de sanity $${TOPE_MAGNITUD}. Si cambian en el Excel, re-generar y re-importar.`,
        ].join("\n"),
        height: 520,
        width: 460,
      },
      id: "cot-nota",
      name: "Nota",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [0, -560],
    },
  ],
  connections: {
    "Cuando llega un mensaje": { main: [[{ node: "Agente", type: "main", index: 0 }]] },
    Agente: { main: [[{ node: "Materiales Declarados", type: "main", index: 0 }]] },
    "Materiales Declarados": { main: [[{ node: "Traer Escalas", type: "main", index: 0 }]] },
    "Traer Escalas": { main: [[{ node: "Auditar Cotización", type: "main", index: 0 }]] },
    "Auditar Cotización": { main: [[{ node: "Responder", type: "main", index: 0 }]] },
    Modelo: { ai_languageModel: [[{ node: "Agente", type: "ai_languageModel", index: 0 }]] },
    Memoria: { ai_memory: [[{ node: "Agente", type: "ai_memory", index: 0 }]] },
    buscar_catalogo: { ai_tool: [[{ node: "Agente", type: "ai_tool", index: 0 }]] },
    "Embeddings (Google Gemini)": { ai_embedding: [[{ node: "buscar_catalogo", type: "ai_embedding", index: 0 }]] },
    "Salida · Agente": { ai_outputParser: [[{ node: "Agente", type: "ai_outputParser", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
};

// ══════════════════════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════════════════════

const { fallos, okCasos, totalCasos } = correrTests();

console.log(`rindes históricos: ${RINDES_HISTORICOS.length} · casos del Excel: ${okCasos}/${totalCasos}`);
if (fallos.length) {
  console.error(`\n✗ ABORTADO: el auditor no reproduce el Excel (${fallos.length} fallos):`);
  for (const f of fallos) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("✓ el auditor reproduce el Excel entero.");

if (SOLO_TEST) process.exit(0);

console.log(`system prompt: ~${TOKENS_PROMPT} tokens`);

mkdirSync(path.dirname(SALIDA), { recursive: true });
writeFileSync(SALIDA, JSON.stringify(flow, null, 2) + "\n");
console.log(`\n✓ ${flow.nodes.length} nodos → ${path.relative(process.cwd(), SALIDA)}`);
