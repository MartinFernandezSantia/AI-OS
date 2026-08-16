// Chunk RAG por PRODUCTO-BOT para el bot lite de embeddings.
// Un chunk = un producto-bot entero (N variantes de public; unidad semántica autocontenida).
// El texto se embebe y lo lee el agente. El precio y la forma de cobro se derivan POR ITEM
// (un producto-bot puede agrupar variantes con cobros distintos). Función PURA y browser-safe:
// el hash de contenido lo calcula el script de ingesta, no acá.

import type { ItemBot, PrecioVariante, ProductoBot, TrabajoBot } from "./types";
import { contextoPrecio, precioVariante } from "./price-display";

export interface RagChunkMeta {
  producto_id: string; // = clave natural del producto-bot (clave de metadata, no uuid)
  nombre_canonico: string; // = nombre_bot (el flujo de precios matchea por este nombre + [vN]/[cN])
  nicho: string | null; // filtro blando
  precio_desde: number | null; // solo variantes "limpias" (precio simple, sin reglas/override)
  precio_hasta: number | null;
  precio_confiable: boolean; // hay al menos una variante con precio confiable
  precios: PrecioVariante[]; // una por item visible; ref matchea el [vN]/[cN] de "Opciones:"/"Incluye:"
  tipo?: "producto" | "trabajo"; // undefined = producto (sin cambio); "trabajo" = combo de materiales
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

// ---------------------------------------------------------------------------------------------------
// TRABAJOS (combos): un chunk = un trabajo entero. Sus MATERIALES se listan en "Incluye: [c1]…[c2]…"
// (refs [cN], NO [vN]) y se usan TODOS juntos por diseño — a diferencia de las "Opciones" de un
// producto, que son alternativas a elegir. El texto arranca con "Trabajo:" para que el Verificador
// reconozca la composición y no la marque como fusión de variantes.
// ---------------------------------------------------------------------------------------------------

/** Materiales con nombre, con ref [cN] y su precio horneado (mismo orden en texto y en meta.precios). */
function componentesConPrecio(componentes: ItemBot[]): { ref: string; pv: PrecioVariante }[] {
  return componentes
    .filter((it) => (it.nombre_variante_bot || it.variante_origen || "").trim())
    .map((it, i) => ({ ref: `c${i + 1}`, pv: precioVariante(it, `c${i + 1}`) }));
}

/** Item sintético que representa el TOTAL del combo, para hornearlo con precioVariante como un precio
 *  más (unidad_venta 'trabajo' → "por trabajo"). El total NO se guarda: es la suma de los materiales. */
function itemTotal(producto_id: string, total: number): ItemBot {
  return {
    variante_id: `${producto_id}::total`,
    nombre_variante_bot: "Total",
    variante_origen: "Total",
    color: null,
    unidad: null,
    precio_lista: total,
    por_pack: false,
    atributos: { unidad_venta: "trabajo", pack_unidades: null },
    rangos_cantidad: null,
    mostrable: true,
    tiene_override: false,
    solo_descuentos: false,
    n_reglas_cantidad: 0,
  };
}

/** Arma el chunk RAG de un TRABAJO. Asume !oculto y ≥2 componentes (ver chunksDeTrabajos). El total se
 *  calcula sumando los precio_lista de los materiales, y SOLO si mostrar_total y TODOS son confiables
 *  (precio simple, sin override/escalera): un total con un material de precio dudoso mentiría. */
export function chunkTrabajo(t: TrabajoBot): RagChunk {
  const nombre = (t.nombre_bot || "").trim();
  const sinonimos = (t.sinonimos || []).map((s) => s.trim()).filter(Boolean);
  const casos = (t.casos_de_uso || []).map((s) => s.trim()).filter(Boolean);
  const componentes = componentesConPrecio(t.componentes || []);

  // Total: suma de los materiales, solo si se pidió mostrarlo y todos tienen precio confiable.
  const materialesUsados = (t.componentes || []).filter((it) =>
    (it.nombre_variante_bot || it.variante_origen || "").trim(),
  );
  const todosConfiables =
    materialesUsados.length > 0 && materialesUsados.every(itemPrecioConfiable);
  const total = materialesUsados.reduce((acc, it) => acc + Number(it.precio_lista || 0), 0);
  const totalPv =
    t.mostrar_total && todosConfiables ? precioVariante(itemTotal(t.producto_id, total), "total") : null;
  const totalCtx = totalPv ? contextoPrecio(totalPv) : null;

  const lineas: string[] = [];
  lineas.push(`Trabajo: ${nombre}.`);
  if (sinonimos.length) lineas.push(`También llamado: ${sinonimos.join(", ")}.`);
  if (casos.length) lineas.push(`Sirve para: ${casos.join(", ")}.`);
  if (t.nota && t.nota.trim()) lineas.push(t.nota.trim());
  if (componentes.length) lineas.push(`Incluye: ${opcionesTexto(componentes)}.`);
  if (totalCtx) lineas.push(`Precio del trabajo: ${totalCtx}.`);

  return {
    texto: lineas.join("\n"),
    title: nombre,
    meta: {
      producto_id: t.producto_id,
      nombre_canonico: nombre,
      nicho: t.nicho ?? null,
      precio_desde: totalPv ? total : null,
      precio_hasta: totalPv ? total : null,
      precio_confiable: totalPv != null,
      precios: [...componentes.map((c) => c.pv), ...(totalPv ? [totalPv] : [])],
      tipo: "trabajo",
    },
  };
}

/** Todos los chunks de trabajos de un export. Excluye ocultos y los degenerados (<2 materiales: un
 *  trabajo se define por combinar 2 o más). */
export function chunksDeTrabajos(trabajos: TrabajoBot[]): RagChunk[] {
  return trabajos
    .filter((t) => !t.oculto && (t.componentes || []).length >= 2)
    .map((t) => chunkTrabajo(t));
}
