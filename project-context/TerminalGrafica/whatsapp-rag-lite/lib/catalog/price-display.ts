// Derivación de precio POR UNIDAD para el bot RAG lite. Porteo del subconjunto SIN totales de
// `Armar Candidatos` + `Calcular Montos` del v10 (nunca multiplica, nunca totaliza, sin CAP).
//
// v4 (modelo producto-bot): las funciones operan POR ITEM. Un producto-bot puede agrupar variantes
// de VARIOS productos public con formas de cobro distintas, así que el contexto de cobro
// (por_pagina/por_pack/atributos efectivos) viene en cada `ItemBot`, no en un "producto" común.
//
// Función PURA y testeada: es la lógica que le habla de plata al cliente, así que va con tests
// (memoria "los fixtures mienten"). El nodo Code "Insertar Precios" de n8n inlinea una COPIA de
// `precioDisplay` (opera sobre PrecioVariante ya horneado, NO cambió con v4) — si tocás esa
// función, actualizá las dos. `derivarUnidad`/`precioVariante` corren sólo en la ingesta.

import type { ItemBot, RangoCantidad, PrecioVariante } from "./types";

// unidad_venta → texto que ve el cliente. NUNCA se usa la columna `unidad` (miente en 94/165).
const COBRO: Record<string, string> = {
  trabajo: "por trabajo",
  unidad: "por unidad",
  hoja: "por hoja",
  hoja_a3: "por hoja A3",
  plancha_a3: "por plancha A3",
  pagina: "por pagina",
  m2: "por m2",
  metro: "por metro",
};

// Override de unidad_venta POR VARIANTE (clave = variante_id, UUID estable del export).
// Para productos cuyo unidad_venta en el catálogo NO describe cómo se cobra de verdad y confunde
// al cliente. Corregido acá porque sobrevive a re-ingesta/re-export; el fix durable es setear el
// unidad_venta correcto en la curación upstream (ahí este override queda redundante y se saca).
const UNIDAD_VENTA_OVERRIDE: Record<string, string> = {
  // "Iman. Impresión laminada y corte." — se cobra por plancha A3, no "por unidad".
  "6556342c-5169-4c94-85cf-92594811bd2c": "plancha_a3",
};

/** Lee un atributo EFECTIVO del item (en v4 el export ya mergeó producto||variante). */
function attrItem(item: ItemBot, key: string): unknown {
  const a = (item.atributos as Record<string, unknown>) || {};
  return a[key];
}

/** rangos_cantidad normalizado (puede venir string del driver pg). */
export function asRangos(item: Pick<ItemBot, "rangos_cantidad">): RangoCantidad[] {
  let r: unknown = item.rangos_cantidad;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(r)) return [];
  return r
    .map((x) => {
      const o = x as Record<string, unknown>;
      return {
        value: Number(o.value),
        minQty: Number(o.minQty) || 1,
        maxQty: o.maxQty == null ? null : Number(o.maxQty),
      };
    })
    .filter((x) => Number.isFinite(x.value));
}

/** Unidad de cobro mostrable. Cascada exacta del v10; null = no se sabe cómo se cobra → mail. */
export function derivarUnidad(item: ItemBot): string | null {
  const tramos = asRangos(item);
  const packUnidades = Number(attrItem(item, "pack_unidades")) || 0;
  if (item.por_pagina) return "por pagina";
  // Con escalera, la cantidad la manda el tramo → el pack se calla ("tramoPisaPack").
  if (packUnidades > 0 && tramos.length === 0) return `el pack de ${packUnidades} unidades`;
  if (item.por_pack) return "el pack";
  const uv =
    UNIDAD_VENTA_OVERRIDE[item.variante_id] ||
    String(attrItem(item, "unidad_venta") || "").toLowerCase().trim();
  if (uv && COBRO[uv]) return COBRO[uv];
  return null;
}

