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
  rangos_cantidad?: unknown;
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
