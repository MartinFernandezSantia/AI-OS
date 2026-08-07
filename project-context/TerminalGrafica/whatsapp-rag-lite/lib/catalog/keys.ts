// CLAVES NATURALES + normalización para colisiones. Portado VERBATIM del curador
// (tools/curador-catalogo.html). `norm`/`toks` = semántica de Get Precio (para los
// chequeos de colisión). `normKey` = espeja translate(lower(trim(x))) de Postgres,
// y es la clave con la que el SQL de overlay resuelve la fila (NO uuids): el mismo
// .sql sirve para testing hoy y replay en prod mañana. No tocar sin cuidado.

import type { Producto, Variante } from "./types";

const AC: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ñ: "n",
  Á: "a", É: "e", Í: "i", Ó: "o", Ú: "u", Ñ: "n",
};

/** norm de colisiones: fold acentos (incl. mayúsculas) + lower + colapsa espacios. */
export const norm = (s: string): string =>
  String(s || "")
    .replace(/[áéíóúñÁÉÍÓÚÑ]/g, (c) => AC[c])
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** tokens con stemming ingenuo (saca la 's' final), como Get Precio. */
export const toks = (s: string): string[] =>
  norm(s).split(/[^a-z0-9]+/).filter(Boolean).map((t) => t.replace(/s$/, ""));

/** clave natural: espeja EXACTAMENTE translate(lower(trim(x))) del SQL (sin colapsar
 * espacios internos — el SQL tampoco lo hace). */
export const normKey = (s: string): string =>
  String(s || "").replace(/[áéíóúñÁÉÍÓÚÑ]/g, (c) => AC[c]).toLowerCase().trim();

export const nkProd = (p: Pick<Producto, "nombre_vivo" | "categoria">): string =>
  normKey(p.nombre_vivo) + "|" + normKey(p.categoria);

export const nkVar = (v: Pick<Variante, "nombre_vivo" | "color">): string =>
  normKey(v.nombre_vivo) + "|" + (v.color === null || v.color === undefined ? "∅" : String(v.color));
