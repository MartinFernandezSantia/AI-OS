// Chunk RAG por producto para el bot lite de embeddings (plan rag-lite-bot).
// Un chunk = un producto entero (unidad semántica autocontenida). Toma la FORMA de
// `lineaLLM` (effective.ts) pero SIN las marcas de precio (*/**), y enriquecido con el
// rubro padre y atributos textualizados. Función PURA y browser-safe (sin node:crypto):
// el hash de contenido lo calcula el script de ingesta, no acá.

import type { Producto, PrecioVariante, Rubro, Variante } from "./types";
import { marca } from "./effective";
import { contextoPrecio, precioVariante } from "./price-display";

export interface RagChunkMeta {
  producto_id: string;
  nombre_canonico: string;
  rubro: string | null; // "<leaf> (<padre>)" o solo "<leaf>"
  familias: string[];
  nicho: string | null; // 'medicina' | 'inmobiliarias' | null — filtro DURO en la RPC
  precio_desde: number | null; // solo variantes "limpias" (precio simple, sin reglas/override)
  precio_hasta: number | null;
  precio_confiable: boolean; // hay al menos una variante con precio confiable
  precios: PrecioVariante[]; // una por variante visible; ref matchea el [vN] de "Opciones:"
}

export interface RagChunk {
  texto: string; // lo que se embebe y ve el Compositor
  title: string; // nombre_canonico, para taskType RETRIEVAL_DOCUMENT
  meta: RagChunkMeta;
}

/** Índice de rubros por id, para resolver el nombre del padre. */
export function buildRubrosIndex(rubros: Rubro[]): Map<string, Rubro> {
  return new Map(rubros.map((r) => [r.categoria_id, r]));
}

/** ¿Este producto entra al RAG? Se excluyen los ocultos (fuera de bot.taxonomia). */
export const esChunkeable = (p: Producto): boolean => !p.oculto;

/** Nombre que el bot muestra/matchea: nombre_canonico ya viene resuelto en el export. */
const nombreCanonico = (p: Producto): string => (p.nombre_canonico || p.display_name || p.nombre_vivo).trim();

/** Rubro legible: "<hoja>" + "(<padre>)" si el padre existe. */
function rubroLegible(p: Producto, rubrosById: Map<string, Rubro>): string | null {
  const hoja = (p.categoria_display || p.categoria || "").trim();
  if (!hoja) return null;
  const self = rubrosById.get(p.categoria_id);
  const padre = self?.parent_id ? rubrosById.get(self.parent_id) : undefined;
  const padreNombre = padre ? (padre.display_name || padre.nombre_vivo || "").trim() : "";
  return padreNombre && padreNombre !== hoja ? `${hoja} (${padreNombre})` : hoja;
}

/** nicho del producto (o de la primera variante que lo tenga). null si no hay. */
function nichoDe(p: Producto): string | null {
  const pn = p.atributos?.nicho;
  if (typeof pn === "string" && pn) return pn;
  for (const v of p.variantes) {
    const vn = v.atributos?.nicho;
    if (typeof vn === "string" && vn) return vn;
  }
  return null;
}

/** Atributos que aportan señal al embedding, en texto natural. Se omiten flags internos. */
function atributosTexto(p: Producto): string {
  const a = p.atributos || {};
  const partes: string[] = [];
  const material = a.material;
  const tecnologia = a.tecnologia;
  const tamano = a.tamano;
  if (typeof material === "string") partes.push(`Material: ${material.replace(/_/g, " ")}.`);
  if (typeof tecnologia === "string") partes.push(`Tecnología: ${tecnologia}.`);
  if (Array.isArray(tamano) && tamano.length) partes.push(`Tamaños: ${tamano.join(", ")}.`);
  return partes.join(" ");
}

/** ¿La variante tiene precio confiable? Precio simple, sin override ni reglas de cantidad. */
const variantePrecioConfiable = (v: Variante): boolean =>
  !v.oculto && v.mostrable !== false && marca(v) === "*" && Number(v.precio_lista) > 0;

/** Rango de precios calculado SOLO de variantes limpias. */
function rangoPrecios(p: Producto): { desde: number | null; hasta: number | null; confiable: boolean } {
  const precios = p.variantes.filter(variantePrecioConfiable).map((v) => Number(v.precio_lista));
  if (!precios.length) return { desde: null, hasta: null, confiable: false };
  return { desde: Math.min(...precios), hasta: Math.max(...precios), confiable: true };
}

/** Variantes visibles con ref [vN] y su precio horneado (mismo orden en texto y en meta.precios). */
function opcionesConPrecio(p: Producto): { ref: string; pv: PrecioVariante }[] {
  return p.variantes
    .filter((v) => !v.oculto && (v.variante || v.display_variante || v.nombre_vivo || "").trim())
    .map((v, i) => {
      const ref = `v${i + 1}`;
      return { ref, pv: precioVariante(p, v, ref) };
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

/** Arma el chunk RAG de un producto. Asume esChunkeable(p) === true. */
export function chunkRAG(p: Producto, rubrosById: Map<string, Rubro>): RagChunk {
  const nombre = nombreCanonico(p);
  const rubro = rubroLegible(p, rubrosById);
  const sinonimos = (p.sinonimos_efectivos || p.sinonimos || []).map((s) => s.trim()).filter(Boolean);
  const casos = (p.casos_de_uso || []).map((s) => s.trim()).filter(Boolean);
  const attrs = atributosTexto(p);
  const items = opcionesConPrecio(p);
  const ops = opcionesTexto(items);

  const lineas: string[] = [];
  lineas.push(rubro ? `${nombre} — rubro: ${rubro}.` : `${nombre}.`);
  if (sinonimos.length) lineas.push(`También llamado: ${sinonimos.join(", ")}.`);
  if (casos.length) lineas.push(`Sirve para: ${casos.join(", ")}.`);
  if (attrs) lineas.push(attrs);
  if (ops) lineas.push(`Opciones: ${ops}.`);

  const rango = rangoPrecios(p);
  return {
    texto: lineas.join("\n"),
    title: nombre,
    meta: {
      producto_id: p.producto_id,
      nombre_canonico: nombre,
      rubro,
      familias: [...(p.familias || [])],
      nicho: nichoDe(p),
      precio_desde: rango.desde,
      precio_hasta: rango.hasta,
      precio_confiable: rango.confiable,
      precios: items.map((i) => i.pv),
    },
  };
}

/** Todos los chunks de un export, ya filtrando ocultos. */
export function chunksDeExport(productos: Producto[], rubros: Rubro[]): RagChunk[] {
  const idx = buildRubrosIndex(rubros);
  return productos.filter(esChunkeable).map((p) => chunkRAG(p, idx));
}
