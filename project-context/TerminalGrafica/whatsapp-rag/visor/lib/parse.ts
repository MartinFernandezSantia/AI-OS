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
  /** El precio de ESTE tramo es el TOTAL del tramo, no por unidad (troquelado 1-10 piezas
   *  = $10.000 enteros). La marca es POR TRAMO: el troquelado la tiene en el primero y los
   *  demás multiplican por pieza como siempre. */
  total?: boolean;
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

/** Un "sí" del Excel, tolerante a como lo escriba el cliente (sí/si/x/1/true). */
export const esSi = (v: unknown): boolean => /^(s[ií]|x|1|true|v)$/i.test(String(v ?? "").trim());

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
      ...(esSi(m["Precio total por tramo"]) && { total: true }),
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
 * Modo de cálculo derivado de la unidad, o de la columna "Modo de cálculo" cuando está
 * cargada (la columna manda: es la forma EXPLÍCITA con la que TG declara el modo, y la
 * unidad queda como la entiende el negocio). Sin la columna, el fallback es el prefijo.
 *
 * Se matchea por PREFIJO: "pliego A3", "pliego A4" y "pliego" son todos modo pliego. Si se
 * comparara por igualdad, un "pliego A4" nuevo caería en silencio al modo m2 y cotizaría mal.
 *
 * `fijo` es un monto único que NO depende de la cantidad (el recargo por diseño de corte).
 * Valores de la columna: proporcional (multiplica cantidad × precio; el prefijo decide
 * pliego vs item) · superficie (m2) · fijo · tramo total (ítem cuyo precio de tramo es
 * total). Cualquier otro valor cae en `otro` y rompe el build: no cotiza en silencio.
 */
export function modoDe(unidad: string, modoCol?: string): "pliego" | "m2" | "item" | "fijo" | "otro" {
  const m = String(modoCol ?? "").trim().toLowerCase();
  if (m) {
    if (m.startsWith("superficie")) return "m2";
    if (m === "fijo") return "fijo";
    if (m === "tramo total") return "item";
    if (m.startsWith("proporcional")) {
      // "proporcional" cubre pliego e item: la columna dice que se multiplica, el prefijo
      // de la unidad decide cuál de los dos.
    } else {
      return "otro";
    }
  }
  const u = unidad.trim().toLowerCase();
  if (u.startsWith("pliego")) return "pliego";
  if (u.startsWith("m2") || u.startsWith("m²")) return "m2";
  if (u.startsWith("modelo")) return "fijo";
  // Unidad de cobro = ítem: la cantidad pedida ES la cantidad de unidades, sin geometría
  // ni conversión. Cubre lo que se cobra de a uno (anillado, sobre, hoja) y lo que se
  // vende por paquete cerrado ("paquete de 100" → pedir 1 son 100 tarjetas).
  //
  // La lista es EXPLÍCITA a propósito: si el default fuera `item`, una unidad mal escrita
  // ("pliegos A3" en plural, "metro2") cotizaría como ítem en silencio en vez de fallar.
  // `otro` sigue siendo "no sé qué es esto" y el auditor lo rechaza.
  // "metro lineal" entra acá y NO en m2: se cobra cantidad × precio (3 metros de plano
  // escaneado = 3 × $8.000), no ancho × alto. El nombre engaña — lo que lo define es que
  // el cliente pide una cantidad, no una medida de dos ejes.
  //
  // Dice "metro lineal" completo, no "metro" a secas: con el prefijo suelto, "metro
  // cuadrado" también caería en `item` y cobraría por cantidad un material que se cotiza
  // por superficie. El precio saldría plausible y nadie lo notaría.
  // "talonario" es un ítem contable: las rifas se piden "2 talonarios" y la escala está
  // en talonarios (ver el aviso en validar-catalogo sobre la escala en números).
  if (/^(unidad|hoja|paquete|pack|item|ítem|metro lineal|talonario)\b/.test(u)) return "item";
  return "otro";
}

/**
 * ¿La unidad de cobro es una MEDIDA CONTINUA (metro lineal) y no una cosa contable?
 *
 * Las dos son modo `item` —se cobra cantidad × precio— pero el cliente las pide distinto, y
 * ahí está la trampa: "2,45 metros de planos" es UNA pieza con una medida, no 2,45 piezas.
 * El modelo, que declara `cantidad` en piezas, mandó `cantidad: 1` y el bot cobró $8.000 en
 * vez de $19.600 — sin hallazgo del auditor, porque 1 × $8.000 es internamente coherente.
 * Cobrar de menos en silencio es peor que derivar: nadie se entera.
 *
 * Por eso el chunk de estos materiales tiene que decir EN QUÉ UNIDAD declarar la cantidad
 * (ver `lineasMotor` en chunk.ts). Es la misma lección que el proyecto ya aprendió dos veces:
 * la relación entre lo que pide el cliente y la unidad de cobro es un DATO del catálogo, no
 * algo que el prompt deba despejar turno a turno.
 *
 * Hoy matchea un solo material (Escaneo de planos). La función existe para que el próximo
 * —"impresión por metro lineal", "corte por metro"— entre solo, sin que nadie se acuerde.
 */
export function esMedidaContinua(unidad: string): boolean {
  return /^metro lineal\b/.test(unidad.trim().toLowerCase());
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
