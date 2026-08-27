// Armado del texto de los chunks. Función PURA, sin I/O — es lo que el visor inspecciona
// y lo que después va a importar el CLI de ingesta de la Fase 2.
//
// OJO, no confundir con el chunk del bot lite (whatsapp-rag-lite/lib/catalog/rag-chunk.ts):
// aquel modela producto-bot → variantes → refs [vN] → metadata.precios, porque ahí el LLM
// NO calculaba (elegía una opción y un nodo determinista inyectaba el monto en {Pn}).
// Acá el bot CALCULA: el chunk no lleva precios cerrados, lleva la ESCALA del material, la
// GEOMETRÍA de la unidad de cobro (para cotizar cualquier medida, no solo las de referencia)
// y el rinde calculado de cada medida de referencia. El modelo es otro; no hay nada que
// reusar de allá salvo la idea de que el chunk es una unidad semántica autocontenida.

import { rinde, type Geometria } from "./geometria";
import {
  escalaDe,
  geometriaDe,
  modoDe,
  num,
  unidadDe,
  type Datos,
  type Fila,
  type Tramo,
} from "./parse";

export type Estrategia = "coleccion-material" | "coleccion" | "producto";

export interface Chunk {
  titulo: string;
  /** El bloque de texto tal cual se embebe: esto es lo que ve el bot. */
  texto: string;
  /** Lo que la Fase 2 va a escribir en la columna `metadata`. Todavía no se usa. */
  meta: Record<string, unknown>;
}

/** Columnas de Productos que tienen lugar propio en la plantilla del chunk. Cualquier otra
 *  se emite genérica al final del ítem — así una columna nueva del cliente entra sin código. */
/** Cuántas piezas salen de UNA unidad de cobro (un pliego, una plancha, una bobina…).
 *  Para las unidades geométricas (pliego) YA NO se carga a mano: se calcula desde la
 *  geometría del material. La columna queda para unidades donde el rinde es dato del
 *  taller (una bobina, una plancha) — y si viene cargada, gana sobre el cálculo. */
export const COL_RINDE = "Piezas por unidad de cobro";

/** El material que se cotiza cuando el cliente no pide una opción especial. Vive en la
 *  hoja Colecciones (una por colección) porque la elección es del negocio, no del bot:
 *  el prompt le dice "cotizá la base y sugerí alternativas". */
export const COL_BASE = "Material base";

const CONOCIDAS = new Set([
  "Colección",
  "Producto",
  "Descripción",
  "Material",
  "Ancho (cm)",
  "Alto (cm)",
  COL_RINDE,
]);

/**
 * El rinde efectivo de un producto: la columna cargada (dato del taller) manda; si no
 * está y hay geometría + medidas, se calcula; si no hay nada, null. Un 0 calculado
 * significa "no entra en el área útil" — se devuelve tal cual para que `avisos` lo vea,
 * pero el chunk no lo emite (0 es falsy en los call sites).
 */
export function rindeEfectivo(p: Fila, geo: Geometria | null): number | null {
  const cargado = num(p[COL_RINDE]);
  if (cargado !== null) return cargado;
  const a = num(p["Ancho (cm)"]);
  const h = num(p["Alto (cm)"]);
  if (geo && a !== null && h !== null) return rinde(a, h, geo);
  return null;
}

const money = (n: number): string => "$" + n.toLocaleString("es-AR");

/** Formatea un número para texto en es-AR (0.5 → "0,5"). */
const numTexto = (n: number): string => n.toLocaleString("es-AR");

/**
 * La escala como texto legible.
 * Un solo tramo (tarifa plana) → solo el monto, sin rango: no tiene sentido decir
 * "1 o más: $16.000" cuando no hay otro tramo con el que comparar.
 */
export function escalaTexto(tramos: Tramo[]): string {
  if (!tramos.length) return "";
  if (tramos.length === 1) return money(tramos[0].precio);
  return tramos
    .map((t) => {
      if (t.hasta === null) return `${t.desde} o más: ${money(t.precio)}`;
      if (t.desde === t.hasta) return `${t.desde}: ${money(t.precio)}`;
      return `${t.desde} a ${t.hasta}: ${money(t.precio)}`;
    })
    .join(" · ");
}

/**
 * La línea de precio de un material. El MODO sale de la unidad del material
 * (no hay columna "Modo" en el Excel — se sacó a propósito para no tener dos fuentes).
 *
 * La unidad se imprime TAL CUAL viene del Excel: si el cliente escribe "pliego A3", el chunk
 * dice A3; si mañana escribe "pliego A4", dice A4. El tamaño del pliego es un dato del
 * cliente, no un literal del código.
 */
