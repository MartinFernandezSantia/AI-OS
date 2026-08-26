// Encaje de una pieza en el área útil de la unidad de cobro (pliego, plancha…).
// Función PURA — es la misma cuenta que el bot hace en runtime para medidas libres;
// acá se usa para calcular el rinde de las medidas de referencia y validar drift.
//
// La regla (documentada en la hoja Instrucciones del Excel, que es la fuente):
// columnas × filas que entran, floor((útil+sep)/(pieza+sep)) por eje, probando las DOS
// orientaciones y tomando la que rinde más. La separación se suma al área y a la pieza
// antes de dividir (una grilla de N piezas tiene N-1 separaciones por eje).

/** Geometría de la unidad de cobro de un material. Sale de la hoja Materiales. */
export interface Geometria {
  /** Área útil, en cm (ej. 28x44 troquelado, 31x46 solo impresión). */
  utilAncho: number;
  utilAlto: number;
  /** Separación entre piezas en cm (0,3 en troquelado; 0 en solo impresión). */
  separacion: number;
}

/** Piezas que entran en un eje. El epsilon absorbe el error binario de los decimales
 *  (28.3/2.83 debe dar 10, no floor(9.999…)). */
const porEje = (util: number, pieza: number, sep: number): number =>
  Math.floor((util + sep) / (pieza + sep) + 1e-9);

/**
 * Cuántas piezas de `ancho`x`alto` cm entran en el área útil. 0 = no entra ninguna
 * (pieza más grande que el área en ambas orientaciones) — nunca negativo.
 */
export function rinde(ancho: number, alto: number, g: Geometria): number {
  if (ancho <= 0 || alto <= 0 || g.utilAncho <= 0 || g.utilAlto <= 0) return 0;
  const derecha = porEje(g.utilAncho, ancho, g.separacion) * porEje(g.utilAlto, alto, g.separacion);
  const rotada = porEje(g.utilAncho, alto, g.separacion) * porEje(g.utilAlto, ancho, g.separacion);
  return Math.max(derecha, rotada, 0);
}
