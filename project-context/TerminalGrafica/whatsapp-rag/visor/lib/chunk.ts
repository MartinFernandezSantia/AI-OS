// Armado del texto de los chunks. Función PURA, sin I/O — es lo que el visor inspecciona
// y lo que después va a importar el CLI de ingesta de la Fase 2.
//
// OJO, no confundir con el chunk del bot lite (whatsapp-rag-lite/lib/catalog/rag-chunk.ts):
// aquel modela producto-bot → variantes → refs [vN] → metadata.precios, porque ahí el LLM
// NO calculaba (elegía una opción y un nodo determinista inyectaba el monto en {Pn}).
// Acá el bot CALCULA: el chunk no lleva precios cerrados, lleva la ESCALA del material y el
// rinde de cada medida. El modelo es otro; no hay nada que reusar de allá salvo la idea de
// que el chunk es una unidad semántica autocontenida.

import { escalaDe, modoDe, num, unidadDe, type Datos, type Fila, type Tramo } from "./parse";

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
const CONOCIDAS = new Set([
  "Colección",
  "Producto",
  "Descripción",
  "Material",
  "Ancho (cm)",
  "Alto (cm)",
  "Piezas por pliego",
]);

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

/** Las líneas de un producto dentro de la lista de medidas. `unidad` viene del material. */
function itemProducto(p: Fila, unidad: string): string[] {
  const partes = [`- ${p["Producto"] ?? "(sin nombre)"}`];

  const a = p["Ancho (cm)"];
  const h = p["Alto (cm)"];
  if (a && h) partes.push(`${a}x${h} cm`);

  // Solo en modo pliego el producto trae rinde. En m2 la columna viene vacía y no entra.
  // La unidad sale del material ("pliego A3"), no de un literal.
  if (p["Piezas por pliego"]) {
    partes.push(`entran ${p["Piezas por pliego"]} por ${unidad || "pliego"}`);
  }

  const lineas = [partes.join(" · ") + "."];
  if (p["Descripción"]) lineas.push(`  ${p["Descripción"]}`);

  // Columnas que el cliente agregó y no conocemos: se emiten igual, sin tocar código.
  const extras = Object.keys(p).filter((k) => !CONOCIDAS.has(k));
  for (const k of extras) lineas.push(`  ${k}: ${p[k]}`);

  return lineas;
}

/** Descripción de una colección por nombre. */
const descripcionDe = (datos: Datos, coleccion: string): string =>
  datos.colecciones.find((c) => c["Colección"] === coleccion)?.["Descripción"] ?? "";

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

    for (const mat of mats) {
      const suyos = items.filter((p) => p["Material"] === mat);
      const tramos = escalaDe(datos.materiales, mat);
      // Con un solo material, el nombre del material no agrega nada al título.
      const titulo = mats.length > 1 ? `${col} — ${mat}` : col;

      const unidad = unidadDe(datos.materiales, mat);
      const L: string[] = [titulo];
      if (desc) L.push(desc);
      L.push("", "Medidas disponibles:");
      for (const p of suyos) L.push(...itemProducto(p, unidad));
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
          modo: modoDe(unidad),
          productos: suyos.length,
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

    const L: string[] = [col];
    if (desc) L.push(desc);
    L.push("", "Productos disponibles:");
    // Acá conviven productos de materiales distintos: la unidad se resuelve por producto.
    for (const p of items) L.push(...itemProducto(p, unidadDe(datos.materiales, p["Material"] ?? "")));

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
    const nombre = p["Producto"] ?? "(sin nombre)";

    const L: string[] = [nombre];
    if (p["Colección"]) L.push(`Colección: ${p["Colección"]}.`);
    if (p["Descripción"]) L.push(p["Descripción"]);

    const a = p["Ancho (cm)"];
    const h = p["Alto (cm)"];
    if (a && h) L.push(`Medida: ${a}x${h} cm.`);
    if (p["Piezas por pliego"]) {
      L.push(`Entran ${p["Piezas por pliego"]} por ${unidad || "pliego"}.`);
    }

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
        piezas_por_pliego: num(p["Piezas por pliego"]),
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