export function lineaPrecio(material: string, tramos: Tramo[]): string {
  if (!tramos.length) return "";
  const unidad = tramos[0].unidad;
  const min = tramos[0].minimo;
  // El mínimo facturable se expresa en la misma unidad de cobro (0,5 m2, 1 pliego…).
  const cola = min !== null ? `. Mínimo facturable ${numTexto(min)} ${unidad}` : "";
  return `Precio por ${unidad} — ${material}: ${escalaTexto(tramos)}${cola}.`;
}

/** Las líneas de un producto dentro de la lista de medidas. `unidad` y `geo` vienen del
 *  material. */
function itemProducto(p: Fila, unidad: string, geo: Geometria | null): string[] {
  const partes = [`- ${p["Producto"] ?? "(sin nombre)"}`];

  const a = p["Ancho (cm)"];
  const h = p["Alto (cm)"];
  if (a && h) partes.push(`${a}x${h} cm`);

  // El rinde solo aparece donde hace falta convertir piezas → unidades de cobro (modo pliego
  // y similares). En m2 no hay ni columna ni geometría y no entra. La unidad sale del material.
  const r = rindeEfectivo(p, geo);
  if (r) partes.push(`entran ${numTexto(r)} por ${unidad || "unidad"}`);

  const lineas = [partes.join(" · ") + "."];
  if (p["Descripción"]) lineas.push(`  ${p["Descripción"]}`);

  // Columnas que el cliente agregó y no conocemos: se emiten igual, sin tocar código.
  const extras = Object.keys(p).filter((k) => !CONOCIDAS.has(k));
  for (const k of extras) lineas.push(`  ${k}: ${p[k]}`);

  return lineas;
}

/**
 * Las líneas que habilitan la medida libre. El chunk lleva los DATOS que la fórmula de
 * encaje consume (área útil, separación, unidad); la fórmula general vive en la hoja
 * Instrucciones → el system prompt del bot, para no repetirla (y desalinearla) por chunk.
 */
function lineasMotor(modo: string, unidad: string, geo: Geometria | null): string[] {
  if (modo === "pliego" && geo) {
    const sep = geo.separacion
      ? `separación entre piezas: ${numTexto(geo.separacion)} cm`
      : "sin separación entre piezas";
    return [
      "Se cotiza CUALQUIER medida en cm; las de abajo son referencias de tamaños populares.",
      `Área útil del ${unidad || "pliego"}: ${numTexto(geo.utilAncho)}x${numTexto(geo.utilAlto)} cm · ${sep}.`,
    ];
  }
  if (modo === "m2") return ["Se cotiza cualquier medida (m2 = ancho x alto en cm ÷ 10.000)."];
  return [];
}

/** Descripción de una colección por nombre. */
const descripcionDe = (datos: Datos, coleccion: string): string =>
  datos.colecciones.find((c) => c["Colección"] === coleccion)?.["Descripción"] ?? "";

/** Material base de una colección (columna del Excel); "" si no está marcada. */
const baseDe = (datos: Datos, coleccion: string): string =>
  datos.colecciones.find((c) => c["Colección"] === coleccion)?.[COL_BASE] ?? "";

/**
 * La escala como DATO estructurado para `metadata`. El texto del chunk la lleva en prosa
 * (`lineaPrecio`) porque es lo que lee el LLM; esto es lo que lee el AUDITOR del workflow
 * para re-calcular el total sin confiar en lo que el bot dice haber leído.
 */
function escalaMeta(tramos: Tramo[]): Record<string, unknown>[] {
  return tramos.map((t) => ({
    desde: t.desde,
    hasta: t.hasta,
    precio: t.precio,
    ...(t.minimo !== null && { minimo_facturable: t.minimo }),
  }));
}

/** Productos de una colección, en el orden del Excel. */
const productosDe = (datos: Datos, coleccion: string): Fila[] =>
  datos.productos.filter((p) => p["Colección"] === coleccion);

/** Nombres de colección en orden: los de la hoja Colecciones primero, después huérfanas. */
function nombresColeccion(datos: Datos): string[] {
  const declaradas = datos.colecciones.map((c) => c["Colección"]).filter(Boolean);
  const usadas = [...new Set(datos.productos.map((p) => p["Colección"]).filter(Boolean))];
  return [...declaradas, ...usadas.filter((u) => !declaradas.includes(u))];
}

/** Materiales que usa una colección, en orden de aparición. */
const materialesDe = (items: Fila[]): string[] => [
  ...new Set(items.map((p) => p["Material"]).filter(Boolean)),
];

// ── Estrategia 1: colección + material (la unidad cotizable cerrada) ────────────────────
// Una sola escala por chunk: cero ambigüedad de qué precio aplicar. El bot igual ve las
// medidas hermanas, así puede sugerir 5x5 si le piden 4x4.

