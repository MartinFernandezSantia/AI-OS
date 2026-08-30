// Filas crudas del .xlsx → objetos con headers DINÁMICOS. Función pura, sin I/O.
//
// El requisito que manda acá: el cliente cura el Excel y puede agregar una columna cuando
// se le ocurra ("Gramaje", "Plazo de entrega"). Nada de shape fijo — el header ES el schema.
// Y al revés: una columna sin dato NO genera propiedad, así el chunk de vinilos nunca
// menciona "piezas por pliego". Eso es el "chunk disperso" del plan.

import type { Geometria } from "./geometria";

/** Una fila de cualquier hoja, ya normalizada. Solo lleva las columnas CON dato. */
export type Fila = Record<string, string>;

/** Un tramo de la escala de precio de un material. `hasta: null` = sin tope (∞). */
export interface Tramo {
  desde: number;
  hasta: number | null;
  precio: number;
  /** Mínimo facturable, solo en modo m2 (ej. 0.5 m2). null = no aplica. */
  minimo: number | null;
  /** Unidad de cobro del material: define el MODO de cálculo ('pliego' | 'm2'). */
  unidad: string;
}

/** Lo que el visor necesita del archivo, ya parseado. */
export interface Datos {
  colecciones: Fila[];
  productos: Fila[];
  materiales: Fila[];
  parametros: Fila[];
  /** Nombres de las hojas encontradas, para mostrar en la barra de stats. */
  hojas: string[];
}

/**
 * Convierte una matriz (fila 0 = headers) en objetos.
 * Solo entran las celdas con dato: `if (h && v)` es la regla entera del esquema dinámico.
 */
export function objetos(rows: string[][]): Fila[] {
  if (!rows.length) return [];
  const H = rows[0].map((h) => String(h ?? "").trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => String(c ?? "").trim()))
    .map((r) => {
      const o: Fila = {};
      H.forEach((h, i) => {
        const v = String(r[i] ?? "").trim();
        if (h && v) o[h] = v; // ← columna vacía no entra
      });
      return o;
    });
}

/** Número tolerante a coma decimal y separador de miles. '' / undefined → null. */
export function num(v: string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // "1.234,5" → "1234.5"; "0.5" queda igual (sin coma, el punto es decimal).
  const limpio = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/**
 * Escala de un material: sus tramos ordenados por `Desde`.
 * La hoja puede traerlos desordenados; el orden lo garantizamos acá, no el Excel.
 */
export function escalaDe(materiales: Fila[], material: string): Tramo[] {
  return materiales
    .filter((m) => m["Material"] === material)
    .map((m) => ({
      desde: num(m["Desde"]) ?? 1,
      hasta: num(m["Hasta"]),
      precio: num(m["Precio por unidad"]) ?? 0,
      minimo: num(m["Mínimo facturable"]),
      unidad: m["Unidad"] ?? "",
    }))
    .sort((a, b) => a.desde - b.desde);
}

/** Unidad de cobro TAL CUAL la escribió el cliente ("pliego A3", "m2", "plancha 30x40"…). */
export function unidadDe(materiales: Fila[], material: string): string {
  return materiales.find((m) => m["Material"] === material)?.["Unidad"] ?? "";
}

/**
 * Geometría de la unidad de cobro de un material: área útil + separación entre piezas.
 * Se carga UNA vez por material, en su primera fila (como la unidad) — repetirla por tramo
 * invitaría al drift. Sin ambas áreas útiles no hay geometría (null): los materiales m2
 * dejan las columnas vacías y el chunk disperso hace el resto.
 */
export function geometriaDe(materiales: Fila[], material: string): Geometria | null {
  const fila = materiales.find(
    (m) => m["Material"] === material && m["Área útil ancho (cm)"] && m["Área útil alto (cm)"],
  );
  if (!fila) return null;
  const utilAncho = num(fila["Área útil ancho (cm)"]);
  const utilAlto = num(fila["Área útil alto (cm)"]);
  if (utilAncho === null || utilAlto === null) return null;
  // Separación ausente = 0: "solo impresión" puede dejar la celda vacía o cargar 0 explícito.
  return { utilAncho, utilAlto, separacion: num(fila["Separación (cm)"]) ?? 0 };
}

/**
 * Modo de cálculo derivado de la unidad. Es lo que decide la rama del cálculo, mientras que
 * la unidad se muestra tal cual (el tamaño del pliego lo pone el cliente, no el código).
 *
 * Se matchea por PREFIJO: "pliego A3", "pliego A4" y "pliego" son todos modo pliego. Si se
 * comparara por igualdad, un "pliego A4" nuevo caería en silencio al modo m2 y cotizaría mal.
 */
export function modoDe(unidad: string): "pliego" | "m2" | "item" | "otro" {
  const u = unidad.trim().toLowerCase();
  if (u.startsWith("pliego")) return "pliego";
  if (u.startsWith("m2") || u.startsWith("m²")) return "m2";
  // Unidad de cobro = ítem: la cantidad pedida ES la cantidad de unidades, sin geometría
  // ni conversión. Cubre lo que se cobra de a uno (anillado, sobre, hoja) y lo que se
  // vende por paquete cerrado ("paquete de 100" → pedir 1 son 100 tarjetas).
  //
  // La lista es EXPLÍCITA a propósito: si el default fuera `item`, una unidad mal escrita
  // ("pliegos A3" en plural, "metro2") cotizaría como ítem en silencio en vez de fallar.
  // `otro` sigue siendo "no sé qué es esto" y el auditor lo rechaza.
  if (/^(unidad|hoja|paquete|pack|item|ítem)\b/.test(u)) return "item";
  return "otro";
}

/** Arma los Datos desde las hojas crudas. Hojas ausentes quedan como lista vacía. */
export function datosDeHojas(hojas: Record<string, string[][]>): Datos {
  const de = (nombre: string) => (hojas[nombre] ? objetos(hojas[nombre]) : []);
  return {
    colecciones: de("Colecciones"),
    productos: de("Productos"),
    materiales: de("Materiales"),
    parametros: de("Parámetros"),
    hojas: Object.keys(hojas),
  };
}
