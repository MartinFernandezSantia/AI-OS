import { describe, expect, it } from "vitest";
import { rinde, type Geometria } from "../geometria";

/** La geometría real del pliego A3 troquelado/medio corte (hoja Materiales). */
const TROQ: Geometria = { utilAncho: 28, utilAlto: 44, separacion: 0.3 };
/** Solo impresión: área útil más grande, sin separación. */
const IMPRESION: Geometria = { utilAncho: 31, utilAlto: 46, separacion: 0 };

describe("rinde — reproduce los 7 rindes históricos del catálogo (troquelado)", () => {
  // Estos números los cargó el cliente a mano y validan la fórmula entera.
  it.each([
    [3, 3, 104],
    [5, 5, 40],
    [9, 5, 24],
    [7, 7, 18],
    [10, 10, 8],
  ])("%dx%d → %d", (a, h, esperado) => {
    expect(rinde(a, h, TROQ)).toBe(esperado);
  });

  it("6x3 → 56: gana la orientación ROTADA (derecha daría menos)", () => {
    expect(rinde(6, 3, TROQ)).toBe(56);
  });

  it("14x10 → 6: el otro caso donde gana la rotación (derecha da 4)", () => {
    expect(rinde(14, 10, TROQ)).toBe(6);
  });

  it("12x8 → 10: el ejemplo trabajado de la hoja Instrucciones", () => {
    // Acostada: floor(28,3/12,3)=2 × floor(44,3/8,3)=5 = 10. Parada: 3×3 = 9.
    expect(rinde(12, 8, TROQ)).toBe(10);
  });
});

describe("rinde — sin separación (solo impresión)", () => {
  it("4x4 → 77 (7 columnas × 11 filas en 31x46)", () => {
    expect(rinde(4, 4, IMPRESION)).toBe(77);
  });

  it("3x3 → 150 (10 × 15)", () => {
    expect(rinde(3, 3, IMPRESION)).toBe(150);
  });
});

describe("rinde — bordes", () => {
  it("pieza que no entra en ninguna orientación → 0, nunca negativo", () => {
    expect(rinde(30, 45, TROQ)).toBe(0);
    expect(rinde(45, 30, TROQ)).toBe(0);
  });

  it("entra rotada aunque derecha no: 40x20 en 28x44", () => {
    // Derecha: floor(28,3/40,3)=0. Rotada: floor(28,3/20,3)=1 × floor(44,3/40,3)=1 = 1.
    expect(rinde(40, 20, TROQ)).toBe(1);
  });

  it("pieza exacta al borde del área útil → 1", () => {
    expect(rinde(31, 46, IMPRESION)).toBe(1);
  });

  it("la división exacta no pierde una pieza por error de coma flotante", () => {
    // 46/2 = 23 justo: floor debe dar 23, no 22 por un 22.999…
    expect(rinde(2, 2, IMPRESION)).toBe(15 * 23);
  });

  it("medidas o geometría inválidas → 0", () => {
    expect(rinde(0, 5, TROQ)).toBe(0);
    expect(rinde(5, -1, TROQ)).toBe(0);
    expect(rinde(5, 5, { utilAncho: 0, utilAlto: 44, separacion: 0 })).toBe(0);
  });
});