function chunksColeccionMaterial(datos: Datos): Chunk[] {
  const out: Chunk[] = [];
  for (const col of nombresColeccion(datos)) {
    const items = productosDe(datos, col);
    if (!items.length) continue;
    const mats = materialesDe(items);
    const desc = descripcionDe(datos, col);

    const base = baseDe(datos, col);

    for (const mat of mats) {
      const suyos = items.filter((p) => p["Material"] === mat);
      const tramos = escalaDe(datos.materiales, mat);
      // Con un solo material, el nombre del material no agrega nada al título.
      const titulo = mats.length > 1 ? `${col} — ${mat}` : col;

      const unidad = unidadDe(datos.materiales, mat);
      const modo = modoDe(unidad);
      const geo = geometriaDe(datos.materiales, mat);
      // Solo hay base donde hay algo que elegir: con un material único la línea sería
      // ruido (y "el material base" no significa nada si no hay alternativa).
      const varios = mats.length > 1;
      const esBase = varios && base === mat;
      const otros = mats.filter((m) => m !== mat);

      const L: string[] = [titulo];
      if (desc) L.push(desc);
      // Los dos ejes por SEPARADO. El título los junta con un guion y el bot no tiene
      // cómo saber dónde termina uno y empieza el otro: sin esta línea, "la colección"
      // de las de abajo se queda sin referente claro.
      if (varios) L.push(`Colección: ${col}. Material: ${mat}.`);
      // La colección se nombra explícita (no "la colección") por lo mismo. Y cada chunk
      // lleva a sus hermanos: si el retrieval trae uno solo, el bot igual puede sugerir
      // alternativas sin inventarlas ni depender de la prosa de la descripción.
      if (esBase) {
        L.push(`Es el material BASE de "${col}": se cotiza este salvo que el cliente pida otro.`);
        if (otros.length) L.push(`También hay en: ${otros.join(" · ")}.`);
      } else if (varios && base) {
        L.push(`El material base de "${col}" es ${base}.`);
      }
      const motor = lineasMotor(modo, unidad, geo);
      if (motor.length) L.push("", ...motor);
      L.push("", "Medidas de referencia:");
      for (const p of suyos) L.push(...itemProducto(p, unidad, geo));
      const precio = lineaPrecio(mat, tramos);
      if (precio) L.push("", precio);

      out.push({
        titulo,
        texto: L.join("\n"),
        meta: {
          estrategia: "coleccion-material",
          coleccion: col,
          material: mat,
          unidad,
          modo,
          productos: suyos.length,
          es_base: esBase,
          // El auditor del workflow re-calcula con esto; sin escala en la metadata
          // tendría que parsear la prosa del chunk.
          escala: escalaMeta(tramos),
          ...(geo && {
            geometria: {
              util_ancho: geo.utilAncho,
              util_alto: geo.utilAlto,
              separacion: geo.separacion,
            },
          }),
        },
      });
    }
  }
  return out;
}

// ── Estrategia 2: por colección ────────────────────────────────────────────────────────
// Menos chunks, pero una colección con varios materiales arrastra TODAS sus escalas en el
// mismo bloque y el bot tiene que elegir cuál aplica. Se genera para poder verlo.

function chunksColeccion(datos: Datos): Chunk[] {
  const out: Chunk[] = [];
  for (const col of nombresColeccion(datos)) {
    const items = productosDe(datos, col);
    if (!items.length) continue;
    const desc = descripcionDe(datos, col);

    const base = baseDe(datos, col);

    const L: string[] = [col];
    if (desc) L.push(desc);
    if (base && materialesDe(items).length > 1) {
      L.push(`Material base de "${col}": ${base} (se cotiza este salvo que el cliente pida otro).`);
    }
    L.push("", "Productos disponibles:");
    // Acá conviven productos de materiales distintos: la unidad se resuelve por producto.
    for (const p of items) {
      const mat = p["Material"] ?? "";
      L.push(...itemProducto(p, unidadDe(datos.materiales, mat), geometriaDe(datos.materiales, mat)));
    }

    const mats = materialesDe(items);
    const precios = mats
      .map((m) => lineaPrecio(m, escalaDe(datos.materiales, m)))
      .filter(Boolean);
    if (precios.length) L.push("", ...precios);

    out.push({
      titulo: col,
      texto: L.join("\n"),
      meta: {
        estrategia: "coleccion",
        coleccion: col,
        materiales: mats,
        productos: items.length,
        ...(base && { material_base: base }),
      },
    });
  }
  return out;
}

