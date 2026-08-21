// Prueba el chunk de TRABAJO con VARIANTES CERRADAS: cada variante-de-trabajo enumera sus componentes
// concretos (las bot.variant que van juntas), su precio = Σ de componentes, refs [tN] por position, y el
// "desde" = mínimo real entre variantes-de-trabajo válidas. Fixtures sintéticos (memoria "los fixtures
// mienten": acá el shape es simple y controlado; la lógica de precio la comparte con price-display).
import { describe, it, expect } from "vitest";
import { parseExportV5 } from "../loader";
import { chunkTrabajo, chunksDeTrabajos } from "../rag-chunk";
import type { ItemBot, TrabajoBot, VarianteTrabajo } from "../types";

function matBase(over: Partial<ItemBot> = {}): ItemBot {
  return {
    variante_id: "m-x",
    nombre_variante_bot: "Componente",
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

function vt(nombre_bot: string, ref_pos: number, componentes: ItemBot[]): VarianteTrabajo {
  return { nombre_bot, ref_pos, componentes };
}

function trabajoBase(over: Partial<TrabajoBot> = {}): TrabajoBot {
  return {
    producto_id: "encartonado",
    nombre_bot: "Encartonado",
    sinonimos: ["montado sobre cartón"],
    casos_de_uso: ["portfolios", "muestras"],
    nicho: null,
    nota: null,
    oculto: false,
    mostrar_total: true,
    // A3 = encartonado A3 ($3.500) + encapsulado A3 ($750) = 4.250
    // 100x70 = encartonado 100x70 ($6.500) + encapsulado por metro ($1.200) = 7.700
    variantes: [
      vt("A3", 1, [
        matBase({ variante_id: "enc-a3", nombre_variante_bot: "Encartonado A3", precio_lista: 3500 }),
        matBase({ variante_id: "encap-a3", nombre_variante_bot: "Encapsulado A3", precio_lista: 750 }),
      ]),
      vt("100x70", 2, [
        matBase({ variante_id: "enc-100", nombre_variante_bot: "Encartonado 100x70", precio_lista: 6500 }),
        matBase({ variante_id: "encap-m", nombre_variante_bot: "Encapsulado por metro", precio_lista: 1200 }),
      ]),
    ],
    ...over,
  };
}

describe("chunkTrabajo: variantes-de-trabajo cerradas + refs por position", () => {
  const c = chunkTrabajo(trabajoBase());

  it("el texto arranca con 'Trabajo:' y lista una línea por variante-de-trabajo con [tN]", () => {
    expect(c.texto.startsWith("Trabajo: Encartonado.")).toBe(true);
    expect(c.texto).toContain("Opciones del trabajo (cada una es una combinación cerrada; el cliente elige una):");
    expect(c.texto).toContain("- [t1] A3 ($4.250 por trabajo).");
    expect(c.texto).toContain("- [t2] 100x70 ($7.700 por trabajo).");
    expect(c.texto).not.toContain("Opciones:"); // no se confunde con un producto
    expect(c.texto).not.toContain("- Parte:"); // modelo viejo, ya no existe
  });

  it("meta.precios: una entrada por variante-de-trabajo, ref t1..tN, precio = Σ de componentes", () => {
    expect(c.meta.precios.map((p) => p.ref)).toEqual(["t1", "t2"]);
    const a3 = c.meta.precios.find((p) => p.ref === "t1")!;
    expect(a3.variante).toBe("A3");
    expect(a3.precio_lista).toBe(4250);
    expect(a3.unidad).toBe("por trabajo");
    expect(a3.cobrable).toBe(true);
  });

  it("'desde' = mínimo REAL entre variantes-de-trabajo válidas (4.250, no una suma de mínimos sueltos)", () => {
    expect(c.texto).toContain("Precio del trabajo: desde $4.250 por trabajo (según la variante).");
    expect(c.meta.precio_desde).toBe(4250);
    expect(c.meta.precio_hasta).toBeNull(); // hay variación → tope abierto
    expect(c.meta.precio_confiable).toBe(true);
    expect(c.meta.tipo).toBe("trabajo");
  });
});

describe("chunkTrabajo: el 'desde' NO es la suma de mínimos sueltos (fix del bug del cartesiano)", () => {
  // El componente más barato de cada 'lado' (encapsulado A3 $750 + encartonado chico $500 = 1.250) NO
  // forman una combinación válida enumerada. Las variantes-de-trabajo válidas son A3 ($750+$3.500=4.250)
  // y Chico ($1.200+$500=1.700). El "desde" debe ser 1.700 (mínimo VÁLIDO), nunca 1.250.
  const c = chunkTrabajo(
    trabajoBase({
      variantes: [
        vt("A3", 1, [
          matBase({ variante_id: "encap-a3", nombre_variante_bot: "Encapsulado A3", precio_lista: 750 }),
          matBase({ variante_id: "enc-a3", nombre_variante_bot: "Encartonado A3", precio_lista: 3500 }),
        ]),
        vt("Chico", 2, [
          matBase({ variante_id: "encap-m", nombre_variante_bot: "Encapsulado metro", precio_lista: 1200 }),
          matBase({ variante_id: "enc-ch", nombre_variante_bot: "Encartonado chico", precio_lista: 500 }),
        ]),
      ],
    }),
  );
  it("publica el mínimo de una combinación VÁLIDA, no la suma de componentes más baratos", () => {
    expect(c.meta.precio_desde).toBe(1700);
    expect(c.meta.precio_desde).not.toBe(1250);
    expect(c.texto).toContain("desde $1.700 por trabajo");
  });
});

describe("chunkTrabajo: una sola variante-de-trabajo", () => {
  const c = chunkTrabajo(
    trabajoBase({
      variantes: [
        vt("A3", 1, [
          matBase({ nombre_variante_bot: "Encartonado A3", precio_lista: 3500 }),
          matBase({ nombre_variante_bot: "Encapsulado A3", precio_lista: 750 }),
        ]),
      ],
    }),
  );
  it("muestra el precio EXACTO, sin 'desde'", () => {
    expect(c.texto).toContain("Precio del trabajo: $4.250 por trabajo.");
    expect(c.texto).not.toContain("desde");
    expect(c.meta.precio_desde).toBe(4250);
    expect(c.meta.precio_hasta).toBe(4250);
  });
});

describe("chunkTrabajo: cantidad fraccionaria multiplica el precio_lista del componente", () => {
  it("0.5 de un componente de $1.200 suma $600 al total de la variante-de-trabajo", () => {
    const c = chunkTrabajo(
      trabajoBase({
        variantes: [
          vt("A3", 1, [
            matBase({ nombre_variante_bot: "Encartonado A3", precio_lista: 3500 }),
            matBase({ nombre_variante_bot: "Encapsulado por metro", precio_lista: 1200, cantidad: 0.5 }),
          ]),
        ],
      }),
    );
    // 3500 + (1200 * 0.5) = 4100, no 4700
    expect(c.texto).toContain("- [t1] A3 ($4.100 por trabajo).");
    const a3 = c.meta.precios.find((p) => p.ref === "t1")!;
    expect(a3.precio_lista).toBe(4100);
  });

  it("cantidad ausente (undefined) sigue sumando como 1 (compat hacia atrás)", () => {
    const c = chunkTrabajo(
      trabajoBase({
        variantes: [
          vt("A3", 1, [
            matBase({ nombre_variante_bot: "Encartonado A3", precio_lista: 3500 }),
            matBase({ nombre_variante_bot: "Encapsulado A3", precio_lista: 750 }), // sin `cantidad`
          ]),
        ],
      }),
    );
    expect(c.meta.precios.find((p) => p.ref === "t1")!.precio_lista).toBe(4250);
  });

  it("cantidad decimal libre (1.25) sobre múltiples componentes", () => {
    const c = chunkTrabajo(
      trabajoBase({
        variantes: [
          vt("Grande", 1, [
            matBase({ nombre_variante_bot: "Base", precio_lista: 1000, cantidad: 1.25 }),
            matBase({ nombre_variante_bot: "Extra", precio_lista: 400, cantidad: 3 }),
          ]),
        ],
      }),
    );
    // (1000*1.25) + (400*3) = 1250 + 1200 = 2450
    expect(c.meta.precios.find((p) => p.ref === "t1")!.precio_lista).toBe(2450);
  });
});

describe("chunkTrabajo: variante-de-trabajo con componente no cobrable", () => {
  it("esa variante-de-trabajo se lista SIN precio; las demás sí lo traen", () => {
    const c = chunkTrabajo(
      trabajoBase({
        variantes: [
          vt("A3", 1, [
            matBase({ nombre_variante_bot: "Encartonado A3", precio_lista: 3500 }),
            matBase({ nombre_variante_bot: "Encapsulado A3", precio_lista: 750 }),
          ]),
          // 100x70: un componente con override → no confiable → variante-de-trabajo sin precio
          vt("100x70", 2, [
            matBase({ nombre_variante_bot: "Encartonado 100x70", precio_lista: 6500, tiene_override: true }),
            matBase({ nombre_variante_bot: "Encapsulado metro", precio_lista: 1200 }),
          ]),
        ],
      }),
    );
    // la A3 se lista con precio, la 100x70 se lista sin precio
    expect(c.texto).toContain("- [t1] A3 ($4.250 por trabajo).");
    expect(c.texto).toContain("- [t2] 100x70.");
    const v100 = c.meta.precios.find((p) => p.ref === "t2")!;
    expect(v100.cobrable).toBe(false);
    // el "desde" ignora la no cobrable → es el precio de la A3
    expect(c.meta.precio_desde).toBe(4250);
    expect(c.meta.precio_hasta).toBe(4250); // solo 1 confiable → no hay variación
    expect(c.texto).toContain("Precio del trabajo: $4.250 por trabajo.");
  });
});

describe("chunkTrabajo: el precio es OPCIONAL (mostrar_total)", () => {
  it("mostrar_total=false → lista las variantes SIN precio y sin línea 'Precio del trabajo:'", () => {
    const c = chunkTrabajo(trabajoBase({ mostrar_total: false }));
    expect(c.texto).not.toContain("Precio del trabajo:");
    expect(c.texto).toContain("- [t1] A3."); // sin monto
    expect(c.texto).not.toContain("$4.250");
    expect(c.meta.precio_confiable).toBe(false);
    expect(c.meta.precio_desde).toBeNull();
  });
});

describe("chunksDeTrabajos: filtros", () => {
  it("excluye ocultos y los trabajos sin ninguna variante-de-trabajo con nombre", () => {
    const ok = trabajoBase({ producto_id: "ok" });
    const oculto = trabajoBase({ producto_id: "oculto", oculto: true });
    const sinVariantes = trabajoBase({ producto_id: "vacio", variantes: [] });
    const chunks = chunksDeTrabajos([ok, oculto, sinVariantes]);
    expect(chunks.map((c) => c.meta.producto_id)).toEqual(["ok"]);
  });

  it("un trabajo con UNA sola variante-de-trabajo es válido (no se filtra)", () => {
    const una = trabajoBase({
      producto_id: "una",
      variantes: [vt("A3", 1, [matBase({ precio_lista: 3500 }), matBase({ precio_lista: 750 })])],
    });
    expect(chunksDeTrabajos([una])).toHaveLength(1);
  });
});

describe("loader: trabajos con variantes-de-trabajo, validados", () => {
  const wrap = (trabajos: unknown) =>
    JSON.stringify({ exportado: "2026-08-18", schema_version: 5, productos: [], trabajos });

  it("acepta un export con trabajos bien formados (variantes con componentes)", () => {
    const { data } = parseExportV5(
      wrap([{ producto_id: "t", variantes: [{ nombre_bot: "A3", ref_pos: 1, componentes: [] }] }]),
    );
    expect(data.trabajos).toHaveLength(1);
  });

  it("rechaza un trabajo sin 'variantes'", () => {
    expect(() => parseExportV5(wrap([{ producto_id: "t" }]))).toThrow(/variantes/);
  });

  it("rechaza una variante-de-trabajo sin 'componentes'", () => {
    expect(() =>
      parseExportV5(wrap([{ producto_id: "t", variantes: [{ nombre_bot: "A3", ref_pos: 1 }] }])),
    ).toThrow(/componentes/);
  });

  it("un export SIN la clave trabajos sigue parseando", () => {
    const { data } = parseExportV5(
      JSON.stringify({ exportado: "x", schema_version: 5, productos: [] }),
    );
    expect(data.trabajos).toBeUndefined();
  });
});
