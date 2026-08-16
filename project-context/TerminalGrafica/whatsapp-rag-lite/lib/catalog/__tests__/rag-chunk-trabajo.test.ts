// Prueba el chunk de TRABAJO con COMBINACIONES: partes agrupadas por producto (opciones alternativas),
// refs [cN] corridos, total "desde" (combinación más barata), y la validación del loader. Fixtures
// sintéticos (memoria "los fixtures mienten": acá el shape es simple y controlado; la lógica de precio
// la comparte con price-display ya testeado).
import { describe, it, expect } from "vitest";
import { parseExportV4 } from "../loader";
import { chunkTrabajo, chunksDeTrabajos } from "../rag-chunk";
import type { ItemBot, TrabajoBot, TrabajoComponente } from "../types";

function matBase(over: Partial<ItemBot> = {}): ItemBot {
  return {
    variante_id: "m-x",
    nombre_variante_bot: "Opción",
    color: null,
    unidad: null,
    precio_lista: 800,
    por_pack: false,
    atributos: { unidad_venta: "unidad" },
    rangos_cantidad: null,
    mostrable: true,
    tiene_override: false,
    solo_descuentos: false,
    n_reglas_cantidad: 0,
    ...over,
  };
}

function comp(nombre_bot: string, producto_id: string, items: ItemBot[]): TrabajoComponente {
  return { producto_id, nombre_bot, items };
}

function trabajoBase(over: Partial<TrabajoBot> = {}): TrabajoBot {
  return {
    producto_id: "encartonado-con-impresion",
    nombre_bot: "Encartonado con impresión",
    sinonimos: ["encartonado impreso"],
    casos_de_uso: ["portfolios", "muestras"],
    nicho: null,
    nota: null,
    oculto: false,
    mostrar_total: true,
    componentes: [
      comp("Impresión encapada", "impresion-encapada", [
        matBase({ variante_id: "i-25", nombre_variante_bot: "25%", precio_lista: 800 }),
        matBase({ variante_id: "i-50", nombre_variante_bot: "50%", precio_lista: 1000 }),
        matBase({ variante_id: "i-100", nombre_variante_bot: "100%", precio_lista: 1500 }),
      ]),
      comp("Encartonado", "encartonado", [
        matBase({ variante_id: "e-ch", nombre_variante_bot: "Chico", precio_lista: 500 }),
        matBase({ variante_id: "e-gr", nombre_variante_bot: "Grande", precio_lista: 700 }),
      ]),
    ],
    ...over,
  };
}

describe("chunkTrabajo: partes agrupadas + refs corridos", () => {
  const c = chunkTrabajo(trabajoBase());

  it("el texto arranca con 'Trabajo:' y agrupa las opciones por parte", () => {
    expect(c.texto.startsWith("Trabajo: Encartonado con impresión.")).toBe(true);
    expect(c.texto).toContain("Se arma combinando una opción de cada parte:");
    expect(c.texto).toContain("- Impresión encapada: [c1] 25%");
    expect(c.texto).toContain("[c2] 50%");
    expect(c.texto).toContain("[c3] 100%");
    expect(c.texto).toContain("- Encartonado: [c4] Chico");
    expect(c.texto).toContain("[c5] Grande");
    expect(c.texto).not.toContain("Opciones:"); // no se confunde con un producto
  });

  it("meta.precios: refs c1..cN de todas las opciones + un ref 'total'", () => {
    expect(c.meta.precios.map((p) => p.ref)).toEqual(["c1", "c2", "c3", "c4", "c5", "total"]);
  });

  it("total 'desde' = suma del más barato de cada parte (800 + 500)", () => {
    const total = c.meta.precios.find((p) => p.ref === "total")!;
    expect(total.precio_lista).toBe(1300);
    expect(total.unidad).toBe("por trabajo");
    expect(total.cobrable).toBe(true);
  });

  it("muestra 'desde …' con las partes que varían", () => {
    expect(c.texto).toContain(
      "Precio del trabajo: desde $1.300 por trabajo (varía según Impresión encapada y Encartonado).",
    );
    expect(c.meta.precio_desde).toBe(1300);
    expect(c.meta.precio_hasta).toBeNull(); // hay variación → tope abierto
    expect(c.meta.precio_confiable).toBe(true);
    expect(c.meta.tipo).toBe("trabajo");
  });
});

