// Chunk RAG por PRODUCTO-BOT para el bot lite de embeddings (plan producto-bot-rewrite).
// Un chunk = un producto-bot entero (N variantes de public; unidad semántica autocontenida).
// El texto se embebe y lo lee el agente. El precio y la forma de cobro se derivan POR ITEM
// (un producto-bot puede agrupar variantes con cobros distintos). Función PURA y browser-safe:
// el hash de contenido lo calcula el script de ingesta, no acá.

import type { ItemBot, PrecioVariante, ProductoBot } from "./types";
import { marca } from "./effective";
import { contextoPrecio, precioVariante } from "./price-display";

export interface RagChunkMeta {
  producto_id: string; // = clave natural del producto-bot (clave de metadata, no uuid)
  nombre_canonico: string; // = nombre_bot (el flujo de precios matchea por este nombre + [vN])
  familia: string | null;
  nicho: string | null; // filtro blando; heredado en la migración
  precio_desde: number | null; // solo variantes "limpias" (precio simple, sin reglas/override)
  precio_hasta: number | null;
  precio_confiable: boolean; // hay al menos una variante con precio confiable
  precios: PrecioVariante[]; // una por item visible; ref matchea el [vN] de "Opciones:"
}

export interface RagChunk {
  texto: string; // lo que se embebe y ve el agente
  title: string; // nombre_bot, para taskType RETRIEVAL_DOCUMENT
  meta: RagChunkMeta;
}

/** ¿Este producto-bot entra al RAG? Se excluyen los ocultos. */
export const esChunkeable = (p: ProductoBot): boolean => !p.oculto;

/** ¿El item tiene precio confiable? Precio simple, sin override ni reglas de cantidad.
 *  Reusa `marca()` (misma cascada que el curador) para no driftear. */
const itemPrecioConfiable = (it: ItemBot): boolean =>
  it.mostrable !== false && marca(it) === "*" && Number(it.precio_lista) > 0;

/** Atributo string COMÚN a todos los items (mismo valor en todos). null si difiere o falta en alguno. */
function comun(items: ItemBot[], key: string): string | null {
  if (!items.length) return null;
  let val: string | null = null;
  for (const it of items) {
    const v = (it.atributos || {})[key];
    const s = typeof v === "string" && v ? v : null;
    if (s == null) return null; // no todos lo tienen
    if (val == null) val = s;
    else if (val !== s) return null; // difieren entre items
  }
  return val;
}

/** Atributos de señal al embedding: SÓLO los comunes a todos los items (evita fusionar señal
 *  engañosa en un grupo heterogéneo — ej. "Material: obra, plastico" sobre productos distintos).
 *  Los que difieren (tamaño por variante) quedan en los nombres de opción [vN] de "Opciones:". */
function atributosTexto(items: ItemBot[]): string {
  const partes: string[] = [];
  const material = comun(items, "material");
  const tecnologia = comun(items, "tecnologia");
  if (material) partes.push(`Material: ${material.replace(/_/g, " ")}.`);
  if (tecnologia) partes.push(`Tecnología: ${tecnologia}.`);
  return partes.join(" ");
}

/** Rango de precios calculado SOLO de items limpios. */
function rangoPrecios(items: ItemBot[]): { desde: number | null; hasta: number | null; confiable: boolean } {
  const precios = items.filter(itemPrecioConfiable).map((it) => Number(it.precio_lista));
  if (!precios.length) return { desde: null, hasta: null, confiable: false };
  return { desde: Math.min(...precios), hasta: Math.max(...precios), confiable: true };
}

/** Items con nombre, con ref [vN] y su precio horneado (mismo orden en texto y en meta.precios). */
function opcionesConPrecio(items: ItemBot[]): { ref: string; pv: PrecioVariante }[] {
  return items
    .filter((it) => (it.nombre_variante_bot || it.variante_origen || "").trim())
    .map((it, i) => {
      const ref = `v${i + 1}`;
      return { ref, pv: precioVariante(it, ref) };
    });
}

/** Línea "Opciones:" con token + precio de contexto, ej. "[v1] Doble Faz ($15.000 el pack de 100 unidades)". */
function opcionesTexto(items: { ref: string; pv: PrecioVariante }[]): string {
  return items
    .map(({ ref, pv }) => {
      const ctx = contextoPrecio(pv);
      return `[${ref}] ${pv.variante}${ctx ? ` (${ctx})` : ""}`;
    })
    .join("; ");
}

/** Arma el chunk RAG de un producto-bot. Asume esChunkeable(p) === true. Los items ya vienen
 *  filtrados de ocultos por el export (where not pi.oculto). */
export function chunkRAG(p: ProductoBot): RagChunk {
  const nombre = (p.nombre_bot || "").trim();
  const sinonimos = (p.sinonimos || []).map((s) => s.trim()).filter(Boolean);
  const casos = (p.casos_de_uso || []).map((s) => s.trim()).filter(Boolean);
  const attrs = atributosTexto(p.items || []);
  const items = opcionesConPrecio(p.items || []);
  const ops = opcionesTexto(items);

  // La familia (clave) NO va al texto: es genérica y no discrimina entre productos de la misma
  // familia. La NOTA de familia (ej. libreria) sí aporta señal y se hornea.
  const lineas: string[] = [];
  lineas.push(`${nombre}.`);
  if (sinonimos.length) lineas.push(`También llamado: ${sinonimos.join(", ")}.`);
  if (casos.length) lineas.push(`Sirve para: ${casos.join(", ")}.`);
  if (p.nota && p.nota.trim()) lineas.push(p.nota.trim());
  if (p.familia_nota && p.familia_nota.trim()) lineas.push(p.familia_nota.trim());
  if (attrs) lineas.push(attrs);
  if (ops) lineas.push(`Opciones: ${ops}.`);

  const rango = rangoPrecios(p.items || []);
  return {
    texto: lineas.join("\n"),
    title: nombre,
    meta: {
      producto_id: p.producto_id,
      nombre_canonico: nombre,
      familia: p.familia ?? null,
      nicho: p.nicho ?? null,
      precio_desde: rango.desde,
      precio_hasta: rango.hasta,
      precio_confiable: rango.confiable,
      precios: items.map((i) => i.pv),
    },
  };
}

/** Todos los chunks de un export v4, ya filtrando ocultos. */
export function chunksDeExport(productos: ProductoBot[]): RagChunk[] {
  return productos.filter(esChunkeable).map((p) => chunkRAG(p));
}
