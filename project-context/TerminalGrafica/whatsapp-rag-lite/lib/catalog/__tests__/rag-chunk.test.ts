// Prueba que el chunk RAG deriva bien del export real de TG + casos de borde sintéticos.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseExport } from "../loader";
import { buildRubrosIndex, chunkRAG, chunksDeExport, esChunkeable } from "../rag-chunk";
import type { CatalogExport, Producto } from "../types";

const raw = readFileSync(join(__dirname, "fixtures", "export.json"), "utf8");
const data: CatalogExport = parseExport(raw).data;
const idx = buildRubrosIndex(data.rubros);
const byId = (id: string) => data.productos.find((p) => p.producto_id === id)!;

describe("chunksDeExport", () => {
  it("excluye los productos ocultos (igual que bot.taxonomia)", () => {
    const ocultos = data.productos.filter((p) => p.oculto).length;
    const chunks = chunksDeExport(data.productos, data.rubros);
    expect(chunks.length).toBe(data.productos.length - ocultos);
    expect(chunks.length).toBe(82); // 88 - 6 en el export real
  });
});

describe("chunkRAG sobre producto de nicho (inmobiliarias)", () => {
  const p = byId("160b7b35-89eb-452a-97ea-85c943089164");
  const c = chunkRAG(p, idx);

  it("captura el nicho como metadata dura", () => {
    expect(c.meta.nicho).toBe("inmobiliarias");
  });
  it("el título es el nombre canónico", () => {
    expect(c.title).toContain("Promoción para inmobiliarias");
  });
  it("el texto incluye rubro, sinónimos y casos de uso", () => {
    expect(c.texto).toContain("rubro: Cartelería en plástico corrugado");
    expect(c.texto).toContain("También llamado:");
    expect(c.texto).toContain("cartel inmobiliario");
    expect(c.texto).toContain("Sirve para:");
    expect(c.texto).toContain("vender propiedad");
  });
  it("precio confiable: variante simple sin reglas → rango poblado", () => {
    expect(c.meta.precio_confiable).toBe(true);
    expect(c.meta.precio_desde).toBe(15000);
    expect(c.meta.precio_hasta).toBe(15000);
  });
  it("meta.precios: una por variante visible, con ref [vN] bien formado", () => {
    expect(c.meta.precios.length).toBeGreaterThan(0);
    c.meta.precios.forEach((pv, i) => expect(pv.ref).toBe(`v${i + 1}`));
    // el texto de Opciones muestra el mismo token
    expect(c.texto).toContain("Opciones: [v1]");
  });
  it("materializa atributos de señal (material)", () => {
    expect(c.texto.toLowerCase()).toContain("material: plastico corrugado");
  });
});

// ---- casos de borde sintéticos ----

function prodBase(over: Partial<Producto> = {}): Producto {
  return {
    producto_id: "p-test",
    nombre_vivo: "Producto Test",
    categoria_id: "cat-x",
    categoria: "Rubro X",
    categoria_display: "Rubro X",
    display_name: null,
    nombre_canonico: "Producto Test",
    sinonimos: [],
    sinonimos_efectivos: [],
    casos_de_uso: [],
    familias: [],
    atributos: {},
    auto_sinonimo: false,
    oculto: false,
    por_pagina: false,
    por_pack: false,
    nombre_origen: null,
    variantes: [],
    ...over,
  };
}

describe("bordes", () => {
  const emptyIdx = buildRubrosIndex([]);

  it("producto oculto → no chunkeable", () => {
    expect(esChunkeable(prodBase({ oculto: true }))).toBe(false);
    expect(esChunkeable(prodBase())).toBe(true);
  });

  it("variantes ocultas quedan FUERA del texto (Opciones)", () => {
    const p = prodBase({
      variantes: [
        { variante_id: "v1", nombre_vivo: "A3", display_variante: null, variante: "A3", color: null, unidad: "Hoja", precio_lista: 800, oculto: false, mostrable: true, solo_descuentos: false, tiene_override: false, n_reglas_cantidad: 0 },
        { variante_id: "v2", nombre_vivo: "SECRETA", display_variante: null, variante: "SECRETA", color: null, unidad: "Hoja", precio_lista: 999, oculto: true, mostrable: true, solo_descuentos: false, tiene_override: false, n_reglas_cantidad: 0 },
      ],
    });
    const c = chunkRAG(p, emptyIdx);
    expect(c.texto).toContain("Opciones: [v1] A3.");
    expect(c.texto).not.toContain("SECRETA");
    expect(c.meta.precios).toHaveLength(1); // la oculta no genera precio
  });

  it("sin variantes limpias (override / reglas) → precio no confiable, rango null", () => {
    const p = prodBase({
      variantes: [
        { variante_id: "v1", nombre_vivo: "conOverride", display_variante: null, variante: "conOverride", color: null, unidad: null, precio_lista: 500, oculto: false, mostrable: true, solo_descuentos: false, tiene_override: true, n_reglas_cantidad: 0 },
        { variante_id: "v2", nombre_vivo: "conRegla", display_variante: null, variante: "conRegla", color: null, unidad: null, precio_lista: 700, oculto: false, mostrable: true, solo_descuentos: false, tiene_override: false, n_reglas_cantidad: 2 },
      ],
    });
    const c = chunkRAG(p, emptyIdx);
    expect(c.meta.precio_confiable).toBe(false);
    expect(c.meta.precio_desde).toBeNull();
    expect(c.meta.precio_hasta).toBeNull();
  });

  it("producto sin nicho → meta.nicho null", () => {
    expect(chunkRAG(prodBase(), emptyIdx).meta.nicho).toBeNull();
  });
});
