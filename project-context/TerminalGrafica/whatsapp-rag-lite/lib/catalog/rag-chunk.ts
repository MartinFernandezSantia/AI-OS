// Chunk RAG por PRODUCTO-BOT para el bot lite de embeddings.
// Un chunk = un producto-bot entero (N variantes de public; unidad semántica autocontenida).
// El texto se embebe y lo lee el agente. El precio y la forma de cobro se derivan POR ITEM
// (un producto-bot puede agrupar variantes con cobros distintos). Función PURA y browser-safe:
// el hash de contenido lo calcula el script de ingesta, no acá.

import type { ItemBot, PrecioVariante, ProductoBot, TrabajoBot, TrabajoComponente } from "./types";
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
// TRABAJOS (combos): un chunk = un trabajo entero. Se arma combinando UNA opción de cada PARTE
// (producto-bot); las opciones de una parte son ALTERNATIVAS, y partes distintas se combinan. El texto
// lista "- Parte: [c1]…; [c2]…" con refs [cN] corridos (NO [vN]) y arranca con "Trabajo:" para que el
// Verificador reconozca la composición y no la marque como fusión de variantes.
// ---------------------------------------------------------------------------------------------------

const conNombre = (it: ItemBot): boolean =>
  !!(it.nombre_variante_bot || it.variante_origen || "").trim();

/** Aplana las partes a opciones con ref [cN] CORRIDO (único en el trabajo), conservando la parte. */
function partesConPrecio(
  componentes: TrabajoComponente[],
): { parte: string; opciones: { ref: string; pv: PrecioVariante }[] }[] {
  let n = 0;
  return componentes
    .map((comp) => ({
      parte: (comp.nombre_bot || "").trim(),
      opciones: (comp.items || []).filter(conNombre).map((it) => {
        const ref = `c${++n}`;
        return { ref, pv: precioVariante(it, ref) };
      }),
    }))
    .filter((p) => p.opciones.length > 0);
}

/** Item sintético que representa el TOTAL "desde" del combo, para hornearlo con precioVariante como un
 *  precio más (unidad_venta 'trabajo' → "por trabajo"). El total NO se guarda: es la combinación más barata. */
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

/** Arma el chunk RAG de un TRABAJO. Asume !oculto y ≥2 partes (ver chunksDeTrabajos). El total es la
 *  combinación MÁS BARATA (Σ del más barato de cada parte) y se hornea SOLO si mostrar_total y TODOS los
 *  materiales son confiables (precio simple, sin override/escalera): un total con un precio dudoso mentiría.
 *  Si alguna parte tiene >1 opción, el precio se muestra "desde X"; si hay una sola combinación, exacto. */
export function chunkTrabajo(t: TrabajoBot): RagChunk {
  const nombre = (t.nombre_bot || "").trim();
  const sinonimos = (t.sinonimos || []).map((s) => s.trim()).filter(Boolean);
  const casos = (t.casos_de_uso || []).map((s) => s.trim()).filter(Boolean);
  const partes = partesConPrecio(t.componentes || []);
  const todasLasOpciones = partes.flatMap((p) => p.opciones);

  // Items usados por parte (con nombre). Total "desde" = Σ del más barato de cada parte; solo si se pidió
  // mostrarlo, cada parte tiene ≥1 material y TODOS son confiables.
  const itemsPorParte = (t.componentes || []).map((c) => (c.items || []).filter(conNombre));
  const materialesUsados = itemsPorParte.flat();
  const todosConfiables =
    materialesUsados.length > 0 &&
    itemsPorParte.every((items) => items.length > 0) &&
    materialesUsados.every(itemPrecioConfiable);
  const totalDesde = itemsPorParte.reduce(
    (acc, items) => acc + Math.min(...items.map((it) => Number(it.precio_lista || 0))),
    0,
  );
  const hayVariacion = itemsPorParte.some((items) => items.length > 1);
  const totalPv =
    t.mostrar_total && todosConfiables
      ? precioVariante(itemTotal(t.producto_id, totalDesde), "total")
      : null;
  const totalCtx = totalPv ? contextoPrecio(totalPv) : null;
  // Partes que varían (para el "dependiendo de …" que redacta el bot).
  const partesVariables = t.componentes
    .filter((c) => (c.items || []).filter(conNombre).length > 1)
    .map((c) => (c.nombre_bot || "").trim())
    .filter(Boolean);

  const lineas: string[] = [];
  lineas.push(`Trabajo: ${nombre}.`);
  if (sinonimos.length) lineas.push(`También llamado: ${sinonimos.join(", ")}.`);
  if (casos.length) lineas.push(`Sirve para: ${casos.join(", ")}.`);
  if (t.nota && t.nota.trim()) lineas.push(t.nota.trim());
  if (partes.length) {
    lineas.push("Se arma combinando una opción de cada parte:");
    for (const p of partes) lineas.push(`- ${p.parte}: ${opcionesTexto(p.opciones)}.`);
  }
  if (totalCtx) {
    lineas.push(
      hayVariacion
        ? `Precio del trabajo: desde ${totalCtx}${partesVariables.length ? ` (varía según ${partesVariables.join(" y ")})` : ""}.`
        : `Precio del trabajo: ${totalCtx}.`,
    );
  }

  return {
    texto: lineas.join("\n"),
    title: nombre,
    meta: {
      producto_id: t.producto_id,
      nombre_canonico: nombre,
      nicho: t.nicho ?? null,
      precio_desde: totalPv ? totalDesde : null,
      precio_hasta: totalPv ? (hayVariacion ? null : totalDesde) : null,
      precio_confiable: totalPv != null,
      precios: [...todasLasOpciones.map((o) => o.pv), ...(totalPv ? [totalPv] : [])],
      tipo: "trabajo",
    },
  };
}

/** Todos los chunks de trabajos de un export. Excluye ocultos y los degenerados (<2 PARTES: un trabajo
 *  se define por combinar 2 o más productos distintos). */
export function chunksDeTrabajos(trabajos: TrabajoBot[]): RagChunk[] {
  return trabajos
    .filter((t) => !t.oculto && (t.componentes || []).length >= 2)
    .map((t) => chunkTrabajo(t));
}
