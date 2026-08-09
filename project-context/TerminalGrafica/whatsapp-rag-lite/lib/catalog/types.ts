// Formas del export del catálogo (db/curador-export-v2.sql) + estado de curación.
// El bot NUNCA escribe en el catálogo: esta app lee el export y genera SQL de overlay
// por clave natural que Martin aplica a mano. Fuente de verdad de las formas: la query.

export interface Rubro {
  categoria_id: string;
  nombre_vivo: string;
  display_name: string | null;
  parent_id: string | null;
}

/** Regla de precio que afecta a un producto/variante (export v3). */
export interface Regla {
  nombre: string;
  tipo: string; // override | quantity_range | discount | …
  confirmacion?: boolean;
  origen?: string; // 'producto' | 'variante' | 'categoría: <name>'
}

/** Un tramo de la escalera por cantidad. maxQty null = sin tope (∞). */
export interface RangoCantidad {
  value: number;
  minQty: number;
  maxQty: number | null;
}

/** Precio de una variante, horneado en el chunk (metadata.precios) para la inyección determinista.
 *  `ref` ("v1","v2"…) es local al producto y matchea el [vN] que se muestra en "Opciones:". */
export interface PrecioVariante {
  ref: string;
  /** variante_id (v4): para auditoría/freshness/--prices-only. NO es clave de match (el flujo
   *  matchea por nombre del chunk + [vN]); va DENTRO de metadata.precios. */
  variante_id?: string;
  variante: string;
  unidad: string | null; // "por unidad" | "el pack de N unidades" | … | null (no cobrable)
  cobrable: boolean;
  precio_lista: number; // precio del PRIMER tramo (puede ser 0 si el precio vive en la escalera)
  tramos: RangoCantidad[];
  pack_unidades: number | null;
}

export interface Variante {
  variante_id: string;
  nombre_vivo: string;
  display_variante: string | null;
  /** coalesce(display_variante, nombre_vivo) — lo que el bot muestra/matchea */
  variante?: string;
  color: string | null;
  unidad: string | null;
  precio_lista: number | null;
  precio_actualizado?: string | null;
  oculto: boolean;
  mostrable: boolean | null;
  solo_descuentos: boolean | null;
  tiene_override: boolean | null;
  n_reglas_cantidad: number | null;
  atributos?: Record<string, unknown>;
  atributos_propios?: Record<string, unknown>;
  /** escalera por cantidad; puede venir como array o como string (driver pg). */
  rangos_cantidad?: RangoCantidad[] | string | null;
  /** reglas que apuntan sólo a esta variante (export v3) */
  reglas?: Regla[];
}

export interface Producto {
  producto_id: string;
  nombre_vivo: string;
  categoria_id: string;
  categoria: string;
  categoria_display: string | null;
  display_name: string | null;
  /** coalesce(display_name, nombre_vivo) — v2 */
  nombre_canonico?: string;
  sinonimos: string[];
  /** sinónimos + auto-sinónimo, como los ve el bot — v2 */
  sinonimos_efectivos?: string[];
  casos_de_uso: string[];
  familias?: string[];
  atributos?: Record<string, unknown>;
  auto_sinonimo: boolean;
  oculto: boolean;
  por_pagina: boolean;
  por_pack: boolean;
  nombre_origen: string | null;
  /** reglas que apuntan al producto o a una categoría ancestra (export v3) */
  reglas?: Regla[];
  variantes: Variante[];
}

export interface CatalogExport {
  exportado: string;
  schema_version?: number;
  rubros: Rubro[];
  productos: Producto[];
}

// ---- export v4: modelo PRODUCTO-BOT (db/curador-export-v4.sql) ----
// La unidad es el producto-bot (N variantes de public). El contexto de cobro viene POR ITEM,
// así price-display funciona aunque un producto-bot agrupe variantes de varios productos public.

export interface FamiliaExport {
  clave: string;
  nombre: string;
  nota: string | null; // se hornea al embedding (ej. libreria: "se venden sueltos…")
}

/** Una variante de public que cuelga de un producto-bot, con su contexto de cobro resuelto. */
export interface ItemBot {
  variante_id: string;
  nombre_variante_bot: string; // ya resuelto: coalesce(item, display_variante, nombre vivo)
  variante_origen?: string;
  color: string | null;
  unidad: string | null; // public.unit — MIENTE (94/165), no se usa para cobro
  precio_lista: number | null;
  precio_actualizado?: string | null;
  // flags/atributos de cobro POR ITEM (lo que price-display necesita)
  por_pagina: boolean;
  por_pack: boolean;
  atributos?: Record<string, unknown>; // efectivos (unidad_venta, pack_unidades, tamano, …)
  rangos_cantidad?: RangoCantidad[] | string | null;
  mostrable: boolean | null;
  tiene_override: boolean | null;
  solo_descuentos: boolean | null;
  n_reglas_cantidad: number | null;
}

export interface ProductoBot {
  producto_id: string; // = clave natural (NO uuid) — clave de metadata
  clave: string;
  nombre_bot: string;
  familia: string | null;
  familia_nota?: string | null;
  sinonimos: string[];
  casos_de_uso: string[];
  nicho: string | null;
  nota: string | null;
  peso?: number;
  oculto: boolean;
  items: ItemBot[];
}

export interface CatalogExportV4 {
  exportado: string;
  schema_version: number; // 4
  familias: FamiliaExport[];
  productos: ProductoBot[];
}

// ---- estado de curación (editable, se persiste en localStorage) ----

export type Status = "pendiente" | "aprobado" | "rechazado";

export interface VarState {
  display: string;
  oculto: boolean;
  /** clave natural de la variante al momento del export (para replay/merge) */
  nk: string;
}

export interface ProdState {
  status: Status;
  /** clave natural del producto al momento del export */
  nk: string;
  display: string;
  sinonimos: string[];
  casos: string[];
  auto_sinonimo: boolean;
  oculto: boolean;
  por_pagina: boolean;
  por_pack: boolean;
  variantes: Record<string, VarState>;
}

export type DecMap = Record<string, ProdState>;
