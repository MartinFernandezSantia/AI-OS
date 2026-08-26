import { describe, expect, it } from "vitest";
import { chunks, escalaTexto, lineaPrecio } from "../chunk";
import { escalaDe, type Datos } from "../parse";

/** Fixture chico armado a mano: dos colecciones, tres materiales, los dos modos. */
const datos: Datos = {
  colecciones: [
    { "Colección": "Stickers con forma", "Descripción": "Stickers cortados con forma, para interior." },
    { "Colección": "Banners y lonas", "Descripción": "Lona impresa full color con ojalillos." },
  ],
  productos: [
    {
      "Colección": "Stickers con forma",
      Producto: "Stickers 3x3 cm",
      "Descripción": "Los más chicos.",
      Material: "Papel autoadhesivo",
      "Ancho (cm)": "3",
      "Alto (cm)": "3",
      "Piezas por pliego": "104",
    },
    {
      "Colección": "Stickers con forma",
      Producto: "Stickers en OPP 5x5 cm",
      Material: "OPP brillo",
      "Ancho (cm)": "5",
      "Alto (cm)": "5",
      "Piezas por pliego": "40",
    },
    {
      "Colección": "Banners y lonas",
      Producto: "Banner de lona 1x1 m",
      Material: "Lona",
      "Ancho (cm)": "100",
      "Alto (cm)": "100",
      // sin "Piezas por pliego": es modo m2
    },
  ],
  materiales: [
    { Material: "Papel autoadhesivo", Unidad: "pliego A3", Desde: "1", Hasta: "1", "Precio por unidad": "2500" },
    { Material: "Papel autoadhesivo", Unidad: "pliego A3", Desde: "2", Hasta: "10", "Precio por unidad": "2200" },
    { Material: "Papel autoadhesivo", Unidad: "pliego A3", Desde: "11", "Precio por unidad": "2000" },
    { Material: "OPP brillo", Unidad: "pliego A3", Desde: "1", Hasta: "9", "Precio por unidad": "2800" },
    { Material: "Lona", Unidad: "m2", Desde: "1", "Precio por unidad": "16000", "Mínimo facturable": "0.5" },
  ],
  parametros: [],
  hojas: [],
};

describe("escalaTexto", () => {
  it("un solo tramo (tarifa plana) muestra el monto sin rango", () => {
    expect(escalaTexto(escalaDe(datos.materiales, "Lona"))).toBe("$16.000");
  });

  it("tramo de un solo valor se escribe sin 'a'", () => {
    expect(escalaTexto(escalaDe(datos.materiales, "Papel autoadhesivo"))).toContain("1: $2.500");
  });

  it("el tramo abierto se escribe 'N o más'", () => {
    expect(escalaTexto(escalaDe(datos.materiales, "Papel autoadhesivo"))).toContain("11 o más: $2.000");
  });
});

describe("lineaPrecio — la unidad se imprime tal cual viene del Excel", () => {
  it("pliego usa la unidad del material y no menciona m2", () => {
    const l = lineaPrecio("Papel autoadhesivo", escalaDe(datos.materiales, "Papel autoadhesivo"));
    expect(l).toContain("Precio por pliego A3");
    expect(l).not.toContain("m2");
  });

  it("m2 lleva el mínimo facturable y no menciona pliego", () => {
    const l = lineaPrecio("Lona", escalaDe(datos.materiales, "Lona"));
    expect(l).toContain("Precio por m2");
    expect(l).toContain("Mínimo facturable 0,5 m2");
    expect(l).not.toContain("pliego");
  });

  it("el tamaño del pliego sale del dato: cambiarlo a A4 cambia el texto", () => {
    const a4 = escalaDe(
      [{ Material: "Papel A4", Unidad: "pliego A4", Desde: "1", "Precio por unidad": "900" }],
      "Papel A4",
    );
    const l = lineaPrecio("Papel A4", a4);
    expect(l).toContain("Precio por pliego A4");
    expect(l).not.toContain("A3"); // ← el literal viejo lo habría forzado a A3
  });

  it("una unidad inventada por el cliente se respeta igual", () => {
    const plancha = escalaDe(
      [{ Material: "Plancha", Unidad: "plancha 30x40", Desde: "1", "Precio por unidad": "5000" }],
      "Plancha",
    );
    expect(lineaPrecio("Plancha", plancha)).toContain("Precio por plancha 30x40");
  });

  it("material sin escala no genera línea", () => {
    expect(lineaPrecio("Cartón", [])).toBe("");
  });
});