/** Arma la forma horneada del precio de un item (va a metadata.precios). */
export function precioVariante(item: ItemBot, ref: string): PrecioVariante {
  const unidad = derivarUnidad(item);
  const tramos = asRangos(item);
  const precioLista = Number(item.precio_lista) || 0;
  const hayTramo = tramos.some((t) => t.value > 0);
  const packUnidades = Number(attrItem(item, "pack_unidades")) || null;
  return {
    ref,
    variante_id: item.variante_id,
    variante: (item.nombre_variante_bot || item.variante_origen || "").trim(),
    unidad,
    cobrable: unidad != null && (precioLista > 0 || hayTramo),
    precio_lista: precioLista,
    tramos,
    pack_unidades: packUnidades,
  };
}

export const fmtPrecio = (n: number): string => "$" + Math.round(Number(n)).toLocaleString("es-AR");

const rangoLabel = (t: RangoCantidad): string => (t.maxQty == null ? `${t.minQty}+` : `${t.minQty}-${t.maxQty}`);

/** Monto a inyectar en el {Pn} del mensaje dada una cantidad. Devuelve SOLO el número (+ aviso si
 *  varía): la UNIDAD/forma de cobro la escribe el agente desde "Opciones:", así no se duplica con su
 *  prosa (bug: "Pack de 100 doble faz: $15.000 el pack de 100 unidades"). SIN totales/multiplicación.
 *  - simple → "$X"
 *  - escalera + cantidad → "$Xtramo"
 *  - escalera sin cantidad → "$Xmin" (tramo de menor minQty = techo por unidad). SOLO el monto: la
 *    variación por cantidad la expresa el agente en palabras (ve la escalera entera en "Opciones:"),
 *    no va pegada al número — si no, cae en medio de la frase ("$2.800 (varía…) por hoja").
 *  - no cobrable / sin monto → null (el llamador pone "a confirmar por mail"). */
export function precioDisplay(pv: PrecioVariante, cantidad?: number | null): string | null {
  if (!pv.cobrable || !pv.unidad) return null;
  const tramos = pv.tramos.filter((t) => t.value > 0);
  let value = pv.precio_lista > 0 ? pv.precio_lista : 0;
  if (tramos.length) {
    const c = Number(cantidad);
    if (Number.isFinite(c) && c > 0) {
      const orden = [...tramos].sort((a, b) => a.minQty - b.minQty);
      const exacto = orden.find((x) => c >= x.minQty && (x.maxQty == null || c <= x.maxQty));
      // Sin tramo exacto (cae en un hueco entre packs o debajo del menor): redondear HACIA ARRIBA al
      // próximo tramo que cubra la cantidad (packs 100/500/1000, pide 300 → el de 500). Si supera a
      // todos (no hay tramo mayor), usar el más alto (extrapola el último precio de la escalera).
      const arriba = orden.find((x) => x.minQty > c);
      const t = exacto || arriba || orden[orden.length - 1];
      if (t) value = t.value;
    } else {
      value = [...tramos].sort((a, b) => a.minQty - b.minQty)[0].value;
    }
  }
  if (!(value > 0)) return null;
  return fmtPrecio(value);
}

/** Texto de precio CONTEXTO para el chunk (lo que lee el agente): muestra todos los tramos. */
export function contextoPrecio(pv: PrecioVariante): string | null {
  if (!pv.cobrable || !pv.unidad) return null;
  const tramos = pv.tramos.filter((t) => t.value > 0).sort((a, b) => a.minQty - b.minQty);
  if (tramos.length > 1) {
    return `${pv.unidad}: ${tramos.map((t) => `${rangoLabel(t)} ${fmtPrecio(t.value)}`).join(", ")}`;
  }
  const value = pv.precio_lista > 0 ? pv.precio_lista : tramos[0]?.value || 0;
  if (!(value > 0)) return null;
  return `${fmtPrecio(value)} ${pv.unidad}`;
}
