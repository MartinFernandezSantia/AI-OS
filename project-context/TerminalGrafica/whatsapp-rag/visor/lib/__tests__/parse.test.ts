import { describe, expect, it } from "vitest";
import { escalaDe, geometriaDe, modoDe, num, objetos, unidadDe, type Fila } from "../parse";

describe("objetos — headers dinámicos", () => {
  it("descarta las columnas sin dato: un producto m2 no genera 'Piezas por pliego'", () => {
    const rows = [
      ["Producto", "Material", "Piezas por pliego"],
      ["Sticker 3x3", "Papel", "104"],
      ["Banner 1x1", "Lona", ""], // ← celda vacía
    ];
    const [sticker, banner] = objetos(rows);
    expect(sticker["Piezas por pliego"]).toBe("104");
    expect("Piezas por pliego" in banner).toBe(false);
  });

  it("toma columnas que no conoce (el cliente agregó 'Gramaje')", () => {
    const rows = [
      ["Producto", "Gramaje"],
      ["Sticker", "300 g"],
    ];
    expect(objetos(rows)[0]["Gramaje"]).toBe("300 g");
  });

  it("saltea filas totalmente vacías", () => {
    const rows = [["Producto"], ["Sticker"], ["", ""], ["  "]];
    expect(objetos(rows)).toHaveLength(1);
  });

  it("recorta espacios en headers y valores", () => {
    const rows = [["  Producto  "], ["  Sticker  "]];
    expect(objetos(rows)[0]["Producto"]).toBe("Sticker");
  });

  it("devuelve vacío si no hay filas", () => {
    expect(objetos([])).toEqual([]);
  });
});

describe("num", () => {
  it("lee decimales con punto", () => expect(num("0.5")).toBe(0.5));
  it("lee decimales con coma", () => expect(num("0,5")).toBe(0.5));
  it("lee miles con punto y decimal con coma", () => expect(num("1.234,5")).toBe(1234.5));
  it("devuelve null si está vacío", () => expect(num("")).toBeNull());
  it("devuelve null si no es número", () => expect(num("ninguno")).toBeNull());
});

describe("escalaDe", () => {
  const materiales: Fila[] = [
    // A propósito desordenados: el orden lo garantiza el código, no el Excel.
    { Material: "Papel", Unidad: "pliego A3", Desde: "11", Hasta: "50", "Precio por unidad": "2000" },
    { Material: "Papel", Unidad: "pliego A3", Desde: "1", Hasta: "1", "Precio por unidad": "2500" },
    { Material: "Papel", Unidad: "pliego A3", Desde: "101", "Precio por unidad": "1710" },
    { Material: "Papel", Unidad: "pliego A3", Desde: "2", Hasta: "10", "Precio por unidad": "2200" },
    { Material: "Lona", Unidad: "m2", Desde: "1", "Precio por unidad": "16000", "Mínimo facturable": "0.5" },
  ];

  it("ordena los tramos por Desde aunque la hoja los traiga mezclados", () => {
    expect(escalaDe(materiales, "Papel").map((t) => t.desde)).toEqual([1, 2, 11, 101]);
  });

  it("un tramo sin Hasta queda abierto (null = sin tope)", () => {
    const ultimo = escalaDe(materiales, "Papel").at(-1)!;
    expect(ultimo.hasta).toBeNull();
    expect(ultimo.precio).toBe(1710);
  });

  it("lee el mínimo facturable en modo m2", () => {
    expect(escalaDe(materiales, "Lona")[0].minimo).toBe(0.5);
  });

  it("no inventa mínimo en modo pliego", () => {
    expect(escalaDe(materiales, "Papel")[0].minimo).toBeNull();
  });

  it("un material inexistente da escala vacía", () => {
    expect(escalaDe(materiales, "Cartón")).toEqual([]);
  });

  it("unidadDe devuelve la unidad tal cual la escribió el cliente", () => {
    expect(unidadDe(materiales, "Papel")).toBe("pliego A3");
    expect(unidadDe(materiales, "Lona")).toBe("m2");
  });
});

