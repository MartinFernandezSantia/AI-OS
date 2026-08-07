// Lógica de precio por unidad (sin totales). Casos calcados de productos reales del export.
import { describe, it, expect } from "vitest";
import { asRangos, contextoPrecio, derivarUnidad, precioDisplay, precioVariante } from "../price-display";
import type { Producto, Variante } from "../types";

function prod(over: Partial<Producto> = {}): Producto {
  return {
    producto_id: "p", nombre_vivo: "P", categoria_id: "c", categoria: "C", categoria_display: "C",
    display_name: null, sinonimos: [], casos_de_uso: [], atributos: {}, auto_sinonimo: false,
    oculto: false, por_pagina: false, por_pack: false, nombre_origen: null, variantes: [], ...over,
  };
}
function vari(over: Partial<Variante> = {}): Variante {
  return {
    variante_id: "v", nombre_vivo: "V", display_variante: null, variante: "V", color: null,
    unidad: "Hoja", precio_lista: null, oculto: false, mostrable: true, solo_descuentos: false,
    tiene_override: false, n_reglas_cantidad: 0, ...over,
  };
}

describe("pack simple (100 Tarjetas / Doble Faz)", () => {
  const p = prod({ por_pack: true, atributos: { unidad_venta: "pack" } });
  const v = vari({ variante: "Doble Faz", precio_lista: 15000, atributos: { unidad_venta: "pack", pack_unidades: 100, multiplica: false } });

  it("unidad = 'el pack de 100 unidades' (nunca la columna unidad)", () => {
    expect(derivarUnidad(p, v)).toBe("el pack de 100 unidades");
  });
  it("cobrable con precio_lista", () => {
    const pv = precioVariante(p, v, "v1");
    expect(pv.cobrable).toBe(true);
    expect(pv.pack_unidades).toBe(100);
  });
  it("precioDisplay y contexto", () => {
    const pv = precioVariante(p, v, "v1");
    expect(precioDisplay(pv)).toBe("$15.000 el pack de 100 unidades");
    expect(contextoPrecio(pv)).toBe("$15.000 el pack de 100 unidades");
  });
});

describe("escalera por cantidad (Iman, precio_lista 0)", () => {
  const p = prod({ atributos: { unidad_venta: "unidad", multiplica: true } });
  const v = vari({
    variante: "Imanes", precio_lista: 0, mostrable: false, n_reglas_cantidad: 1,
    atributos: { unidad_venta: "unidad" },
    rangos_cantidad: [
      { value: 8000, minQty: 1, maxQty: 3 },
      { value: 7200, minQty: 4, maxQty: 10 },
      { value: 6500, minQty: 11, maxQty: 20 },
    ],
  });

  it("unidad 'por unidad', cobrable por la escalera aunque precio_lista sea 0", () => {
    expect(derivarUnidad(p, v)).toBe("por unidad");
    expect(precioVariante(p, v, "v1").cobrable).toBe(true);
  });
  it("sin cantidad → tramo de menor minQty + aviso", () => {
    expect(precioDisplay(precioVariante(p, v, "v1"))).toBe("$8.000 por unidad (varía según cantidad)");
  });
  it("con cantidad → tramo correcto", () => {
    const pv = precioVariante(p, v, "v1");
    expect(precioDisplay(pv, 2)).toBe("$8.000 por unidad");
    expect(precioDisplay(pv, 15)).toBe("$6.500 por unidad");
  });
  it("contexto muestra todos los tramos", () => {
    expect(contextoPrecio(precioVariante(p, v, "v1"))).toBe("por unidad: 1-3 $8.000, 4-10 $7.200, 11-20 $6.500");
  });
  it("asRangos parsea string (driver pg)", () => {
    const vs = vari({ rangos_cantidad: JSON.stringify([{ value: 500, minQty: 1, maxQty: null }]) });
    expect(asRangos(vs)).toEqual([{ value: 500, minQty: 1, maxQty: null }]);
  });
});

describe("sin unidad de cobro → no cobrable → a mail", () => {
  const p = prod();
  const v = vari({ variante: "X", precio_lista: 500, atributos: {} }); // sin unidad_venta

  it("derivarUnidad null y precioDisplay null", () => {
    expect(derivarUnidad(p, v)).toBeNull();
    const pv = precioVariante(p, v, "v1");
    expect(pv.cobrable).toBe(false);
    expect(precioDisplay(pv)).toBeNull();
    expect(contextoPrecio(pv)).toBeNull();
  });
});
