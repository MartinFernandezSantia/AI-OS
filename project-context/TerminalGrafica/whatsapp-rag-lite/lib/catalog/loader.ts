// Carga robusta del export. Acepta la envoltura del SQL editor ([{"export": {...}}]) y repara
// mojibake (UTF-8 leído como latin1/win-1252), porque de esos strings salen las claves naturales
// del SQL — si vienen rotos, no matchean.

import type { CatalogExportV4, ProductoBot, TrabajoBot } from "./types";

/** Desenvuelve [{"export": {...}}] y variantes de un solo valor. */
export function desenvolver(j: unknown): unknown {
  let cur = j;
  for (let i = 0; i < 4; i++) {
    if (cur && typeof cur === "object" && "productos" in cur && "exportado" in cur) return cur;
    if (Array.isArray(cur) && cur.length) { cur = cur[0]; continue; }
    if (cur && typeof cur === "object" && Object.keys(cur as object).length === 1) {
      cur = Object.values(cur as object)[0];
      continue;
    }
    break;
  }
  return cur;
}

const W1252: Record<string, number> = {
  "€": 128, "‚": 130, "ƒ": 131, "„": 132, "…": 133, "†": 134, "‡": 135, "ˆ": 136, "‰": 137, "Š": 138,
  "‹": 139, "Œ": 140, "Ž": 142, "‘": 145, "’": 146, "“": 147, "”": 148, "•": 149, "–": 150, "—": 151,
  "˜": 152, "™": 153, "š": 154, "›": 155, "œ": 156, "ž": 158, "Ÿ": 159,
};

/** Repara "ImpresiÃ³n" → "Impresión" (UTF-8 leído como latin1). Devuelve {texto, reparado}. */
export function repararMojibake(t: string): { texto: string; reparado: boolean } {
  if (!/Ã[-¿ŒœŽžŠšŸƒ‘’‚“”„†‡•…‰‹›€™ˆ˜]/.test(t)) return { texto: t, reparado: false };
  try {
    const bytes = new Uint8Array(t.length);
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      bytes[i] = c <= 0xff ? c : W1252[t[i]] !== undefined ? W1252[t[i]] : 63;
    }
    const rep = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { texto: rep, reparado: true };
  } catch {
    return { texto: t, reparado: false };
  }
}

export interface ParseResultV4 {
  data: CatalogExportV4;
  reparado: boolean;
}

/** Parsea el export del catálogo (modelo producto-bot). Misma envoltura/reparación; EXIGE
 *  schema_version 4 y productos con `items` — así un export de otra forma NO se ingesta como basura
 *  (truncaría la tabla y la llenaría de chunks vacíos). */
export function parseExportV4(texto: string): ParseResultV4 {
  const { texto: fixed, reparado } = repararMojibake(texto);
  const j = desenvolver(JSON.parse(fixed));
  if (!j || typeof j !== "object" || !("productos" in j) || !Array.isArray((j as CatalogExportV4).productos)) {
    throw new Error("Ese JSON no parece un export del catálogo (falta productos).");
  }
  const data = j as CatalogExportV4;
  if (data.schema_version !== 4) {
    throw new Error(
      `Export esperado (schema_version 4); vino ${data.schema_version ?? "sin versión"}.`,
    );
  }
  if (!data.productos.every((p) => Array.isArray((p as ProductoBot).items))) {
    throw new Error("Export inválido: hay productos sin 'items'.");
  }
  // Trabajos (combos) son OPCIONALES: un export viejo sin la clave sigue siendo válido. Si vienen,
  // exigimos que cada trabajo traiga su lista de componentes (si no, chunkTrabajo no puede armar nada).
  if (data.trabajos != null) {
    if (!Array.isArray(data.trabajos)) {
      throw new Error("Export inválido: 'trabajos' no es un array.");
    }
    if (!data.trabajos.every((t) => Array.isArray((t as TrabajoBot).componentes))) {
      throw new Error("Export inválido: hay trabajos sin 'componentes'.");
    }
  }
  return { data, reparado };
}
