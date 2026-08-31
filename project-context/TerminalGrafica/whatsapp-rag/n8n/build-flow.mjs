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
// Productos y Colecciones no se hornean en el flow (el bot los lee del chunk), pero el
// gate los necesita: la exención del mínimo es de la COLECCIÓN y los casos van por
// material, así que hay que cruzarlas igual que lo hace el chunk.
const PRODUCTOS = objetos(matriz("Productos"));
const COLECCIONES = objetos(matriz("Colecciones"));

/** ¿Esta línea de precio está exenta del mínimo por trabajo? La marca puede estar en el
 *  MATERIAL o en la COLECCIÓN, y alcanza con una. Calca `sinMinimoDe` de
 *  visor/lib/chunk.ts, incluida la tolerancia del "sí". */
function sinMinimoDeMaterial(material) {
  const esSi = (v) => /^(s[ií]|x|1|true|v)$/i.test(String(v ?? "").trim());
  if (MATERIALES.some((m) => m["Material"] === material && esSi(m["Sin mínimo por trabajo"]))) return true;
  const cols = new Set(PRODUCTOS.filter((p) => p["Material"] === material).map((p) => p["Colección"]));
  return COLECCIONES.some((c) => cols.has(c["Colección"]) && esSi(c["Sin mínimo por trabajo"]));
}

/** Piezas por paquete de un material, o null si se vende de a uno. Calca `paqueteDe` de
 *  visor/lib/chunk.ts: la columna manda, si está vacía se deriva de la Unidad. */
