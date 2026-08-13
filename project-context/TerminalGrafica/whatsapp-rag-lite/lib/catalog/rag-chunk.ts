// Chunk RAG por PRODUCTO-BOT para el bot lite de embeddings.
// Un chunk = un producto-bot entero (N variantes de public; unidad semántica autocontenida).
// El texto se embebe y lo lee el agente. El precio y la forma de cobro se derivan POR ITEM
// (un producto-bot puede agrupar variantes con cobros distintos). Función PURA y browser-safe:
// el hash de contenido lo calcula el script de ingesta, no acá.

import type { ItemBot, PrecioVariante, ProductoBot } from "./types";
import { contextoPrecio, precioVariante } from "./price-display";

export interface RagChunkMeta {
  producto_id: string; // = clave natural del producto-bot (clave de metadata, no uuid)
  nombre_canonico: string; // = nombre_bot (el flujo de precios matchea por este nombre + [vN])
  nicho: string | null; // filtro blando
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

/** Marca de la escalera de precio: '' override/qr>1/$0 · '**' 1 regla qr · '*' resto con precio.
 *  Determina si un item tiene precio "confiable" (simple, sin reglas). */
function marca(v: Pick<ItemBot, "tiene_override" | "n_reglas_cantidad" | "precio_lista">): string {
  if (v.tiene_override) return "";
  if ((v.n_reglas_cantidad || 0) > 1) return "";
  if ((v.n_reglas_cantidad || 0) === 1) return "**";
  if (!(Number(v.precio_lista) > 0)) return "";
  return "*";
}

/** ¿Este producto-bot entra al RAG? Se excluyen los ocultos. */
export const esChunkeable = (p: ProductoBot): boolean => !p.oculto;

/** ¿El item tiene precio confiable? Precio simple, sin override ni reglas de cantidad. */
const itemPrecioConfiable = (it: ItemBot): boolean =>
  it.mostrable !== false && marca(it) === "*" && Number(it.precio_lista) > 0;

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
 *  filtrados de ocultos por el export (where not bv.hidden). */
export function chunkRAG(p: ProductoBot): RagChunk {
  const nombre = (p.nombre_bot || "").trim();
  const sinonimos = (p.sinonimos || []).map((s) => s.trim()).filter(Boolean);
  const casos = (p.casos_de_uso || []).map((s) => s.trim()).filter(Boolean);
  const items = opcionesConPrecio(p.items || []);
  const ops = opcionesTexto(items);

  const lineas: string[] = [];
  lineas.push(`${nombre}.`);
  if (sinonimos.length) lineas.push(`También llamado: ${sinonimos.join(", ")}.`);
  if (casos.length) lineas.push(`Sirve para: ${casos.join(", ")}.`);
  if (p.nota && p.nota.trim()) lineas.push(p.nota.trim());
  if (ops) lineas.push(`Opciones: ${ops}.`);

  const rango = rangoPrecios(p.items || []);
  return {
    texto: lineas.join("\n"),
    title: nombre,
    meta: {
      producto_id: p.producto_id,
      nombre_canonico: nombre,
      nicho: p.nicho ?? null,
      precio_desde: rango.desde,
      precio_hasta: rango.hasta,
      precio_confiable: rango.confiable,
      precios: items.map((i) => i.pv),
    },
  };
}

/** Todos los chunks de un export, ya filtrando ocultos. */
export function chunksDeExport(productos: ProductoBot[]): RagChunk[] {
  return productos.filter(esChunkeable).map((p) => chunkRAG(p));
}