// ── Estrategia 3: por producto ─────────────────────────────────────────────────────────
// Máxima precisión al recuperar, pero repite la escala completa en cada chunk que comparte
// material y el bot no ve alternativas sin más retrievals.

function chunksProducto(datos: Datos): Chunk[] {
  return datos.productos.map((p) => {
    const mat = p["Material"] ?? "";
    const tramos = escalaDe(datos.materiales, mat);
    const unidad = unidadDe(datos.materiales, mat);
    const geo = geometriaDe(datos.materiales, mat);
    const nombre = p["Producto"] ?? "(sin nombre)";

    const L: string[] = [nombre];
    if (p["Colección"]) L.push(`Colección: ${p["Colección"]}.`);
    if (p["Descripción"]) L.push(p["Descripción"]);

    const a = p["Ancho (cm)"];
    const h = p["Alto (cm)"];
    if (a && h) L.push(`Medida: ${a}x${h} cm.`);
    const r = rindeEfectivo(p, geo);
    if (r) L.push(`Entran ${numTexto(r)} por ${unidad || "unidad"}.`);

    for (const k of Object.keys(p).filter((k) => !CONOCIDAS.has(k))) L.push(`${k}: ${p[k]}.`);

    const precio = lineaPrecio(mat, tramos);
    if (precio) L.push(precio);

    return {
      titulo: nombre,
      texto: L.join("\n"),
      meta: {
        estrategia: "producto",
        coleccion: p["Colección"] ?? null,
        material: mat,
        unidad,
        modo: modoDe(unidad),
        piezas_por_unidad: r,
        escala: escalaMeta(tramos),
      },
    };
  });
}

/** Arma los chunks con la estrategia pedida. Las tres salen de los mismos datos. */
export function chunks(datos: Datos, estrategia: Estrategia): Chunk[] {
  switch (estrategia) {
    case "coleccion-material":
      return chunksColeccionMaterial(datos);
    case "coleccion":
      return chunksColeccion(datos);
    case "producto":
      return chunksProducto(datos);
  }
}

/**
 * Problemas del catálogo que el chunk NO puede mostrar (saldría "un chunk que parece
 * completo y no lo está"). Se muestran en el visor antes de ingestar; no bloquean.
 */
export function avisos(datos: Datos): string[] {
  const out: string[] = [];

  // Material base: solo importa donde hay más de un material para elegir. Sin base
  // marcada el bot no sabe cuál cotizar por default y elige el que le quede a mano.
  for (const col of nombresColeccion(datos)) {
    const items = productosDe(datos, col);
    const mats = materialesDe(items);
    if (mats.length < 2) continue;
    const base = baseDe(datos, col);
    if (!base) {
      out.push(
        `${col}: usa ${mats.length} materiales y no tiene "${COL_BASE}" marcado. ` +
          `Elegí cuál se cotiza cuando el cliente no pide una opción especial.`,
      );
    } else if (!mats.includes(base)) {
      out.push(
        `${col}: el "${COL_BASE}" es "${base}", pero ningún producto de la colección lo usa ` +
          `(usa: ${mats.join(" · ")}). Revisá cuál está mal.`,
      );
    }
  }

  for (const p of datos.productos) {
    const mat = p["Material"] ?? "";
    const unidad = unidadDe(datos.materiales, mat);
    if (modoDe(unidad) !== "pliego") continue;

    const nombre = p["Producto"] ?? "(sin nombre)";
    const geo = geometriaDe(datos.materiales, mat);
    const cargado = num(p[COL_RINDE]);
    const a = num(p["Ancho (cm)"]);
    const h = num(p["Alto (cm)"]);
    const calculado = geo && a !== null && h !== null ? rinde(a, h, geo) : null;

    if (cargado === null && calculado === null) {
      // Sin columna ni geometría: el chunk sale con precio pero sin rinde, y el bot inventa.
      out.push(
        `${nombre}: sin rinde — el material "${mat}" no tiene geometría (área útil + separación) ` +
          `y la columna "${COL_RINDE}" está vacía. El bot no va a poder cotizarlo.`,
      );
    } else if (cargado !== null && calculado !== null && cargado !== calculado) {
      // Dos fuentes que no coinciden: gana el dato cargado (lo puso un humano a propósito).
      out.push(
        `${nombre}: la columna dice ${cargado} pero la geometría de "${mat}" calcula ${calculado}. ` +
          `Se usa ${cargado}; revisar cuál está mal.`,
      );
    } else if (cargado === null && calculado === 0) {
      out.push(
        `${nombre} (${a}x${h} cm): no entra en el área útil de "${mat}" en ninguna orientación. ` +
          `La referencia sale sin rinde; el bot debe derivar a consulta.`,
      );
    }
  }
  return out;
}