describe("geometriaDe — la geometría vive en la primera fila del material", () => {
  const materiales: Fila[] = [
    // Solo la primera fila del material lleva la geometría (como la unidad).
    {
      Material: "Papel troquelado",
      Unidad: "pliego A3",
      Desde: "1",
      "Precio por unidad": "2500",
      "Área útil ancho (cm)": "28",
      "Área útil alto (cm)": "44",
      "Separación (cm)": "0,3",
    },
    { Material: "Papel troquelado", Unidad: "pliego A3", Desde: "2", "Precio por unidad": "2200" },
    {
      Material: "Papel solo impresión",
      Unidad: "pliego A3",
      Desde: "1",
      "Precio por unidad": "1800",
      "Área útil ancho (cm)": "31",
      "Área útil alto (cm)": "46",
      // sin "Separación (cm)": vale 0
    },
    { Material: "Lona", Unidad: "m2", Desde: "1", "Precio por unidad": "16000" },
  ];

  it("lee área útil y separación, con coma decimal", () => {
    expect(geometriaDe(materiales, "Papel troquelado")).toEqual({
      utilAncho: 28,
      utilAlto: 44,
      separacion: 0.3,
    });
  });

  it("separación ausente vale 0 (solo impresión)", () => {
    expect(geometriaDe(materiales, "Papel solo impresión")).toEqual({
      utilAncho: 31,
      utilAlto: 46,
      separacion: 0,
    });
  });

  it("un material sin geometría (m2) da null", () => {
    expect(geometriaDe(materiales, "Lona")).toBeNull();
  });

  it("un material inexistente da null", () => {
    expect(geometriaDe(materiales, "Cartón")).toBeNull();
  });

  it("con un solo lado del área útil no hay geometría (null, no un dato a medias)", () => {
    const aMedias: Fila[] = [
      { Material: "Papel", Unidad: "pliego A3", Desde: "1", "Área útil ancho (cm)": "28" },
    ];
    expect(geometriaDe(aMedias, "Papel")).toBeNull();
  });
});

describe("modoDe — la rama de cálculo se deriva por prefijo", () => {
  it("cualquier pliego es modo pliego, sin importar el tamaño", () => {
    expect(modoDe("pliego")).toBe("pliego");
    expect(modoDe("pliego A3")).toBe("pliego");
    // El caso que motivó el cambio: con igualdad estricta, un A4 nuevo caía en silencio a m2.
    expect(modoDe("pliego A4")).toBe("pliego");
  });

  it("reconoce m2 y m²", () => {
    expect(modoDe("m2")).toBe("m2");
    expect(modoDe("m²")).toBe("m2");
  });

  it("ignora mayúsculas y espacios", () => {
    expect(modoDe("  Pliego A3  ")).toBe("pliego");
  });

  it("reconoce las unidades que se cobran de a ítem", () => {
    // Lo que no se cotiza por superficie: un anillado, un sobre, una hoja suelta, o un
    // paquete cerrado ("paquete de 100" → pedir 1 son 100 tarjetas).
    expect(modoDe("unidad")).toBe("item");
    expect(modoDe("hoja")).toBe("item");
    expect(modoDe("paquete de 100")).toBe("item");
    expect(modoDe("pack")).toBe("item");
    // El metro LINEAL también: el escaneo de planos se cobra 3 metros × $8.000, que es
    // cantidad × precio. El nombre suena a medida, pero el cliente pide una cantidad.
    expect(modoDe("metro lineal")).toBe("item");
  });

  it("una unidad desconocida no se hace pasar por ninguno de los modos", () => {
    // `otro` sigue siendo el cajón de errores, NO el default de item: si lo fuera, una
    // unidad mal escrita cotizaría de a ítem en silencio en vez de fallar.
    expect(modoDe("plancha 30x40")).toBe("otro");
    expect(modoDe("bobina")).toBe("otro");
    expect(modoDe("")).toBe("otro");
  });

  // LA TRAMPA documentada en Instrucciones: el prefijo agarra de más y de menos.
  it("'m2 con laminado' y 'pliego doble' caen en su modo aunque se cobren distinto", () => {
    expect(modoDe("m2 con laminado")).toBe("m2");
    expect(modoDe("pliego doble")).toBe("pliego");
  });

  it("'metro cuadrado' NO es 'm2': queda huérfano, sin fórmula", () => {
    // Y desde que existe "metro lineal" este test cuida algo más: si la lista dijera
    // "metro" a secas, "metro cuadrado" caería en `item` y cobraría cantidad × precio un
    // material que se cotiza por superficie. Salió plausible y sin error — lo atajó este
    // test cuando el prefijo se escribió corto.
    expect(modoDe("metro cuadrado")).toBe("otro");
  });
});
