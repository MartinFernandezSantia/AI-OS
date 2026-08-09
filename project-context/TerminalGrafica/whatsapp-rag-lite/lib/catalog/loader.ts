// Carga robusta del export. Portado del curador: acepta la envoltura del SQL editor
// ([{"export": {...}}]) y repara mojibake (UTF-8 leído como latin1/win-1252), porque
// de esos strings salen las claves naturales del SQL — si vienen rotos, no matchean.

import type { CatalogExport, CatalogExportV4 } from "./types";

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

export interface ParseResult {
  data: CatalogExport;
  reparado: boolean;
}

/** Parsea el texto del archivo a un CatalogExport (repara encoding + desenvuelve). */
export function parseExport(texto: string): ParseResult {
  const { texto: fixed, reparado } = repararMojibake(texto);
  const j = desenvolver(JSON.parse(fixed));
  if (!j || typeof j !== "object" || !("productos" in j) || !("exportado" in j)) {
    throw new Error("Ese JSON no parece un export del catálogo (falta productos/exportado).");
  }
  const data = j as CatalogExport;
  if (!Array.isArray(data.rubros)) data.rubros = [];
  return { data, reparado };
}

export interface ParseResultV4 {
  data: CatalogExportV4;
  reparado: boolean;
}

/** Parsea el export v4 (modelo producto-bot). Misma envoltura/reparación; valida productos. */
export function parseExportV4(texto: string): ParseResultV4 {
  const { texto: fixed, reparado } = repararMojibake(texto);
  const j = desenvolver(JSON.parse(fixed));
  if (!j || typeof j !== "object" || !("productos" in j) || !("exportado" in j)) {
    throw new Error("Ese JSON no parece un export v4 del catálogo (falta productos/exportado).");
  }
  const data = j as CatalogExportV4;
  if (!Array.isArray(data.familias)) data.familias = [];
  return { data, reparado };
}
