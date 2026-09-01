// Lógica de precio por unidad (sin totales). v4: opera POR ITEM (el contexto de cobro vive en
// cada ItemBot). Casos calcados de productos reales del export.
import { describe, it, expect } from "vitest";
import { asRangos, contextoPrecio, derivarUnidad, precioDisplay, precioVariante } from "../price-display";
import type { ItemBot } from "../types";

function item(over: Partial<ItemBot> = {}): ItemBot {
  return {
    variante_id: "v",
    nombre_variante_bot: "V",
    color: null,
    unidad: "Hoja",
    precio_lista: null,
    por_pack: false,
    atributos: {},
    rangos_cantidad: null,
    mostrable: true,
    tiene_override: false,
    solo_descuentos: false,
    n_reglas_cantidad: 0,
    ...over,
  };
}

describe("pack simple (100 Tarjetas / Doble Faz)", () => {
  const v = item({
    nombre_variante_bot: "Doble Faz",
    por_pack: true,
    precio_lista: 15000,
    atributos: { unidad_venta: "pack", pack_unidades: 100, multiplica: false },
  });

  it("unidad = 'el pack de 100 unidades' (nunca la columna unidad)", () => {
    expect(derivarUnidad(v)).toBe("el pack de 100 unidades");
  });
  it("cobrable con precio_lista", () => {
    const pv = precioVariante(v, "v1");
    expect(pv.cobrable).toBe(true);
    expect(pv.pack_unidades).toBe(100);
    expect(pv.variante_id).toBe("v");
  });
  it("precioDisplay = SOLO monto (la unidad la pone el agente); contexto = con unidad", () => {
    const pv = precioVariante(v, "v1");
    expect(precioDisplay(pv)).toBe("$15.000");
    expect(contextoPrecio(pv)).toBe("$15.000 el pack de 100 unidades");
  });
});

describe("escalera por cantidad (Iman, precio_lista 0)", () => {
  const v = item({
    nombre_variante_bot: "Imanes",
    precio_lista: 0,
    mostrable: false,
    n_reglas_cantidad: 1,
    atributos: { unidad_venta: "unidad" },
    rangos_cantidad: [
      { value: 8000, minQty: 1, maxQty: 3 },
      { value: 7200, minQty: 4, maxQty: 10 },
      { value: 6500, minQty: 11, maxQty: 20 },
    ],
  });

  it("unidad 'por unidad', cobrable por la escalera aunque precio_lista sea 0", () => {
    expect(derivarUnidad(v)).toBe("por unidad");
    expect(precioVariante(v, "v1").cobrable).toBe(true);
  });
  it("sin cantidad → tramo de menor minQty, SOLO monto (la variación la dice el agente)", () => {
    expect(precioDisplay(precioVariante(v, "v1"))).toBe("$8.000");
  });
  it("con cantidad → tramo correcto (solo monto)", () => {
    const pv = precioVariante(v, "v1");
    expect(precioDisplay(pv, 2)).toBe("$8.000");
    expect(precioDisplay(pv, 15)).toBe("$6.500");
  });
  it("contexto muestra todos los tramos", () => {
    expect(contextoPrecio(precioVariante(v, "v1"))).toBe("por unidad: 1-3 $8.000, 4-10 $7.200, 11-20 $6.500");
  });
  it("asRangos parsea string (driver pg)", () => {
    expect(asRangos({ rangos_cantidad: JSON.stringify([{ value: 500, minQty: 1, maxQty: null }]) })).toEqual([
      { value: 500, minQty: 1, maxQty: null },
    ]);
  });
});

describe("unidad de cobro curada (Iman laminado → plancha A3 vía sale_unit)", () => {
  // El dashboard cura bot.variant.sale_unit='plancha_a3' → el export lo baja como
  // atributos.unidad_venta. Ya no hay override hardcodeado: la unidad sale del catálogo.
  const iman = item({
    nombre_variante_bot: "Imanes",
    precio_lista: 0,
    atributos: { unidad_venta: "plancha_a3" },
    rangos_cantidad: [
      { value: 8000, minQty: 1, maxQty: 3 },
      { value: 7200, minQty: 4, maxQty: 10 },
      { value: 6500, minQty: 11, maxQty: 20 },
    ],
  });

  it("muestra 'por plancha A3', no 'por unidad'", () => {
    expect(derivarUnidad(iman)).toBe("por plancha A3");
    expect(contextoPrecio(precioVariante(iman, "v1"))).toBe(
      "por plancha A3: 1-3 $8.000, 4-10 $7.200, 11-20 $6.500",
    );
  });

  it("otras variantes con unidad_venta='unidad' siguen dando 'por unidad'", () => {
    const otra = item({ variante_id: "otra", precio_lista: 500, atributos: { unidad_venta: "unidad" } });
    expect(derivarUnidad(otra)).toBe("por unidad");
  });
});

describe("packs discretos con hueco → redondeo HACIA ARRIBA al que cubre la cantidad", () => {
  const v = item({
    nombre_variante_bot: "Pack",
    por_pack: true,
    precio_lista: 0,
    n_reglas_cantidad: 1,
    atributos: { unidad_venta: "pack" },
    rangos_cantidad: [
      { value: 15000, minQty: 100, maxQty: 100 },
      { value: 60000, minQty: 500, maxQty: 500 },
      { value: 100000, minQty: 1000, maxQty: 1000 },
    ],
  });
  const pv = precioVariante(v, "v1");

  it("cantidad exacta de un pack → ese pack (solo monto)", () => {
    expect(precioDisplay(pv, 100)).toBe("$15.000");
    expect(precioDisplay(pv, 1000)).toBe("$100.000");
  });
  it("cantidad en el hueco → próximo pack que la cubre (300 → 500)", () => {
    expect(precioDisplay(pv, 300)).toBe("$60.000");
    expect(precioDisplay(pv, 600)).toBe("$100.000");
  });
  it("debajo del menor → el pack más chico", () => {
    expect(precioDisplay(pv, 50)).toBe("$15.000");
  });
  it("por encima de todos → el pack más grande (no hay mayor)", () => {
    expect(precioDisplay(pv, 1500)).toBe("$100.000");
  });
});

describe("cobro por item independiente (mismo producto-bot, cobros distintos)", () => {
  const a4 = item({ nombre_variante_bot: "A4", por_pack: false, precio_lista: 800, atributos: { unidad_venta: "unidad" } });
  const carnet = item({ nombre_variante_bot: "Carnet", por_pack: true, precio_lista: 500, atributos: {} });

  it("cada item deriva su propia unidad", () => {
    expect(derivarUnidad(a4)).toBe("por unidad");
    expect(derivarUnidad(carnet)).toBe("el pack");
  });
});

describe("sin unidad de cobro → no cobrable → a mail", () => {
  const v = item({ nombre_variante_bot: "X", precio_lista: 500, atributos: {} }); // sin unidad_venta

  it("derivarUnidad null y precioDisplay null", () => {
    expect(derivarUnidad(v)).toBeNull();
    const pv = precioVariante(v, "v1");
    expect(pv.cobrable).toBe(false);
    expect(precioDisplay(pv)).toBeNull();
    expect(contextoPrecio(pv)).toBeNull();
  });
});
