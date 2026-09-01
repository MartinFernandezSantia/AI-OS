// Carga robusta del export. Acepta la envoltura del SQL editor ([{"export": {...}}]) y repara
// mojibake (UTF-8 leído como latin1/win-1252), porque de esos strings salen las claves naturales
// del SQL — si vienen rotos, no matchean.

import type { CatalogExportV5, ProductoBot, TrabajoBot, VarianteTrabajo } from "./types";

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

export interface ParseResultV5 {
  data: CatalogExportV5;
  reparado: boolean;
}

/** Parsea el export del catálogo (modelo producto-bot). Misma envoltura/reparación; EXIGE
 *  schema_version 5 y productos con `items` — así un export de otra forma NO se ingesta como basura
 *  (truncaría la tabla y la llenaría de chunks vacíos). */
export function parseExportV5(texto: string): ParseResultV5 {
  const { texto: fixed, reparado } = repararMojibake(texto);
  const j = desenvolver(JSON.parse(fixed));
  if (!j || typeof j !== "object" || !("productos" in j) || !Array.isArray((j as CatalogExportV5).productos)) {
    throw new Error("Ese JSON no parece un export del catálogo (falta productos).");
  }
  const data = j as CatalogExportV5;
  if (data.schema_version !== 5) {
    throw new Error(
      `Export esperado (schema_version 5); vino ${data.schema_version ?? "sin versión"}.`,
    );
  }
  if (!data.productos.every((p) => Array.isArray((p as ProductoBot).items))) {
    throw new Error("Export inválido: hay productos sin 'items'.");
  }
  // Trabajos (combos) son OPCIONALES: un export sin la clave sigue siendo válido. Si vienen, exigimos
  // la forma nueva: cada trabajo con `variantes` (variantes-de-trabajo) y cada una con `componentes`
  // (las bot.variant que la arman) — si no, chunkTrabajo no puede armar nada.
  if (data.trabajos != null) {
    if (!Array.isArray(data.trabajos)) {
      throw new Error("Export inválido: 'trabajos' no es un array.");
    }
    if (!data.trabajos.every((t) => Array.isArray((t as TrabajoBot).variantes))) {
      throw new Error("Export inválido: hay trabajos sin 'variantes'.");
    }
    const variantes = data.trabajos.flatMap((t) => (t as TrabajoBot).variantes);
    if (!variantes.every((vt) => Array.isArray((vt as VarianteTrabajo).componentes))) {
      throw new Error("Export inválido: hay variantes-de-trabajo sin 'componentes'.");
    }
  }
  return { data, reparado };
}
