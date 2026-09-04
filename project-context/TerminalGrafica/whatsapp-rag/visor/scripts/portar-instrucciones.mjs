// Reemplaza el CONTENIDO (texto) de la hoja "Instrucciones" del catálogo apuntado por
// CATALOGO= por el de Catalogo-TG-v3.xlsx.
//
// Por qué: la copia que manda el cliente trae su PROPIA "Instrucciones" (texto simplificado
// para él, generado por render-instrucciones-cliente.mjs) — pero le falta la PARTE 1 (la
// especificación del motor de cálculo) que armar-prompt.mjs necesita para construir el
// prompt del bot. Sin ella el build ni arranca ("no encontré los separadores de PARTE
// 1/2"). Se reemplaza entera por la del v3: es la fuente de verdad del motor, no toca nada
// de lo que el cliente cargó en Colecciones/Productos/Materiales, y no es una hoja que el
// cliente vea en su copia (la Instrucciones que él lee es un documento aparte,
// instrucciones-cliente.md).
//
// Estilo: NO se intenta preservar el look visual línea por línea (título/sección/gris/
// normal). Las dos hojas se generaron con criterios distintos (una desde un .md con su
// propia micro-sintaxis, la otra a mano) y no hay forma confiable de mapear "esta fila del
// v3 es una sección" sin asumir estructura que puede no existir. Lo único que el build
// necesita es el TEXTO — el prompt del bot no lee el estilo — así que todo el texto porteado
// sale con UN estilo (el que ya usa el título de la hoja destino, o "General" si no hay
// ninguno cargado): correcto funcionalmente, prolijo pero no calca la tipografía original.
// Si hace falta reproducir el look, es tarea de LibreOffice después, no de este script.
//
//   CATALOGO=../Catalogo-TG-v4-wip.xlsx node visor/scripts/portar-instrucciones.mjs           (dry run)
//   CATALOGO=../Catalogo-TG-v4-wip.xlsx node visor/scripts/portar-instrucciones.mjs --apply

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { XLSX, chequearLock, abrir, cadenasDe, relsDe, valorCelda, indiceCadenas, guardar } from "./lib-xlsx.mjs";

const APLICAR = process.argv.includes("--apply");
const ORIGEN = path.resolve(import.meta.dirname, "../../Catalogo-TG-v3.xlsx");

function abrirDe(ruta) {
  const buf = fs.readFileSync(ruta);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  const nEnt = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entradas = [];
  for (let e = 0; e < nEnt; e++) {
    const metodo = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nl = buf.readUInt16LE(off + 28);
    const xl = buf.readUInt16LE(off + 30);
    const cl = buf.readUInt16LE(off + 32);
    const lo = buf.readUInt32LE(off + 42);
    const nombre = buf.toString("utf8", off + 46, off + 46 + nl);
    off += 46 + nl + xl + cl;
    const lnl = buf.readUInt16LE(lo + 26);
    const lxl = buf.readUInt16LE(lo + 28);
    const ini = lo + 30 + lnl + lxl;
    const d = buf.subarray(ini, ini + csize);
    entradas.push({ nombre, contenido: metodo === 0 ? d : zlib.inflateRawSync(d) });
  }
  const get = (n) => {
    const e = entradas.find((x) => x.nombre === n);
    if (!e) throw new Error(`${ruta}: no existe la entrada ${n}`);
    return e;
  };
  return { get };
}

function hojaXmlDe(abierto, nombreHoja) {
  const wb = abierto.get("xl/workbook.xml").contenido.toString("utf8");
  const rid = [...wb.matchAll(/<sheet\b[^>]*\/>/g)]
    .map((m) => m[0])
    .find((t) => t.includes(`name="${nombreHoja}"`))
    ?.match(/r:id="([^"]+)"/)?.[1];
  if (!rid) throw new Error(`no encontré la hoja "${nombreHoja}"`);
  const RID = relsDe(abierto.get("xl/_rels/workbook.xml.rels").contenido.toString("utf8"));
  return abierto.get("xl/" + RID[rid]).contenido.toString("utf8");
}

// ── origen (v3): solo texto, fila por fila (vacía = fila sin contenido) ────────────────

if (!fs.existsSync(ORIGEN)) throw new Error(`no existe el origen ${ORIGEN}`);
const origen = abrirDe(ORIGEN);
const cadenasOrigen = cadenasDe(origen.get("xl/sharedStrings.xml").contenido.toString("utf8"));
const xmlOrigen = hojaXmlDe(origen, "Instrucciones");

const filasOrigen = [];
let maxFila = 0;
for (const f of xmlOrigen.matchAll(/<row[^>]*\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
  const n = Number(f[1]);
  maxFila = Math.max(maxFila, n);
  if (!f[2]) { filasOrigen[n] = null; continue; }
  const c = f[2].match(/<c r="A\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/);
  filasOrigen[n] = c ? (valorCelda(c[1], c[2] ?? "", cadenasOrigen) ?? null) : null;
}
const lineas = [];
for (let n = 1; n <= maxFila; n++) lineas.push(filasOrigen[n] ?? null);

console.log(`"Instrucciones" del origen: ${lineas.length} filas (${lineas.filter(Boolean).length} con texto).`);

// ── destino (CATALOGO=): un único estilo de texto ──────────────────────────────────────

chequearLock();
const { entradas, get } = abrir();
const wbDestino = get("xl/workbook.xml").contenido.toString("utf8");
const primeraHoja = wbDestino.match(/<sheet\b[^>]*\/>/)?.[0]?.match(/\bname="([^"]*)"/)?.[1];
if (primeraHoja !== "Instrucciones") {
  throw new Error(`la primera hoja del destino es "${primeraHoja}", no "Instrucciones" — abortado por seguridad`);
}
const ridDestino = relsDe(get("xl/_rels/workbook.xml.rels").contenido.toString("utf8"));
const ridInstrucciones = [...wbDestino.matchAll(/<sheet\b[^>]*\/>/g)]
  .map((m) => m[0])
  .find((t) => t.includes('name="Instrucciones"'))
  ?.match(/r:id="([^"]+)"/)?.[1];
const rutaDestino = "xl/" + ridDestino[ridInstrucciones];
const xmlDestino = get(rutaDestino).contenido.toString("utf8");

// Estilo del título (fila 1) del destino, si hay; si no, "0" (General, sin estilo custom).
const S_TEXTO = xmlDestino.match(/<c r="A1"\s+s="(\d+)"/)?.[1] ?? "0";
console.log(`estilo de texto reusado del destino: s="${S_TEXTO}"`);

const ssEntry = get("xl/sharedStrings.xml");
const idx = indiceCadenas(ssEntry);

const filasXml = lineas
  .map((texto, i) => {
    const r = i + 1;
    if (!texto) return `<row r="${r}"/>`;
    return `<row r="${r}"><c r="A${r}" s="${S_TEXTO}" t="s"><v>${idx.idDe(texto)}</v></c></row>`;
  })
  .join("");

if (!APLICAR) {
  console.log(`\n${idx.nuevas()} cadena(s) nueva(s) a sharedStrings.`);
  console.log("DRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}

idx.aplicar();
const nuevoXmlDestino = xmlDestino.replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${filasXml}</sheetData>`);
get(rutaDestino).contenido = Buffer.from(nuevoXmlDestino, "utf8");

guardar(entradas);
console.log(`\nEscrito ${XLSX}.`);
