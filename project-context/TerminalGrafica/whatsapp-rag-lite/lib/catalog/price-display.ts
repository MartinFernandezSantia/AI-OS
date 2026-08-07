// Derivación de precio POR UNIDAD para el bot RAG lite. Porteo del subconjunto SIN totales de
// `Armar Candidatos` + `Calcular Montos` del v10 (nunca multiplica, nunca totaliza, sin CAP).
//
// Función PURA y testeada: es la lógica que le habla de plata al cliente, así que va con tests
// (memoria "los fixtures mienten"). El nodo Code "Insertar Precios" de n8n inlinea una COPIA de
// `precioDisplay` (n8n no importa TS) — si tocás la lógica, actualizá las dos.

import type { Producto, Variante, RangoCantidad, PrecioVariante } from "./types";

// unidad_venta → texto que ve el cliente. NUNCA se usa la columna `unidad` (miente en 94/165).
const COBRO: Record<string, string> = {
  trabajo: "por trabajo",
  unidad: "por unidad",
  hoja: "por hoja",
  pagina: "por pagina",
  m2: "por m2",
  metro: "por metro",
};

/** Lee un atributo de la variante, cayendo al del producto. */
function attr(p: Producto, v: Variante, key: string): unknown {
  const va = (v.atributos as Record<string, unknown>) || {};
  if (va[key] != null) return va[key];
  const pa = (p.atributos as Record<string, unknown>) || {};
  return pa[key];
}

/** rangos_cantidad normalizado (puede venir string del driver pg). */
export function asRangos(v: Variante): RangoCantidad[] {
  let r: unknown = v.rangos_cantidad;
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
export function derivarUnidad(p: Producto, v: Variante): string | null {
  const tramos = asRangos(v);
  const packUnidades = Number(attr(p, v, "pack_unidades")) || 0;
  if (p.por_pagina) return "por pagina";
  // Con escalera, la cantidad la manda el tramo → el pack se calla ("tramoPisaPack").
  if (packUnidades > 0 && tramos.length === 0) return `el pack de ${packUnidades} unidades`;
  if (p.por_pack) return "el pack";
  const uv = String(attr(p, v, "unidad_venta") || "").toLowerCase().trim();
  if (uv && COBRO[uv]) return COBRO[uv];
  return null;
}

/** Arma la forma horneada del precio de una variante (va a metadata.precios). */
export function precioVariante(p: Producto, v: Variante, ref: string): PrecioVariante {
  const unidad = derivarUnidad(p, v);
  const tramos = asRangos(v);
  const precioLista = Number(v.precio_lista) || 0;
  const hayTramo = tramos.some((t) => t.value > 0);
  const packUnidades = Number(attr(p, v, "pack_unidades")) || null;
  return {
    ref,
    variante: (v.variante || v.display_variante || v.nombre_vivo || "").trim(),
    unidad,
    cobrable: unidad != null && (precioLista > 0 || hayTramo),
    precio_lista: precioLista,
    tramos,
    pack_unidades: packUnidades,
  };
}

export const fmtPrecio = (n: number): string => "$" + Math.round(Number(n)).toLocaleString("es-AR");

const rangoLabel = (t: RangoCantidad): string => (t.maxQty == null ? `${t.minQty}+` : `${t.minQty}-${t.maxQty}`);

/** Elige el precio unitario a mostrar dada una cantidad. SIN totales/multiplicación.
 *  - simple → "$X <unidad>"
 *  - escalera + cantidad → "$Xtramo <unidad>"
 *  - escalera sin cantidad → "$Xmin <unidad> (varía según cantidad)" (tramo de menor minQty = techo por unidad)
 *  - no cobrable / sin monto → null (el llamador pone "a confirmar por mail"). */
export function precioDisplay(pv: PrecioVariante, cantidad?: number | null): string | null {
  if (!pv.cobrable || !pv.unidad) return null;
  const tramos = pv.tramos.filter((t) => t.value > 0);
  let value = pv.precio_lista > 0 ? pv.precio_lista : 0;
  let varia = false;
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
      varia = true;
    }
  }
  if (!(value > 0)) return null;
  return `${fmtPrecio(value)} ${pv.unidad}${varia ? " (varía según cantidad)" : ""}`;
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
