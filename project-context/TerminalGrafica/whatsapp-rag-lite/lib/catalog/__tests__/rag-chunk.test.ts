// Prueba que el chunk RAG deriva bien del export v4 (modelo producto-bot) + bordes.
// Fixture sintético representativo (el export real lo genera Martin tras la migración).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseExportV4 } from "../loader";
import { chunkRAG, chunksDeExport, esChunkeable } from "../rag-chunk";
import type { CatalogExportV4, ProductoBot } from "../types";

const raw = readFileSync(join(__dirname, "fixtures", "export-v4.json"), "utf8");
const data: CatalogExportV4 = parseExportV4(raw).data;
const byId = (id: string) => data.productos.find((p) => p.producto_id === id)!;

describe("chunksDeExport (v4)", () => {
  it("excluye los productos-bot ocultos", () => {
    const ocultos = data.productos.filter((p) => p.oculto).length;
    const chunks = chunksDeExport(data.productos);
    expect(chunks.length).toBe(data.productos.length - ocultos);
    expect(chunks.length).toBe(5); // 6 - 1 oculto
  });
});

describe("item sin precio real (bv-null en el export) degrada a mail", () => {
  it("aparece en Opciones sin monto y no cobrable, no rompe", () => {
    const c = chunkRAG(data.productos.find((p) => p.producto_id === "servicio a confirmar|otro")!);
    expect(c.texto).toContain("Opciones: [v1] Único.");
    expect(c.meta.precios[0].cobrable).toBe(false);
    expect(c.meta.precio_confiable).toBe(false);
  });
});

describe("chunkRAG sobre producto-bot de nicho (inmobiliarias)", () => {
  const p = byId("promocion para inmobiliarias|carteleria en plastico corrugado");
  const c = chunkRAG(p);

  it("captura el nicho (heredado en la migración) como metadata", () => {
    expect(c.meta.nicho).toBe("inmobiliarias");
  });
  it("la familia va a metadata (no al texto, es genérica)", () => {
    expect(c.meta.familia).toBe("carteleria");
    expect(c.texto).not.toContain("carteleria");
  });
  it("el título y el nombre_canonico son el nombre_bot", () => {
    expect(c.title).toContain("Promoción para inmobiliarias");
    expect(c.meta.nombre_canonico).toBe(c.title);
  });
  it("el texto incluye sinónimos, casos de uso y material", () => {
    expect(c.texto).toContain("También llamado:");
    expect(c.texto).toContain("cartel inmobiliario");
    expect(c.texto).toContain("Sirve para:");
    expect(c.texto).toContain("vender propiedad");
    expect(c.texto.toLowerCase()).toContain("material: plastico corrugado");
  });
  it("precio confiable: item simple sin reglas → rango poblado", () => {
    expect(c.meta.precio_confiable).toBe(true);
    expect(c.meta.precio_desde).toBe(15000);
    expect(c.meta.precio_hasta).toBe(15000);
  });
  it("meta.precios: ref [vN] bien formado y con variante_id", () => {
    expect(c.meta.precios.length).toBe(1);
    c.meta.precios.forEach((pv, i) => expect(pv.ref).toBe(`v${i + 1}`));
    expect(c.meta.precios[0].variante_id).toBe("v-inmo-1");
    expect(c.texto).toContain("Opciones: [v1]");
  });
});

describe("cobro POR ITEM en un producto-bot multi-producto (Plastificados)", () => {
  // El caso que la verificación de Fable marcó crítico: un grupo mezcla items con formas de cobro
  // distintas. A4 se cobra por unidad, Carnet por pack → cada item deriva su propia unidad.
  const p = byId("plastificados-5e3140");
  const c = chunkRAG(p);

  it("A4 se muestra 'por unidad' y Carnet 'el pack', en el mismo chunk", () => {
    expect(c.texto).toContain("[v1] A4 ($800 por unidad)");
    expect(c.texto).toContain("[v2] Carnet 9x13 cm ($500 el pack)");
  });
  it("cada precio conserva su forma de cobro (no se contamina entre items)", () => {
    const a4 = c.meta.precios.find((pv) => pv.variante === "A4")!;
    const carnet = c.meta.precios.find((pv) => pv.variante.startsWith("Carnet"))!;
    expect(a4.unidad).toBe("por unidad");
    expect(carnet.unidad).toBe("el pack");
  });
});

describe("chunkRAG: escalera + familia_nota", () => {
  it("los tramos se muestran en Opciones (obra 106)", () => {
    const c = chunkRAG(byId("impresion laser color papel obra 106 gr|impresiones laser color"));
    expect(c.texto).toContain("por hoja: 1-99 $200, 100+ $150");
  });
  it("hornea la nota de familia librería (Sobres)", () => {
    const c = chunkRAG(byId("sobres-95fa5f"));
    expect(c.texto).toContain("se venden sueltos");
  });
});

// ---- bordes sintéticos ----

function prodBase(over: Partial<ProductoBot> = {}): ProductoBot {
  return {
    producto_id: "p-test",
    clave: "p-test",
    nombre_bot: "Producto Test",
    familia: "otro",
    familia_nota: null,
    sinonimos: [],
    casos_de_uso: [],
    nicho: null,
    nota: null,
    peso: 1.0,
    oculto: false,
    items: [],
    ...over,
  };
}

describe("bordes (v4)", () => {
  it("producto-bot oculto → no chunkeable", () => {
    expect(esChunkeable(prodBase({ oculto: true }))).toBe(false);
    expect(esChunkeable(prodBase())).toBe(true);
  });

  it("producto-bot sin nicho → meta.nicho null; sin items → sin Opciones", () => {
    const c = chunkRAG(prodBase());
    expect(c.meta.nicho).toBeNull();
    expect(c.texto).not.toContain("Opciones:");
    expect(c.meta.precios).toHaveLength(0);
  });

  it("item con override → precio no confiable, rango null", () => {
    const c = chunkRAG(
      prodBase({
        items: [
          {
            variante_id: "v1",
            nombre_variante_bot: "conOverride",
            color: null,
            unidad: null,
            precio_lista: 500,
            por_pagina: false,
            por_pack: false,
            atributos: {},
            rangos_cantidad: null,
            mostrable: true,
            tiene_override: true,
            solo_descuentos: false,
            n_reglas_cantidad: 0,
          },
        ],
      }),
    );
    expect(c.meta.precio_confiable).toBe(false);
    expect(c.meta.precio_desde).toBeNull();
    expect(c.meta.precio_hasta).toBeNull();
  });
});
