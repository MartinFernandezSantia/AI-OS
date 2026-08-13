// Formas del export del catálogo (whatsapp-automation/db/curador-export.sql) que consume el bot RAG.
// El bot NUNCA escribe el catálogo: el dashboard (app aparte) cura bot.product/bot.variant, el
// generador de export produce este JSON, y el ingest lo embebe. Fuente de verdad de las formas: la query.
//
// Inglés = solo tablas/columnas: las CLAVES de este JSON quedan en español (producto_id, nombre_bot,
// atributos.unidad_venta, …) — así los tipos, los fixtures y las queries metadata->> no se tocan.
// La unidad semántica es el PRODUCTO-BOT (N variantes de public). El contexto de cobro viene POR ITEM,
// así price-display funciona aunque un producto-bot agrupe variantes de varios productos public.

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
  /** variante_id: para auditoría/freshness/--prices-only. NO es clave de match (el flujo matchea por
   *  nombre del chunk + [vN]); va DENTRO de metadata.precios. */
  variante_id?: string;
  variante: string;
  unidad: string | null; // "por unidad" | "el pack de N unidades" | … | null (no cobrable)
  cobrable: boolean;
  precio_lista: number; // precio del PRIMER tramo (puede ser 0 si el precio vive en la escalera)
  tramos: RangoCantidad[];
  pack_unidades: number | null;
}

/** Una variante de public que cuelga de un producto-bot, con su contexto de cobro resuelto.
 *  El precio y las reglas (rangos/override/mostrable) los computa el generador de export desde public;
 *  la unidad de cobro sale de atributos.unidad_venta (= bot.variant.sale_unit). */
export interface ItemBot {
  variante_id: string;
  nombre_variante_bot: string; // ya resuelto: coalesce(bot_name de variant, nombre vivo)
  variante_origen?: string;
  color: string | null;
  unidad: string | null; // public.unit — MIENTE, no se usa para cobro
  precio_lista: number | null;
  precio_actualizado?: string | null;
  por_pack: boolean;
  atributos?: Record<string, unknown>; // efectivos: unidad_venta, pack_unidades
  rangos_cantidad?: RangoCantidad[] | string | null;
  mostrable: boolean | null;
  tiene_override: boolean | null;
  solo_descuentos: boolean | null;
  n_reglas_cantidad: number | null;
}

export interface ProductoBot {
  producto_id: string; // = clave natural (NO uuid) — clave de metadata
  nombre_bot: string;
  sinonimos: string[];
  casos_de_uso: string[];
  nicho: string | null; // filtro blando
  nota: string | null; // info puntual al embedding
  oculto: boolean;
  items: ItemBot[];
}

export interface CatalogExportV4 {
  exportado: string;
  schema_version: number; // 4
  productos: ProductoBot[];
}