describe("chunkTrabajo: una sola combinación (1 opción por parte)", () => {
  const c = chunkTrabajo(
    trabajoBase({
      componentes: [
        comp("Tarjeta", "tarjeta", [matBase({ nombre_variante_bot: "9x5", precio_lista: 800 })]),
        comp("Sobre", "sobre", [matBase({ nombre_variante_bot: "Blanco", precio_lista: 500 })]),
      ],
    }),
  );
  it("muestra el total EXACTO, sin 'desde'", () => {
    expect(c.texto).toContain("Precio del trabajo: $1.300 por trabajo.");
    expect(c.texto).not.toContain("desde");
    expect(c.meta.precio_desde).toBe(1300);
    expect(c.meta.precio_hasta).toBe(1300);
  });
});

describe("chunkTrabajo: el total es OPCIONAL", () => {
  it("mostrar_total=false → sin línea de precio ni ref 'total'", () => {
    const c = chunkTrabajo(trabajoBase({ mostrar_total: false }));
    expect(c.texto).not.toContain("Precio del trabajo:");
    expect(c.meta.precios.some((p) => p.ref === "total")).toBe(false);
    expect(c.meta.precio_confiable).toBe(false);
    expect(c.meta.precio_desde).toBeNull();
  });

  it("un material NO confiable (override) anula el total, aunque mostrar_total=true", () => {
    const c = chunkTrabajo(
      trabajoBase({
        componentes: [
          comp("Impresión encapada", "impresion-encapada", [
            matBase({ nombre_variante_bot: "25%", precio_lista: 800, tiene_override: true }),
          ]),
          comp("Encartonado", "encartonado", [matBase({ nombre_variante_bot: "Chico", precio_lista: 500 })]),
        ],
      }),
    );
    expect(c.texto).not.toContain("Precio del trabajo:");
    expect(c.meta.precios.some((p) => p.ref === "total")).toBe(false);
    // las opciones igual se listan
    expect(c.texto).toContain("[c1] 25%");
  });
});

describe("chunksDeTrabajos: filtros", () => {
  it("excluye ocultos y los trabajos con menos de 2 PARTES", () => {
    const ok = trabajoBase({ producto_id: "ok" });
    const oculto = trabajoBase({ producto_id: "oculto", oculto: true });
    const unaParte = trabajoBase({
      producto_id: "una",
      componentes: [comp("Solo", "solo", [matBase()])],
    });
    const chunks = chunksDeTrabajos([ok, oculto, unaParte]);
    expect(chunks.map((c) => c.meta.producto_id)).toEqual(["ok"]);
  });
});

describe("loader: trabajos agrupados y validados", () => {
  const wrap = (trabajos: unknown) =>
    JSON.stringify({ exportado: "2026-08-16", schema_version: 4, productos: [], trabajos });

  it("acepta un export con trabajos bien formados (partes con items)", () => {
    const { data } = parseExportV4(
      wrap([{ producto_id: "t", componentes: [{ producto_id: "p", nombre_bot: "P", items: [] }] }]),
    );
    expect(data.trabajos).toHaveLength(1);
  });

  it("rechaza un trabajo sin 'componentes'", () => {
    expect(() => parseExportV4(wrap([{ producto_id: "t" }]))).toThrow(/componentes/);
  });

  it("rechaza una parte sin 'items'", () => {
    expect(() =>
      parseExportV4(wrap([{ producto_id: "t", componentes: [{ producto_id: "p", nombre_bot: "P" }] }])),
    ).toThrow(/items/);
  });

  it("un export SIN la clave trabajos sigue parseando (back-compat)", () => {
    const { data } = parseExportV4(
      JSON.stringify({ exportado: "x", schema_version: 4, productos: [] }),
    );
    expect(data.trabajos).toBeUndefined();
  });
});
