// Lector de .xlsx en el BROWSER, sin librerías. Único módulo con dependencia del entorno.
//
// Un .xlsx es un ZIP con XML adentro (OOXML). Las 13 entradas del catálogo están en deflate,
// y el browser trae DecompressionStream('deflate-raw') nativo desde Chrome 103 / Firefox 113,
// así que no hace falta jszip ni sheetjs para esto.

/** Todas las hojas visibles del libro: nombre → matriz de celdas (fila 0 = headers). */
export type Hojas = Record<string, string[][]>;

// ── ZIP ────────────────────────────────────────────────────────────────────────────────

interface Entrada {
  metodo: number;
  tamComprimido: number;
  offsetLocal: number;
}

/** Descomprime las entradas del ZIP a texto. Solo las que pide `querer` (el ZIP trae ~13). */
async function leerZip(buf: ArrayBuffer, querer: (n: string) => boolean): Promise<Record<string, string>> {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // EOCD: firma 0x06054b50, cerca del final. Se busca hacia atrás porque el comment es variable.
  let eocd = -1;
  for (let i = v.byteLength - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("No parece un .xlsx: no se encontró el fin del ZIP (EOCD).");

  const n = v.getUint16(eocd + 10, true);
  let off = v.getUint32(eocd + 16, true);

  const entradas: Record<string, Entrada> = {};
  for (let e = 0; e < n; e++) {
    const metodo = v.getUint16(off + 10, true);
    const tamComprimido = v.getUint32(off + 20, true);
    const nameLen = v.getUint16(off + 28, true);
    const extraLen = v.getUint16(off + 30, true);
    const commentLen = v.getUint16(off + 32, true);
    const offsetLocal = v.getUint32(off + 42, true);
    const nombre = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nameLen));
    entradas[nombre] = { metodo, tamComprimido, offsetLocal };
    off += 46 + nameLen + extraLen + commentLen;
  }

  const out: Record<string, string> = {};
  for (const [nombre, en] of Object.entries(entradas)) {
    if (!querer(nombre)) continue;
    // OJO: nameLen/extraLen del LOCAL header pueden diferir de los del directorio central.
    const lnl = v.getUint16(en.offsetLocal + 26, true);
    const lxl = v.getUint16(en.offsetLocal + 28, true);
    const ini = en.offsetLocal + 30 + lnl + lxl;
    const datos = u8.subarray(ini, ini + en.tamComprimido);

    if (en.metodo === 0) {
      out[nombre] = new TextDecoder().decode(datos);
    } else {
      const stream = new Blob([datos as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out[nombre] = await new Response(stream).text();
    }
  }
  return out;
}

// ── OOXML ──────────────────────────────────────────────────────────────────────────────

/** Decodifica entidades XML, incluidas las numéricas (&#233;). */
const dec = (s: string): string =>
  s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** "B7" → 1 (índice de columna, 0-based). Las letras son base-26. */
function indiceCol(ref: string): number {
  let c = 0;
  for (const ch of ref.replace(/\d+/g, "")) c = c * 26 + (ch.charCodeAt(0) - 64);
  return c - 1;
}

/** sharedStrings.xml → array. Un <si> puede tener varios <t> (texto con formato mixto). */
function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let t = "";
    for (const tm of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += dec(tm[1]);
    out.push(t);
  }
  return out;
}

/** Una worksheet → matriz. Las celdas vacías NO aparecen en el XML: se reconstruyen por `r`.
 *  OJO con los tags SELF-CLOSING (`<c r="G2" s="11"/>`, `<row r="5"/>`): si el regex no los
 *  contempla, `[\s\S]*?` se traga hasta el próximo cierre y desalinea todo lo que sigue. */
function matriz(xml: string, ss: string[]): string[][] {
  const rows: string[][] = [];
  for (const rr of xml.matchAll(/<row[^>]*\/>|<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cm of (rr[1] ?? "").matchAll(/<c([^>]*)\/>|<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cm[1] ?? cm[2];
      const cuerpo = cm[3] ?? "";
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1] ?? "A1";
      const tipo = attrs.match(/t="([^"]+)"/)?.[1];
      let valor = "";
      if (tipo === "inlineStr") {
        for (const tm of cuerpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) valor += dec(tm[1]);
      } else {
        const vm = cuerpo.match(/<v>([\s\S]*?)<\/v>/);
        if (vm) valor = tipo === "s" ? (ss[Number(vm[1])] ?? "") : dec(vm[1]);
      }
      cells[indiceCol(ref)] = valor;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    rows.push(cells);
  }
  return rows;
}

/**
 * Lee un .xlsx y devuelve sus hojas VISIBLES.
 * Las ocultas (`_listas`, que alimenta los desplegables) se descartan: son andamiaje del
 * Excel, no datos del catálogo.
 */
export async function leerXlsx(buf: ArrayBuffer): Promise<Hojas> {
  const necesarias = (n: string) =>
    n === "xl/workbook.xml" ||
    n === "xl/_rels/workbook.xml.rels" ||
    n === "xl/sharedStrings.xml" ||
    n.startsWith("xl/worksheets/");

  const F = await leerZip(buf, necesarias);
  const wb = F["xl/workbook.xml"];
  if (!wb) throw new Error("No parece un .xlsx: falta xl/workbook.xml.");

  const rels: Record<string, string> = {};
  for (const m of (F["xl/_rels/workbook.xml.rels"] ?? "").matchAll(
    /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g,
  )) {
    rels[m[1]] = m[2];
  }

  const ss = sharedStrings(F["xl/sharedStrings.xml"]);
  const hojas: Hojas = {};

  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const nombre = dec(attrs.match(/name="([^"]+)"/)?.[1] ?? "");
    const rid = attrs.match(/r:id="([^"]+)"/)?.[1];
    const oculta = /state="(hidden|veryHidden)"/.test(attrs);
    if (!nombre || !rid || oculta) continue;

    const target = rels[rid];
    if (!target) continue;
    const ruta = "xl/" + target.replace(/^\/?xl\//, "");
    const xml = F[ruta];
    if (!xml) continue;

    hojas[nombre] = matriz(xml, ss);
  }

  if (!Object.keys(hojas).length) throw new Error("El archivo no tiene hojas visibles.");
  return hojas;
}
