// Chunk RAG por PRODUCTO-BOT para el bot lite de embeddings.
// Un chunk = un producto-bot entero (N variantes de public; unidad semántica autocontenida).
// El texto se embebe y lo lee el agente. El precio y la forma de cobro se derivan POR ITEM
// (un producto-bot puede agrupar variantes con cobros distintos). Función PURA y browser-safe:
// el hash de contenido lo calcula el script de ingesta, no acá.

import type { ItemBot, PrecioVariante, ProductoBot, TrabajoBot, VarianteTrabajo } from "./types";
import { contextoPrecio, fmtPrecio, precioVariante } from "./price-display";

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
// TRABAJOS (combos): un chunk = un trabajo entero. El trabajo tiene VARIANTES CERRADAS propias (medidas),
// cada una con sus componentes concretos ya enumerados (las bot.variant que van JUNTAS). El texto lista
// "- [t1] A3 ($X); …" con refs [tN] corridos (por position) y arranca con "Trabajo:" para que el
// Verificador reconozca la composición y no la marque como fusión de variantes. El precio de cada
// variante-de-trabajo = Σ de sus componentes; no hay cartesiano ni suma de mínimos sueltos.
// ---------------------------------------------------------------------------------------------------

const conNombre = (it: ItemBot): boolean =>
  !!(it.nombre_variante_bot || it.variante_origen || "").trim();

/** Item sintético que representa el precio de una VARIANTE-DE-TRABAJO (Σ de sus componentes), para
 *  hornearlo con precioVariante como un precio más (unidad_venta 'trabajo' → "por trabajo"). */
function itemVarianteTrabajo(producto_id: string, ref_pos: number, total: number): ItemBot {
  return {
    variante_id: `${producto_id}::t${ref_pos}`,
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

/** Hornea el PrecioVariante de una variante-de-trabajo. Su precio = Σ del precio_lista de sus
 *  componentes, cada uno multiplicado por su `cantidad` (default 1 si no viene); es cobrable SOLO si
 *  tiene componentes y TODOS son confiables (precio simple, sin override/escalera): si alguno es dudoso,
 *  la variante-de-trabajo se lista sin precio (a confirmar por mail). El nombre visible es el nombre_bot
 *  de la variante-de-trabajo, no "Total". */
function precioVarianteTrabajo(vt: VarianteTrabajo): PrecioVariante {
  const ref = `t${vt.ref_pos}`;
  const nombre = (vt.nombre_bot || "").trim();
  const componentes = (vt.componentes || []).filter(conNombre);
  const confiable = componentes.length > 0 && componentes.every(itemPrecioConfiable);
  const suma = componentes.reduce(
    (acc, it) => acc + (Number(it.precio_lista) || 0) * (Number(it.cantidad) || 1),
    0,
  );
  const pv = precioVariante(itemVarianteTrabajo("", vt.ref_pos, confiable ? suma : 0), ref);
  return { ...pv, variante: nombre, cobrable: confiable && suma > 0 };
}

/** Arma el chunk RAG de un TRABAJO. Asume !oculto y ≥1 variante-de-trabajo (ver chunksDeTrabajos). Cada
 *  variante-de-trabajo trae su precio real (Σ de sus componentes); el "desde" = mínimo entre las variantes
 *  con precio confiable. Con una sola variante-de-trabajo, el precio es exacto (sin "desde"). El "desde" /
 *  los precios se muestran solo si mostrar_total. */
export function chunkTrabajo(t: TrabajoBot): RagChunk {
  const nombre = (t.nombre_bot || "").trim();
  const sinonimos = (t.sinonimos || []).map((s) => s.trim()).filter(Boolean);
  const casos = (t.casos_de_uso || []).map((s) => s.trim()).filter(Boolean);

  // Una entrada por variante-de-trabajo (con nombre), ordenada por ref_pos → ref [tN] estable.
  const variantes = (t.variantes || [])
    .filter((vt) => (vt.nombre_bot || "").trim())
    .slice()
    .sort((a, b) => a.ref_pos - b.ref_pos)
    .map((vt) => precioVarianteTrabajo(vt));

  // "desde" = mínimo real entre variantes-de-trabajo con precio confiable (combinaciones válidas).
  const confiables = variantes.filter((pv) => pv.cobrable);
  const preciosConfiables = confiables.map((pv) => Number(pv.precio_lista));
  const hayPrecio = t.mostrar_total && preciosConfiables.length > 0;
  const desde = hayPrecio ? Math.min(...preciosConfiables) : null;
  const hasta = hayPrecio ? Math.max(...preciosConfiables) : null;
  const hayVariacion = preciosConfiables.length > 1;

  const lineas: string[] = [];
  lineas.push(`Trabajo: ${nombre}.`);
  if (sinonimos.length) lineas.push(`También llamado: ${sinonimos.join(", ")}.`);
  if (casos.length) lineas.push(`Sirve para: ${casos.join(", ")}.`);
  if (t.nota && t.nota.trim()) lineas.push(t.nota.trim());
  if (variantes.length) {
    lineas.push("Opciones del trabajo (cada una es una combinación cerrada; el cliente elige una):");
    for (const pv of variantes) {
      const ctx = t.mostrar_total ? contextoPrecio(pv) : null;
      lineas.push(`- [${pv.ref}] ${pv.variante}${ctx ? ` (${ctx})` : ""}.`);
    }
  }
  if (hayPrecio && desde != null) {
    // Monto + "por trabajo" (la unidad de cualquier variante-de-trabajo confiable es la misma).
    const unidad = confiables[0]?.unidad ? ` ${confiables[0].unidad}` : "";
    lineas.push(
      hayVariacion
        ? `Precio del trabajo: desde ${fmtPrecio(desde)}${unidad} (según la variante).`
        : `Precio del trabajo: ${fmtPrecio(desde)}${unidad}.`,
    );
  }

  return {
    texto: lineas.join("\n"),
    title: nombre,
    meta: {
      producto_id: t.producto_id,
      nombre_canonico: nombre,
      nicho: t.nicho ?? null,
      precio_desde: desde,
      precio_hasta: hayPrecio ? (hayVariacion ? null : hasta) : null,
      precio_confiable: hayPrecio,
      precios: variantes,
      tipo: "trabajo",
    },
  };
}

/** Todos los chunks de trabajos de un export. Excluye ocultos y los degenerados (sin ninguna
 *  variante-de-trabajo: un trabajo se define por tener ≥1 combinación cerrada cotizable). */
export function chunksDeTrabajos(trabajos: TrabajoBot[]): RagChunk[] {
  return trabajos
    .filter((t) => !t.oculto && (t.variantes || []).some((vt) => (vt.nombre_bot || "").trim()))
    .map((t) => chunkTrabajo(t));
}
