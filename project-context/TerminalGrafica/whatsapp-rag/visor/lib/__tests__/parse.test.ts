import { describe, expect, it } from "vitest";
import { escalaDe, num, objetos, unidadDe, type Fila } from "../parse";

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
    { Material: "Papel", Unidad: "pliego", Desde: "11", Hasta: "50", "Precio por unidad": "2000" },
    { Material: "Papel", Unidad: "pliego", Desde: "1", Hasta: "1", "Precio por unidad": "2500" },
    { Material: "Papel", Unidad: "pliego", Desde: "101", "Precio por unidad": "1710" },
    { Material: "Papel", Unidad: "pliego", Desde: "2", Hasta: "10", "Precio por unidad": "2200" },
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

  it("unidadDe deriva el modo de cálculo", () => {
    expect(unidadDe(materiales, "Papel")).toBe("pliego");
    expect(unidadDe(materiales, "Lona")).toBe("m2");
  });
});
