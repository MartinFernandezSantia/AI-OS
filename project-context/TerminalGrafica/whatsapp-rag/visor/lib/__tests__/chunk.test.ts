import { describe, expect, it } from "vitest";
import { avisos, chunks, escalaTexto, lineaPrecio, rindeEfectivo } from "../chunk";
import { escalaDe, type Datos } from "../parse";

/** Fixture chico armado a mano: dos colecciones, tres materiales, los dos modos.
 *  Mundo nuevo: los productos pliego NO cargan rinde — sale calculado de la geometría
 *  del material (área útil + separación en su primera fila). */
const datos: Datos = {
  colecciones: [
    {
      "Colección": "Stickers con forma",
      "Descripción": "Stickers cortados con forma, para interior.",
      "Material base": "Papel autoadhesivo",
    },
    // Un solo material: la base es opcional, y el chunk no la anuncia aunque esté.
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
      // sin rinde cargado: se calcula (104 con 28x44 y sep 0,3)
    },
    {
      "Colección": "Stickers con forma",
      Producto: "Stickers en OPP 5x5 cm",
      Material: "OPP brillo",
      "Ancho (cm)": "5",
      "Alto (cm)": "5",
      // se calcula: 40
    },
    {
      "Colección": "Banners y lonas",
      Producto: "Banner de lona 1x1 m",
      Material: "Lona",
      "Ancho (cm)": "100",
      "Alto (cm)": "100",
      // sin rinde ni geometría: es modo m2
    },
  ],
  materiales: [
    {
      Material: "Papel autoadhesivo",
      Unidad: "pliego A3",
      Desde: "1",
      Hasta: "1",
      "Precio por unidad": "2500",
      "Área útil ancho (cm)": "28",
      "Área útil alto (cm)": "44",
      "Separación (cm)": "0,3",
    },
    { Material: "Papel autoadhesivo", Unidad: "pliego A3", Desde: "2", Hasta: "10", "Precio por unidad": "2200" },
    { Material: "Papel autoadhesivo", Unidad: "pliego A3", Desde: "11", "Precio por unidad": "2000" },
    {
      Material: "OPP brillo",
      Unidad: "pliego A3",
      Desde: "1",
      Hasta: "9",
      "Precio por unidad": "2800",
      "Área útil ancho (cm)": "28",
      "Área útil alto (cm)": "44",
      "Separación (cm)": "0,3",
    },
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

  it("el chunk pliego trae el rinde CALCULADO de cada medida, con la unidad del material", () => {
    expect(cs[0].texto).toContain("entran 104 por pliego A3");
    expect(cs[1].texto).toContain("entran 40 por pliego A3");
  });

  it("el chunk pliego habilita la medida libre y publica la geometría", () => {
    expect(cs[0].texto).toContain("Se cotiza CUALQUIER medida en cm");
    expect(cs[0].texto).toContain("Área útil del pliego A3: 28x44 cm · separación entre piezas: 0,3 cm.");
  });

  it("el encabezado de la lista dice 'Medidas de referencia', no 'disponibles'", () => {
    expect(cs[0].texto).toContain("Medidas de referencia:");
    expect(cs[0].texto).not.toContain("Medidas disponibles");
  });

  it("el chunk m2 habilita cualquier medida con su conversión", () => {
    expect(cs.at(-1)!.texto).toContain("Se cotiza cualquier medida (m2 = ancho x alto en cm ÷ 10.000).");
  });

  it("con separación 0, la línea dice 'sin separación entre piezas'", () => {
    const sinSep: Datos = {
      ...datos,
      materiales: datos.materiales.map((m) =>
        m["Separación (cm)"] ? { ...m, "Separación (cm)": "0" } : m,
      ),
    };
    expect(chunks(sinSep, "coleccion-material")[0].texto).toContain("sin separación entre piezas.");
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
      geometria: { util_ancho: 28, util_alto: 44, separacion: 0.3 },
    });
  });

  it("el chunk m2 no lleva geometría en la meta", () => {
    expect(cs.at(-1)!.meta).not.toHaveProperty("geometria");
  });

  it("la meta lleva la escala completa: es lo que el auditor re-calcula", () => {
    expect(cs[0].meta.escala).toEqual([
      { desde: 1, hasta: 1, precio: 2500 },
      { desde: 2, hasta: 10, precio: 2200 },
      { desde: 11, hasta: null, precio: 2000 },
    ]);
  });

  it("el mínimo facturable viaja en la escala del material m2", () => {
    expect(cs.at(-1)!.meta.escala).toEqual([
      { desde: 1, hasta: null, precio: 16000, minimo_facturable: 0.5 },
    ]);
  });

  it("el material base se anuncia en su chunk y se marca en la meta", () => {
    expect(cs[0].texto).toContain("Es la opción BASE de la colección");
    expect(cs[0].meta.es_base).toBe(true);
  });

  it("el material NO base de la misma colección no se anuncia", () => {
    expect(cs[1].texto).not.toContain("BASE");
    expect(cs[1].meta.es_base).toBe(false);
  });

  it("con un solo material no se anuncia base: no hay nada que elegir", () => {
    const conBase = {
      ...datos,
      colecciones: [
        datos.colecciones[0],
        { ...datos.colecciones[1], "Material base": "Lona" },
      ],
    };
    const lona = chunks(conBase, "coleccion-material").at(-1)!;
    expect(lona.texto).not.toContain("BASE");
    expect(lona.meta.es_base).toBe(false);
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

describe("el rinde: columna cargada vs geometría", () => {
  it("la columna no se filtra al chunk como columna desconocida", () => {
    const conColumna: Datos = {
      ...datos,
      productos: [{ ...datos.productos[0], "Piezas por unidad de cobro": "104" }],
    };
    // Si no estuviera en CONOCIDAS, saldría como "Piezas por unidad de cobro: 104".
    expect(chunks(conColumna, "coleccion-material")[0].texto).not.toContain(
      "Piezas por unidad de cobro:",
    );
  });

  it("el alias viejo 'Piezas por pliego' YA NO se acepta: sale como columna desconocida", () => {
    const conAlias: Datos = {
      ...datos,
      productos: [{ ...datos.productos[0], "Piezas por pliego": "104" }],
    };
    expect(chunks(conAlias, "coleccion-material")[0].texto).toContain("Piezas por pliego: 104");
  });

  it("la columna cargada GANA sobre el cálculo (dato del taller)", () => {
    const p = { ...datos.productos[0], "Piezas por unidad de cobro": "99" };
    expect(rindeEfectivo(p, { utilAncho: 28, utilAlto: 44, separacion: 0.3 })).toBe(99);
    const conColumna: Datos = { ...datos, productos: [p, datos.productos[1]] };
    expect(chunks(conColumna, "coleccion-material")[0].texto).toContain("entran 99 por pliego A3");
  });

  it("sin columna ni geometría no hay rinde (null) y el ítem no dice 'entran'", () => {
    const sinGeo: Datos = {
      ...datos,
      materiales: datos.materiales.map(
        ({ "Área útil ancho (cm)": _a, "Área útil alto (cm)": _h, "Separación (cm)": _s, ...m }) => m,
      ),
    };
    expect(rindeEfectivo(datos.productos[0], null)).toBeNull();
    expect(chunks(sinGeo, "coleccion-material")[0].texto).not.toContain("entran");
  });

  it("el rinde cargado sirve para cualquier unidad, no solo pliego", () => {
    const bobina: Datos = {
      colecciones: [{ "Colección": "Cintas", "Descripción": "Cintas impresas." }],
      productos: [
        {
          "Colección": "Cintas",
          Producto: "Cinta 2 cm",
          Material: "Bobina 50 m",
          "Piezas por unidad de cobro": "200",
        },
      ],
      materiales: [
        { Material: "Bobina 50 m", Unidad: "bobina", Desde: "1", "Precio por unidad": "45000" },
      ],
      parametros: [],
      hojas: [],
    };
    const t = chunks(bobina, "coleccion-material")[0].texto;
    expect(t).toContain("entran 200 por bobina");
    expect(t).not.toContain("pliego");
    // Una unidad "otro" no tiene fórmula de medida libre: sin línea habilitante.
    expect(t).not.toContain("Se cotiza");
  });
});

describe("avisos — lo que el chunk no puede mostrar", () => {
  it("con el fixture sano no hay avisos", () => {
    expect(avisos(datos)).toEqual([]);
  });

  it("producto pliego sin geometría ni rinde cargado: el bot no va a poder cotizar", () => {
    const sinGeo: Datos = {
      ...datos,
      materiales: datos.materiales.map(
        ({ "Área útil ancho (cm)": _a, "Área útil alto (cm)": _h, "Separación (cm)": _s, ...m }) => m,
      ),
    };
    const a = avisos(sinGeo);
    expect(a).toHaveLength(2); // los dos productos pliego del fixture
    expect(a[0]).toContain("Stickers 3x3 cm");
    expect(a[0]).toContain("no va a poder cotizarlo");
  });

  it("columna cargada y geometría que no coinciden: drift, gana el dato cargado", () => {
    const conDrift: Datos = {
      ...datos,
      productos: [{ ...datos.productos[0], "Piezas por unidad de cobro": "99" }],
    };
    const a = avisos(conDrift);
    expect(a).toHaveLength(1);
    expect(a[0]).toContain("la columna dice 99");
    expect(a[0]).toContain("calcula 104");
  });

  it("colección con varios materiales y sin base marcada: hay que elegir una", () => {
    const sinBase: Datos = {
      ...datos,
      colecciones: datos.colecciones.map(({ "Material base": _b, ...c }) => c),
    };
    const a = avisos(sinBase);
    expect(a).toHaveLength(1); // solo la de 2 materiales; la de Lona no lo necesita
    expect(a[0]).toContain("Stickers con forma");
    expect(a[0]).toContain("Material base");
  });

  it("base que apunta a un material que la colección no usa", () => {
    const mala: Datos = {
      ...datos,
      colecciones: [{ ...datos.colecciones[0], "Material base": "Vinilo UV" }, datos.colecciones[1]],
    };
    const a = avisos(mala);
    expect(a).toHaveLength(1);
    expect(a[0]).toContain("ningún producto de la colección lo usa");
  });

  it("pieza que no entra en el área útil: rinde 0, derivar a consulta", () => {
    const gigante: Datos = {
      ...datos,
      productos: [
        {
          "Colección": "Stickers con forma",
          Producto: "Sticker 30x45 cm",
          Material: "Papel autoadhesivo",
          "Ancho (cm)": "30",
          "Alto (cm)": "45",
        },
      ],
    };
    const a = avisos(gigante);
    expect(a).toHaveLength(1);
    expect(a[0]).toContain("no entra en el área útil");
    // Y el chunk no dice "entran 0": el ítem sale sin rinde.
    expect(chunks(gigante, "coleccion-material")[0].texto).not.toContain("entran 0");
  });

  it("los productos m2 no generan avisos aunque no tengan rinde", () => {
    expect(avisos({ ...datos, productos: [datos.productos[2]] })).toEqual([]);
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