function paqueteDeMaterial(material) {
  const fila = MATERIALES.find((m) => m["Material"] === material);
  if (!fila) return null;
  const cargado = num(fila["Piezas por paquete"]);
  if (cargado && cargado > 1) return cargado;
  const u = String(fila["Unidad"] ?? "").trim().toLowerCase();
  // "pack" a secas queda AFUERA: sin número no se sabe si es un empaque o un producto que
  // se llama pack (el de los 4 libros se pide de a uno).
  if (!/^(paquete|caja|resma|juego|blister|set)\b/.test(u)) return null;
  const m = u.match(/(\d[\d.,]*)/);
  const n = m ? num(m[1]) : null;
  return n && n > 1 ? n : null;
}

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
function cotizar({ modo, ancho_cm, alto_cm, cantidad, escala, geometria, rinde_cargado, sin_minimo, paquete }) {
  const a = Number(ancho_cm), h = Number(alto_cm), q = Number(cantidad);
  if (!(q > 0)) return { ok: false, motivo: 'cantidad inválida' };
  if (!Array.isArray(escala) || !escala.length) return { ok: false, motivo: 'el material no tiene escala en el catálogo' };
  // La medida solo hace falta donde el precio depende de ella. Un anillado o un ojalillo
  // no tienen tamaño: son el trabajo. Exigirla ahí dejaría fuera media colección.
  if (modo !== 'item' && (!(a > 0) || !(h > 0))) return { ok: false, motivo: 'medida inválida' };

  let unidades, r = null;
  if (modo === 'item') {
    // Unidad de cobro = ítem. Sin geometría ni conversión.
    const p = Number(paquete);
    if (p > 1) {
      // Se vende por paquete cerrado y el cliente pide en PIEZAS ("mil tarjetas"), así que
      // hay que convertir. Sin esto se multiplicaba dos veces: el modelo declara el
      // material "…x1000" con cantidad 1000 y salían $54.000.000 por un trabajo de $54.000.
      //
      // Se exige división EXACTA: TG vende paquetes cerrados, no cantidades intermedias.
      // 150 tarjetas no son 1,5 paquetes ni se redondean a 2 (eso sería cobrarle 200 y
      // entregarle 150, una decisión comercial que no es del bot). Va a consulta.
      if (Math.abs(q / p - Math.round(q / p)) > 1e-9) {
        return { ok: false, motivo: 'se vende en paquetes de ' + p + ' y ' + q + ' no es múltiplo — derivar a consulta' };
      }
      unidades = Math.round(q / p);
    } else {
      // Se cobra de a uno (anillado, laminado, sobre): la cantidad pedida ES la cantidad
      // de unidades.
      unidades = q;
    }
  } else if (modo === 'pliego') {
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
  // El mínimo por trabajo cubre el armado y el montaje de una PRODUCCIÓN. Las colecciones
  // marcadas "Sin mínimo por trabajo" son agregados sobre un trabajo ya cobrado (laminado,
  // ojalillos): ahí el mínimo multiplicaría por 12 el precio de laminar una hoja.
  const conMinimo = sin_minimo ? bruto : Math.max(bruto, MINIMO_TRABAJO);
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
 *  Con igualdad, una unidad nueva caería al modo equivocado sin ningún aviso.
 *  `item` es lista explícita, no default: ver el comentario en parse.ts. */
function modoDe(unidad) {
  const u = String(unidad).trim().toLowerCase();
  if (u.startsWith("pliego")) return "pliego";
  if (u.startsWith("m2") || u.startsWith("m²")) return "m2";
  // "metro lineal" entra acá y NO en m2: se cobra cantidad × precio (3 metros de plano
  // escaneado = 3 × $8.000), no ancho × alto. Es "metro lineal" completo y no "metro" a
  // secas: con el prefijo suelto, "metro cuadrado" cobraría por cantidad algo que se
  // cotiza por superficie.
  if (/^(unidad|hoja|paquete|pack|item|ítem|metro lineal)\b/.test(u)) return "item";
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
      // La exención es de la COLECCIÓN; el caso solo nombra el material, así que se cruza
      // por los productos igual que lo hace el chunk.
      sin_minimo: sinMinimoDeMaterial(material),
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

  // El modo `item`: unidad de cobro = ítem. Es lo que usan los productos que no se cotizan
  // por superficie (anillado, sobres, tarjetas por paquete cerrado).
  {
    const porUnidad = [{ desde: 1, hasta: 200, precio: 250 }, { desde: 201, hasta: null, precio: 220 }];
    const item = (cantidad, extra = {}) =>
      motor.cotizar({ modo: "item", cantidad, escala: porUnidad, ancho_cm: 23.5, alto_cm: 12, ...extra });

    // La cantidad pedida ES la cantidad de unidades: sin rinde ni conversión.
    const r250 = item(250);
    if (!r250.ok || r250.total !== 55000) {
      fallos.push(`item: 250 sobres esperaba $55000, dio ${r250.ok ? "$" + r250.total : r250.motivo}`);
    } else if (r250.unidades_cobradas !== 250) {
      fallos.push(`item: 250 sobres cobró ${r250.unidades_cobradas} unidades, no 250`);
    }

    // El borde de tramo: 201 salta al tramo más barato y el total redondea a $100.
    const r201 = item(201);
    if (!r201.ok || r201.total !== 44200) {
      fallos.push(`item: 201 sobres esperaba $44200, dio ${r201.ok ? "$" + r201.total : r201.motivo}`);
    }

    // Sin medida tiene que cotizar igual: un anillado no tiene tamaño. Va exento del
    // mínimo (es una terminación), que es como se va a cargar de verdad.
    const sinMedida = motor.cotizar({
      modo: "item", cantidad: 1, escala: [{ desde: 1, hasta: null, precio: 2400 }],
      ancho_cm: null, alto_cm: null, sin_minimo: true,
    });
    if (!sinMedida.ok || sinMedida.total !== 2400) {
      fallos.push(`item: sin medida esperaba $2400, dio ${sinMedida.ok ? "$" + sinMedida.total : sinMedida.motivo}`);
    }

    // Una unidad que NO está en la lista sigue siendo un error, no un ítem por default.
    const desconocido = motor.cotizar({
      modo: "otro", cantidad: 1, escala: porUnidad, ancho_cm: 10, alto_cm: 10,
    });
    if (desconocido.ok) fallos.push("item: el modo 'otro' cotizó en vez de rechazar");
  }

  // Paquete cerrado: el cliente pide PIEZAS, el catálogo cobra PAQUETES.
  //
  // Los números salen de la ejecución 305 leída en vivo: el modelo declaró el material
  // "Tarjetas 9x5 doble faz x1000" con cantidad 1000, y el auditor hizo 1000 × $54.000 =
  // $54.000.000. Lo atajó el tope de sanity, pero por accidente: el mismo error con un
  // paquete más barato pasa el tope y le llega al cliente.
  {
    const mil = [{ desde: 1, hasta: null, precio: 54000 }];
    const cien = [{ desde: 1, hasta: null, precio: 16500 }];
    const pack = (cantidad, paquete, escala) =>
      motor.cotizar({ modo: "item", cantidad, paquete, escala, ancho_cm: null, alto_cm: null });

    // El caso que motivó todo: pedir 1000 piezas del material que YA es de 1000.
    const r = pack(1000, 1000, mil);
    if (!r.ok || r.total !== 54000) {
      fallos.push(`paquete: 1000 piezas del x1000 esperaba $54000, dio ${r.ok ? "$" + r.total : r.motivo}`);
    } else if (r.unidades_cobradas !== 1) {
      fallos.push(`paquete: 1000 piezas del x1000 cobró ${r.unidades_cobradas} paquetes, no 1`);
    }

    // Múltiplo exacto: 1000 piezas del paquete de 100 son 10 paquetes.
    const diez = pack(1000, 100, cien);
    if (!diez.ok || diez.total !== 165000) {
      fallos.push(`paquete: 1000 piezas del x100 esperaba $165000, dio ${diez.ok ? "$" + diez.total : diez.motivo}`);
    }

    // Un solo paquete pedido en piezas.
    const uno = pack(100, 100, cien);
    if (!uno.ok || uno.total !== 16500) {
      fallos.push(`paquete: 100 piezas del x100 esperaba $16500, dio ${uno.ok ? "$" + uno.total : uno.motivo}`);
    }

    // Cantidad intermedia: TG vende paquetes cerrados. 150 no es 1,5 paquetes ni se
    // redondea a 2 — va a consulta. (El modelo ya respondía esto solo; ahora el auditor
    // no lo puede contradecir con un número.)
    const intermedia = pack(150, 100, cien);
    if (intermedia.ok) {
      fallos.push(`paquete: 150 piezas de a 100 cotizó $${intermedia.total} en vez de derivar`);
    }

    // Sin `paquete` NO se divide: la mayoría de los ítems se cobran de a uno y dividir ahí
    // sería inventar un descuento. Es el default seguro para un chunk viejo sin el campo.
    const suelto = motor.cotizar({
      modo: "item", cantidad: 3, escala: [{ desde: 1, hasta: null, precio: 2400 }],
      ancho_cm: null, alto_cm: null, sin_minimo: true,
    });
    if (!suelto.ok || suelto.total !== 7200) {
      fallos.push(`paquete: sin el campo esperaba 3 × $2400 = $7200, dio ${suelto.ok ? "$" + suelto.total : suelto.motivo}`);
    }

    // `paquete: 1` es "se vende de a uno", no una división por uno con otro camino.
    const unitario = pack(3, 1, [{ desde: 1, hasta: null, precio: 2400 }]);
    if (!unitario.ok || unitario.unidades_cobradas !== 3) {
      fallos.push(`paquete: con paquete=1 esperaba 3 unidades, dio ${unitario.ok ? unitario.unidades_cobradas : unitario.motivo}`);
    }

    // El tramo se busca por PAQUETES, no por piezas. Con escala por tramos, pedir 1000
    // piezas de a 100 tiene que caer en el tramo de 10, no en el de 1000.
    const escalonada = [{ desde: 1, hasta: 5, precio: 20000 }, { desde: 6, hasta: null, precio: 15000 }];
    const t = pack(1000, 100, escalonada);
    if (!t.ok || t.precio_tramo !== 15000) {
      fallos.push(`paquete: 10 paquetes esperaba el tramo de $15000, dio ${t.ok ? "$" + t.precio_tramo : t.motivo}`);
    }
  }

  // Los modos que el Excel produce, comparados contra la unidad escrita. Si alguien carga
  // una unidad nueva y cae en `otro`, el producto entra al catálogo pero no se puede
  // cotizar: el chunk sale con precio y el bot deriva todo a consulta.
  {
    const CASOS_MODO = [
      ["pliego A3", "pliego"], ["pliego A4", "pliego"],
      ["m2", "m2"], ["m²", "m2"],
      ["unidad", "item"], ["hoja", "item"], ["paquete de 100", "item"], ["pack", "item"],
      // El nombre engaña: se cobra cantidad × precio, no ancho × alto. Y el par de abajo
      // es el que importa: con el prefijo escrito "metro" a secas, el CUADRADO también
      // caía en item y cobraba por cantidad algo que se cotiza por superficie.
      ["metro lineal", "item"], ["metro cuadrado", "otro"],
      ["bobina", "otro"], ["", "otro"],
    ];
    for (const [unidad, esperado] of CASOS_MODO) {
      const got = modoDe(unidad);
      if (got !== esperado) fallos.push(`modoDe("${unidad}"): esperaba "${esperado}", dio "${got}"`);
    }
    // Y lo que de verdad importa: que NINGÚN material del Excel caiga en `otro`.
    for (const m of MATERIALES) {
      const unidad = m["Unidad"] ?? "";
      if (modoDe(unidad) === "otro") {
        fallos.push(`el material "${m["Material"]}" tiene unidad "${unidad}", que no es un modo conocido — no se va a poder cotizar`);
      }
    }
  }

  // El paquete: cuántas piezas trae una unidad de cobro que se vende cerrada. Sin el dato,
  // el auditor cobra la cantidad pedida como si fueran paquetes (500 volantes × el precio
  // del paquete de 500). Con el dato de más, deriva un producto que sí está en el catálogo.
  {
    // La unidad tiene que decir la cantidad. Una unidad de conjunto sin número es
    // ambigua y hay que resolverla en el Excel, no adivinarla acá: "pack" puede ser un
    // empaque de 4 piezas o un producto que se llama pack y se pide de a uno.
    for (const m of MATERIALES) {
      const unidad = String(m["Unidad"] ?? "").trim().toLowerCase();
      if (!/^(paquete|caja|resma|juego|blister|set)\b/.test(unidad)) continue;
      if (!paqueteDeMaterial(m["Material"])) {
        fallos.push(
          `el material "${m["Material"]}" se vende por "${unidad}" pero no se sabe cuántas piezas trae — ` +
            `poné la cantidad en la unidad ("paquete de 100 tarjetas")`,
        );
      }
    }

    // El cruce con el NOMBRE, en las dos direcciones. Un "…x500" con unidad "paquete de
    // 100" cobra 5 veces de menos y nadie lo nota: el precio sale plausible. Y un nombre
    // sin cifra con paquete cargado suele ser el error inverso — el que cometí con el
    // "Pack 4 libros de medicina", donde el 4 es parte del NOMBRE del producto y el
    // cliente igual pide uno solo.
    for (const m of MATERIALES) {
      const p = paqueteDeMaterial(m["Material"]);
      if (!p) continue;
      const enNombre = String(m["Material"] ?? "").match(/\bx\s?(\d[\d.]*)\b/i);
      const n = enNombre ? num(enNombre[1]) : null;
      if (n && n !== p) {
        fallos.push(
          `el material "${m["Material"]}" dice x${n} en el nombre pero su paquete es de ${p} piezas`,
        );
      }
      // El paquete solo tiene sentido si el cliente pide EN PIEZAS. Esa intención se lee
      // en la unidad: "paquete de 100 tarjetas" nombra la pieza, "pack" no nombra nada.
      const unidad = String(m["Unidad"] ?? "").trim().toLowerCase();
      if (!/\d/.test(unidad)) {
        fallos.push(
          `el material "${m["Material"]}" tiene paquete de ${p} pero su unidad ("${unidad}") no dice ` +
            `de cuántas piezas — si el cliente lo pide de a uno, no lleva paquete`,
        );
      }
    }
  }

  // La exención del mínimo por trabajo (colecciones marcadas "Sin mínimo por trabajo").
  // No sale de la hoja de casos: esos van por material y la marca es de la colección.
  // Se prueba contra una escala mínima armada acá, en las DOS direcciones — que exima
  // cuando corresponde, y que NO exima cuando no.
  {
    const escalaBarata = [{ desde: 1, hasta: null, precio: 330 }];
    const comun = { modo: "pliego", ancho_cm: 21, alto_cm: 29.7, cantidad: 1, escala: escalaBarata };
    // Rinde 1: la "pieza" ocupa la unidad entera, así que se cobra 1 x $330.
    const geo = { util_ancho: 21, util_alto: 29.7, separacion: 0 };

    const exento = motor.cotizar({ ...comun, geometria: geo, sin_minimo: true });
    if (!exento.ok) {
      fallos.push(`sin_minimo: el caso exento no cotizó (${exento.motivo})`);
    } else {
      if (exento.total !== 300) {
        // 330 redondeado al múltiplo de 100 más cercano.
        fallos.push(`sin_minimo: exento esperaba $300 (330 redondeado), dio $${exento.total}`);
      }
      if (exento.aplico_minimo) fallos.push("sin_minimo: el exento marcó aplico_minimo");
    }

    const normal = motor.cotizar({ ...comun, geometria: geo, sin_minimo: false });
    if (!normal.ok) {
      fallos.push(`sin_minimo: el caso NO exento no cotizó (${normal.motivo})`);
    } else if (normal.total !== MINIMO_TRABAJO) {
      fallos.push(`sin_minimo: sin exención esperaba $${MINIMO_TRABAJO}, dio $${normal.total}`);
    }

    // Sin el campo, el default es el de siempre: se aplica el mínimo. Un chunk viejo
    // (ingestado antes de esta columna) no tiene que cambiar de comportamiento.
    const ausente = motor.cotizar({ ...comun, geometria: geo });
    if (ausente.ok && ausente.total !== MINIMO_TRABAJO) {
      fallos.push(`sin_minimo: sin el campo esperaba $${MINIMO_TRABAJO}, dio $${ausente.total}`);
    }
  }

  return { fallos, okCasos, totalCasos: CASOS.length };
}

// ══════════════════════════════════════════════════════════════════════════════════════
// Contrato de la salida estructurada del agente
// ══════════════════════════════════════════════════════════════════════════════════════
// Un item por cotización del turno; [] si el turno no cotiza (saludo, repregunta).
//
// v2 — EL MODELO YA NO ESCRIBE EL NÚMERO. La Fase 4 midió 27/46 con el LLM calculando, y
// los fallos no compartían causa (aritmética suelta, tramo mal elegido, unidades m2
// truncadas, rinde mal). El caso que lo decidió: el MISMO pedido dio $6.600 en una
// ejecución y $7.000 en otra, con rinde, unidades y tramo correctos en ambas — 3 × 2.200
// mal multiplicado. No es algo que un chunk mejor arregle: el proceso tiene varianza.
//
// Ahora el modelo declara QUÉ cotizar (material, medida, cantidad) y escribe el mensaje con
// un PLACEHOLDER {P1}, {P2}… donde va cada precio. El auditor calcula el total y otro nodo
// lo sustituye. Es el patrón del bot lite, con cálculo en vez de lookup.
const ESQUEMA_SALIDA = {
  type: "object",
  required: ["respuesta", "cotizaciones"],
  properties: {
    respuesta: {
      type: "string",
      description:
        "El mensaje para el cliente por WhatsApp. Donde vaya un precio escribí el marcador " +
        "{P1} para la primera cotización, {P2} para la segunda, y así. NUNCA escribas un " +
        "número de precio vos: el marcador se reemplaza por el total ya calculado.",
    },
    cotizaciones: {
      type: "array",
      description:
        "Una entrada por producto cotizado en ESTE turno, en el MISMO orden que los " +
        "marcadores {P1}, {P2}… del mensaje. Vacío si no cotizaste.",
      items: {
        type: "object",
        required: ["material_catalogo", "ancho_cm", "alto_cm", "cantidad"],
        properties: {
          material_catalogo: {
            type: "string",
            description: "El nombre del material EXACTO como vino de buscar_catalogo.",
          },
          ancho_cm: { type: "number", description: "Ancho de UNA pieza, en cm." },
          alto_cm: { type: "number", description: "Alto de UNA pieza, en cm." },
          // SIEMPRE en piezas, incluso cuando el material se vende por paquete: "mil
          // tarjetas" es 1000, no 1. La conversión a unidades de cobro la hace el auditor
          // con `paquete` del catálogo. Cambiar esto a paquetes le devuelve al modelo una
          // cuenta que ya no tiene que hacer, y las dos lecturas dejan de distinguirse.
          cantidad: { type: "number", description: "Piezas que pidió el cliente (1000 tarjetas = 1000, aunque se vendan por paquete)." },
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

/** El COTIZADOR determinista. v2: ya no compara contra lo que dijo el modelo — CALCULA el
 *  total desde el catálogo y lo devuelve para que el nodo Responder lo inyecte en el
 *  mensaje. El modelo eligió qué cotizar; el número es de acá. */
function codeAuditor() {
  return [
    "// COTIZADOR DETERMINISTA. Toma lo que el modelo DECLARÓ querer cotizar (material, medida,",
    "// cantidad) y calcula el total desde la metadata del catálogo. El número que sale de acá",
    "// es el que ve el cliente: el modelo ya no escribe precios, escribe {P1}, {P2}…",
    "//",
    "// Por qué cambió (Fase 4, 27/46 con el LLM calculando): los fallos no compartían causa —",
    "// aritmética suelta, tramo mal elegido, unidades m2 truncadas, rinde mal. El mismo pedido",
    "// llegó a dar $6.600 y $7.000 en dos ejecuciones, con rinde/unidades/tramo correctos en",
    "// las dos. Con el cálculo acá, esa clase entera de error desaparece.",
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
    "  // Un chunk AGRUPADO trae varias presentaciones del mismo producto (100/500/1000",
    "  // tarjetas, los 5 formatos de plastificado). Cada una es cotizable por su cuenta y",
    "  // tiene su propia escala: sin esto, el bot leería '500 tarjetas' en el texto y el",
    "  // auditor no encontraría con qué calcularlo.",
    "  for (const v of Array.isArray(md.variantes) ? md.variantes : []) {",
    "    const n = String(v.material || '');",
    "    if (n && !porMaterial[n]) porMaterial[n] = { ...v, coleccion: md.coleccion, geometria: md.geometria };",
    "  }",
    "}",
    "",
    "// ── Cálculo ───────────────────────────────────────────────────────────────────────",
    "// Una entrada por cotización, en el MISMO orden que los marcadores {P1}, {P2}… del",
    "// mensaje. `precio` null = no se pudo cotizar: el Responder tiene que derivar a consulta",
    "// en vez de mandar un mensaje con el marcador crudo o con un precio inventado.",
    "const hallazgos = [];",
    "const detalle = [];",
    "",
    "for (const c of cotizaciones) {",
    "  const etiqueta = String(c.material_catalogo || '(sin material)');",
    "  const md = porMaterial[etiqueta];",
    "  if (!md) {",
    "    // Material que no existe en el catálogo: no hay escala con la que calcular nada.",
    "    hallazgos.push('material \"' + etiqueta + '\" no está en el catálogo (o lo escribió distinto)');",
    "    detalle.push({ material: etiqueta, estado: 'sin_catalogo', precio: null });",
    "    continue;",
    "  }",
    "  const r = cotizar({",
    "    // El MODO lo manda el catálogo, siempre. El modelo ya ni lo declara.",
    "    modo: md.modo,",
    "    ancho_cm: c.ancho_cm,",
    "    alto_cm: c.alto_cm,",
    "    cantidad: c.cantidad,",
    "    escala: md.escala,",
    "    geometria: md.geometria,",
    "    rinde_cargado: null,",
    "    // Exención del mínimo por trabajo: la marca es de la COLECCIÓN, viene en el chunk.",
    "    sin_minimo: md.sin_minimo === true,",
    "    // Piezas por paquete. El modelo declara `cantidad` en PIEZAS ('mil tarjetas') y esto",
    "    // se cobra por paquete: sin el dato del catálogo, las dos cosas se multiplicaban.",
    "    paquete: md.paquete,",
    "  });",
    "",
    "  if (!r.ok) {",
    "    // La pieza no entra en el pliego, la medida es inválida, no hay tramo que la cubra…",
    "    // Sea cual sea el motivo, NO hay precio: el mensaje no puede salir con un número.",
    "    hallazgos.push(etiqueta + ': no cotizable (' + r.motivo + ')');",
    "    detalle.push({ material: etiqueta, estado: 'no_cotizable', motivo: r.motivo, precio: null });",
    "    continue;",
    "  }",
    "",
    "  // Sanity floor sobre el número PROPIO, no sobre el del modelo. Si el cálculo determinista",
    "  // sale de rango es un problema del catálogo (una escala mal cargada), y tampoco puede",
    "  // llegar al cliente.",
    "  if (!Number.isFinite(r.total) || r.total <= 0) {",
    "    hallazgos.push(etiqueta + ': el catálogo da un total inválido (' + r.total + ')');",
    "    detalle.push({ material: etiqueta, estado: 'total_invalido', precio: null });",
    "    continue;",
    "  }",
    "  if (r.total > TOPE_MAGNITUD) {",
    "    hallazgos.push(etiqueta + ': total $' + r.total + ' fuera de rango (tope $' + TOPE_MAGNITUD + ')');",
    "    detalle.push({ material: etiqueta, estado: 'fuera_de_rango', precio: null });",
    "    continue;",
    "  }",
    "",
    "  detalle.push({",
    "    material: etiqueta,",
    "    estado: 'ok',",
    "    precio: r.total,",
    "    rinde: r.rinde,",
    "    unidades_cobradas: r.unidades_cobradas,",
    "    precio_tramo: r.precio_tramo,",
    "    aplico_minimo: r.aplico_minimo,",
    "    aplico_redondeo: r.aplico_redondeo,",
    "    // Para presentar el mínimo como CANTIDAD sin que el modelo tenga que calcularla.",
    "    piezas_por_unidad: r.rinde ?? null,",
    "  });",
    "}",
    "",
    "// ── Chequeos sobre el MENSAJE ─────────────────────────────────────────────────────",
    "// Ahora que el número no lo escribe el modelo, lo que hay que vigilar es que no lo haya",
    "// escrito igual, ignorando el marcador. Un precio tipeado a mano en el texto es un número",
    "// sin respaldo — exactamente lo que este rediseño viene a eliminar.",
    "const marcadores = (respuesta.match(/\\{P\\d+\\}/g) || []);",
    "// Mismo regex que el Responder: los separadores de miles van ENTRE dígitos, así el punto",
    "// final de una oración no entra en la captura ('$6.600.' → '$6.600').",
    "const numerosSueltos = respuesta.replace(/\\{P\\d+\\}/g, '').match(/\\$\\s?\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d+)?/g) || [];",
    "if (numerosSueltos.length) {",
    "  hallazgos.push('el mensaje trae precios escritos a mano (' + numerosSueltos.join(' · ') + ') en vez de marcadores');",
    "}",
    "if (cotizaciones.length && !marcadores.length) {",
    "  hallazgos.push('hay ' + cotizaciones.length + ' cotización(es) pero el mensaje no tiene ningún marcador {Pn}');",
    "}",
    "if (marcadores.length !== cotizaciones.length) {",
    "  hallazgos.push('marcadores en el mensaje: ' + marcadores.length + ', cotizaciones declaradas: ' + cotizaciones.length);",
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

/** Responder: punto único de convergencia hacia el chat. v2: INYECTA los precios calculados
 *  en los marcadores {P1}, {P2}… del mensaje. El modelo nunca tipea un número. */
const CODE_RESPONDER = [
  "// Lo que ve el chat de prueba. Acá se sustituyen los marcadores {P1}, {P2}… por los totales",
  "// que calculó el nodo anterior desde el catálogo.",
  "//",
  "// REGLA DURA: un marcador sin precio NO puede llegar al cliente. Si una cotización no se",
  "// pudo calcular (la pieza no entra en el pliego, material fuera del catálogo), el mensaje",
  "// entero se reemplaza por una derivación a consulta. Es preferible derivar de más que",
  "// mandar '{P1}' crudo o, peor, un precio inventado — en la Fase 4 el bot llegó a cotizar",
  "// $5.000 por algo que no entra en el pliego.",
  "const CONSULTA = 'Esa medida la tengo que confirmar por mail: escribinos a terminalgrafica@gmail.com y te la pasamos.';",
  "const j = $input.first().json;",
  "const a = j.auditoria || { ok: true, hallazgos: [], cotizaciones: [] };",
  "const cots = Array.isArray(a.cotizaciones) ? a.cotizaciones : [];",
  "let output = String(j.respuesta ?? '').trim();",
  "",
  "// Formato de moneda argentino, igual que el resto del catálogo ($6.600).",
  "const money = (n) => '$' + Number(n).toLocaleString('es-AR');",
  "",
  "// GUARD contra mensaje vacío: si el agente devolvió respuesta vacía, el cliente recibiría",
  "// un mensaje en blanco.",
  "if (!output) output = 'Disculpá, no pude terminar de armar esa respuesta. ¿Me lo repetís o lo vemos por mail (terminalgrafica@gmail.com)?';",
  "",
  "// ── Inyección ─────────────────────────────────────────────────────────────────────",
  "// {P1} es la PRIMERA cotización (índice 0). Un marcador fuera de rango, o apuntando a una",
  "// cotización sin precio, dispara la derivación: no hay número con qué reemplazarlo.",
  "let derivar = false;",
  "const faltantes = [];",
  "output = output.replace(/\\{P(\\d+)\\}/g, (crudo, n) => {",
  "  const c = cots[Number(n) - 1];",
  "  if (!c || c.precio == null) { derivar = true; faltantes.push(crudo); return crudo; }",
  "  return money(c.precio);",
  "});",
  "",
  "// Una cotización que no se pudo calcular pero cuyo marcador el modelo nunca escribió:",
  "// igual hay que derivar, porque el turno prometía un precio que no existe.",
  "if (cots.some((c) => c.precio == null)) derivar = true;",
  "",
  "// El modelo tipeó un precio en vez de usar el marcador. Ese número no pasó por el",
  "// cálculo: es exactamente lo que este rediseño elimina, así que no puede salir. Se mira",
  "// el texto YA sustituido, porque los precios que inyectamos recién arriba son legítimos.",
  "//",
  "// El regex NO puede terminar en [.,]: '$6.600.' al final de una oración se comería el",
  "// punto y no matchearía nunca con lo inyectado (pasó: derivaba TODO, hasta los casos",
  "// buenos). Los separadores de miles van solo ENTRE dígitos.",
  "const RE_PRECIO = /\\$\\s?\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d+)?/g;",
  "const sobrantes = output.match(RE_PRECIO) || [];",
  "const inyectados = cots.filter((c) => c.precio != null).map((c) => money(c.precio));",
  "for (const s of sobrantes) {",
  "  // Un mismo precio puede aparecer dos veces (inyectado y a mano); se consume de a uno.",
  "  const i = inyectados.indexOf(s.replace(/\\s/g, ''));",
  "  if (i >= 0) inyectados.splice(i, 1);",
  "  else derivar = true;",
  "}",
  "",
  "if (derivar) output = CONSULTA;",
  "",
  "// Cinturón y tirantes: si por lo que sea quedó un marcador sin sustituir, no sale al chat.",
  "if (/\\{P\\d+\\}/.test(output)) output = CONSULTA;",
  "",
  "// El veredicto sigue pegado al mensaje MIENTRAS medimos (Fase 4). En producción esta cola",
  "// se saca; los hallazgos ya no son 'el bot calculó mal' sino 'el modelo se salió del",
  "// contrato' (escribió un número a mano, o los marcadores no cuadran con las cotizaciones).",
  "if (!a.ok) output += '\\n\\n⚠ auditoría: ' + (a.hallazgos || []).join(' · ');",
  "if (faltantes.length) output += '\\n(marcadores sin precio: ' + faltantes.join(' ') + ')';",
  "",
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
        // El material puede ser el del chunk O una de sus `variantes` (un chunk agrupado
        // lleva las 3 presentaciones de tarjetas o los 5 formatos de plastificado). Sin la
        // segunda condición, pedir "500 tarjetas" no traería fila y el bot derivaría todo.
        query:
          "select metadata\n" +
          "  from bot.rag_catalog\n" +
          " where metadata->>'material' = $1\n" +
          "    or metadata->'variantes' @> jsonb_build_array(jsonb_build_object('material', $1::text))\n" +
          " limit 1",
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
          "Generado por `n8n/build-flow.mjs` desde el Excel del catálogo. **No editar acá**:",
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
          "`escala`, `es_base`, `sin_minimo`, `variantes` y `paquete` en la metadata. El",
          "auditor los necesita: un chunk viejo sin `sin_minimo` cotiza el mínimo aunque esté",
          "exento, sin `variantes` las presentaciones agrupadas (500 tarjetas) no se",
          "encuentran, y sin `paquete` la cantidad en piezas se cobra como si fueran paquetes",
          "(1000 tarjetas × el precio del paquete de 1000).",
          "",
          "**Re-generar y re-importar SIEMPRE que cambie el Excel o este builder.** El flow",
          "hornea el prompt, los parámetros y el código del auditor: quedarse con la versión",
          "vieja da errores que parecen del catálogo (\"modo desconocido\") y son del flow.",
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

// El gate de arriba evalúa las funciones del auditor, pero NO el pegamento del nodo: los
// campos que el Code emitido le pasa a `cotizar`. Ese cableado se puede borrar sin que
// ningún caso se ponga rojo (comprobado: el gate quedó en 46/46 con `sin_minimo` sin
// pasar, y la exención no habría funcionado nunca en producción). Acá se verifica que el
// código emitido realmente los pase.
{
  const jsAuditor = flow.nodes.find((n) => n.name === "Auditar Cotización")?.parameters?.jsCode ?? "";
  const CABLEADOS = [
    ["modo", "modo: md.modo"],
    ["escala", "escala: md.escala"],
    ["geometria", "geometria: md.geometria"],
    ["sin_minimo", "sin_minimo: md.sin_minimo"],
    ["paquete", "paquete: md.paquete"],
  ];
  const sinCablear = CABLEADOS.filter(([, frag]) => !jsAuditor.includes(frag));
  if (sinCablear.length) {
    console.error("\n✗ ABORTADO: el nodo Auditar Cotización no le pasa a cotizar():");
    for (const [campo, frag] of sinCablear) console.error(`  - ${campo} (falta "${frag}")`);
    process.exit(1);
  }
}

if (SOLO_TEST) process.exit(0);

console.log(`system prompt: ~${TOKENS_PROMPT} tokens`);

mkdirSync(path.dirname(SALIDA), { recursive: true });
writeFileSync(SALIDA, JSON.stringify(flow, null, 2) + "\n");
console.log(`\n✓ ${flow.nodes.length} nodos → ${path.relative(process.cwd(), SALIDA)}`);
