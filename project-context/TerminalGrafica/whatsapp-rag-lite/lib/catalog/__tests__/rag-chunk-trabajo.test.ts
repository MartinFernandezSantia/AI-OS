// Prueba el chunk de TRABAJO (combo de materiales): total calculado, opcional, autoidentificación,
// y la validación del loader. Fixtures sintéticos (memoria "los fixtures mienten": acá el shape es
// simple y controlado, la lógica de precio la comparte con price-display ya testeado).
import { describe, it, expect } from "vitest";
import { parseExportV4 } from "../loader";
import { chunkTrabajo, chunksDeTrabajos } from "../rag-chunk";
import type { ItemBot, TrabajoBot } from "../types";

function matBase(over: Partial<ItemBot> = {}): ItemBot {
  return {
    variante_id: "m-x",
    nombre_variante_bot: "Material",
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

function trabajoBase(over: Partial<TrabajoBot> = {}): TrabajoBot {
  return {
    producto_id: "invitaciones-casamiento",
    nombre_bot: "Invitaciones de casamiento",
    sinonimos: ["partes de casamiento"],
    casos_de_uso: ["casamiento", "boda"],
    nicho: null,
    nota: null,
    oculto: false,
    mostrar_total: true,
    componentes: [
      matBase({ variante_id: "m-tarjeta", nombre_variante_bot: "Tarjeta impresa", precio_lista: 800 }),
      matBase({ variante_id: "m-sobre", nombre_variante_bot: "Sobre", precio_lista: 500, por_pack: true }),
    ],
    ...over,
  };
}

describe("chunkTrabajo: total calculado + autoidentificación", () => {
  const c = chunkTrabajo(trabajoBase());

  it("el texto arranca con 'Trabajo:' y lista los materiales en 'Incluye: [c1]…[c2]…'", () => {
    expect(c.texto.startsWith("Trabajo: Invitaciones de casamiento.")).toBe(true);
    expect(c.texto).toContain("Incluye: [c1] Tarjeta impresa");
    expect(c.texto).toContain("[c2] Sobre");
    expect(c.texto).not.toContain("Opciones:"); // no se confunde con un producto
  });

  it("muestra la línea de total calculado (suma de los materiales)", () => {
    expect(c.texto).toContain("Precio del trabajo: $1.300 por trabajo.");
  });

  it("meta.tipo = 'trabajo' y nombre_canonico = nombre_bot", () => {
    expect(c.meta.tipo).toBe("trabajo");
    expect(c.meta.nombre_canonico).toBe("Invitaciones de casamiento");
    expect(c.title).toBe("Invitaciones de casamiento");
  });

  it("meta.precios: refs c1..cN de los materiales + un ref 'total'", () => {
    const refs = c.meta.precios.map((p) => p.ref);
    expect(refs).toEqual(["c1", "c2", "total"]);
    const total = c.meta.precios.find((p) => p.ref === "total")!;
    expect(total.precio_lista).toBe(1300); // 800 + 500
    expect(total.unidad).toBe("por trabajo");
    expect(total.cobrable).toBe(true);
  });

  it("precio_desde/hasta = total y precio_confiable true", () => {
    expect(c.meta.precio_desde).toBe(1300);
    expect(c.meta.precio_hasta).toBe(1300);
    expect(c.meta.precio_confiable).toBe(true);
  });

  it("cada material conserva su propia forma de cobro", () => {
    const tarjeta = c.meta.precios.find((p) => p.ref === "c1")!;
    const sobre = c.meta.precios.find((p) => p.ref === "c2")!;
    expect(tarjeta.unidad).toBe("por unidad");
    expect(sobre.unidad).toBe("el pack");
  });
});

describe("chunkTrabajo: el total es OPCIONAL", () => {
  it("mostrar_total=false → sin ref 'total' ni línea de precio; solo los materiales", () => {
    const c = chunkTrabajo(trabajoBase({ mostrar_total: false }));
    expect(c.texto).not.toContain("Precio del trabajo:");
    expect(c.meta.precios.map((p) => p.ref)).toEqual(["c1", "c2"]);
    expect(c.meta.precio_confiable).toBe(false);
    expect(c.meta.precio_desde).toBeNull();
  });

  it("un material NO confiable (override) anula el total, aunque mostrar_total=true", () => {
    const c = chunkTrabajo(
      trabajoBase({
        componentes: [
          matBase({ nombre_variante_bot: "Tarjeta", precio_lista: 800 }),
          matBase({ nombre_variante_bot: "Sobre dudoso", precio_lista: 500, tiene_override: true }),
        ],
      }),
    );
    expect(c.texto).not.toContain("Precio del trabajo:");
    expect(c.meta.precios.some((p) => p.ref === "total")).toBe(false);
    expect(c.meta.precio_confiable).toBe(false);
    // los materiales igual se listan
    expect(c.texto).toContain("Incluye: [c1] Tarjeta");
  });
});

describe("chunksDeTrabajos: filtros", () => {
  it("excluye ocultos y los trabajos con menos de 2 materiales", () => {
    const ok = trabajoBase({ producto_id: "ok" });
    const oculto = trabajoBase({ producto_id: "oculto", oculto: true });
    const unSolo = trabajoBase({ producto_id: "uno", componentes: [matBase()] });
    const chunks = chunksDeTrabajos([ok, oculto, unSolo]);
    expect(chunks.map((c) => c.meta.producto_id)).toEqual(["ok"]);
  });
});

describe("loader: trabajos opcionales y validados", () => {
  const wrap = (trabajos: unknown) =>
    JSON.stringify({ exportado: "2026-08-16", schema_version: 4, productos: [], trabajos });

  it("acepta un export con trabajos bien formados", () => {
    const { data } = parseExportV4(wrap([{ producto_id: "t", componentes: [] }]));
    expect(data.trabajos).toHaveLength(1);
  });

  it("rechaza un trabajo sin 'componentes'", () => {
    expect(() => parseExportV4(wrap([{ producto_id: "t" }]))).toThrow(/componentes/);
  });

  it("un export SIN la clave trabajos sigue parseando (back-compat)", () => {
    const { data } = parseExportV4(
      JSON.stringify({ exportado: "x", schema_version: 4, productos: [] }),
    );
    expect(data.trabajos).toBeUndefined();
  });
});