describe("chunks — coleccion-material", () => {
  const cs = chunks(datos, "coleccion-material");

  it("parte la colección con 2 materiales en 2 chunks, y deja la de 1 en uno", () => {
    expect(cs).toHaveLength(3);
  });

  it("cada chunk lleva UNA sola línea de precio (la razón de ser de esta estrategia)", () => {
    for (const c of cs) {
      expect(c.texto.match(/^Precio por /gm) ?? []).toHaveLength(1);
    }
  });

  it("con varios materiales, el título lleva el sufijo del material", () => {
    expect(cs[0].titulo).toBe("Stickers con forma — Papel autoadhesivo");
  });

  it("con un solo material, el título es la colección sola", () => {
    expect(cs.at(-1)!.titulo).toBe("Banners y lonas");
  });

  it("repite la descripción de la colección en cada chunk que la parte", () => {
    expect(cs[0].texto).toContain("Stickers cortados con forma");
    expect(cs[1].texto).toContain("Stickers cortados con forma");
  });

  it("el chunk m2 no menciona pliegos por ningún lado", () => {
    expect(cs.at(-1)!.texto).not.toContain("pliego");
  });

  it("el chunk pliego trae el rinde de cada medida, con la unidad del material", () => {
    expect(cs[0].texto).toContain("entran 104 por pliego A3");
  });

  it("el rinde también sigue al dato: con 'pliego A4' el texto dice A4", () => {
    const a4: Datos = {
      ...datos,
      materiales: datos.materiales.map((m) =>
        m["Unidad"] === "pliego A3" ? { ...m, Unidad: "pliego A4" } : m,
      ),
    };
    const t = chunks(a4, "coleccion-material")[0].texto;
    expect(t).toContain("entran 104 por pliego A4");
    expect(t).toContain("Precio por pliego A4");
    expect(t).not.toContain("A3");
  });

  it("la meta lleva lo que la Fase 2 va a escribir en metadata", () => {
    expect(cs[0].meta).toMatchObject({
      coleccion: "Stickers con forma",
      material: "Papel autoadhesivo",
      unidad: "pliego A3",
      modo: "pliego",
      productos: 1,
    });
  });
});

describe("chunks — coleccion", () => {
  const cs = chunks(datos, "coleccion");

  it("un chunk por colección", () => expect(cs).toHaveLength(2));

  it("la colección con 2 materiales arrastra 2 líneas de precio (la ambigüedad a mostrar)", () => {
    expect(cs[0].texto.match(/^Precio por /gm) ?? []).toHaveLength(2);
  });
});

describe("chunks — producto", () => {
  const cs = chunks(datos, "producto");

  it("un chunk por producto", () => expect(cs).toHaveLength(3));

  it("cada uno se lleva la escala completa de su material", () => {
    expect(cs[0].texto).toContain("11 o más: $2.000");
  });

  it("nombra la colección a la que pertenece", () => {
    expect(cs[0].texto).toContain("Colección: Stickers con forma.");
  });
});

describe("columnas nuevas del cliente", () => {
  it("una columna desconocida aparece SOLO en el producto que la tiene", () => {
    const conGramaje: Datos = {
      ...datos,
      productos: [{ ...datos.productos[0], Gramaje: "300 g" }, datos.productos[1]],
    };
    const cs = chunks(conGramaje, "coleccion-material");
    expect(cs[0].texto).toContain("Gramaje: 300 g");
    expect(cs[1].texto).not.toContain("Gramaje");
  });
});

describe("bordes", () => {
  it("una colección declarada sin productos no genera chunk", () => {
    const cs = chunks({ ...datos, productos: [] }, "coleccion-material");
    expect(cs).toHaveLength(0);
  });

  it("un producto de una colección no declarada igual entra", () => {
    const huerfano: Datos = {
      ...datos,
      colecciones: [],
      productos: [datos.productos[2]],
    };
    const cs = chunks(huerfano, "coleccion-material");
    expect(cs).toHaveLength(1);
    expect(cs[0].titulo).toBe("Banners y lonas");
  });
});
