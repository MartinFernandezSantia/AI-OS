// Deja en Catalogo-cliente-PENDIENTES.xlsx SOLO lo que falta decidir: borra de la hoja
// "Lista de precios" las filas que ya cotizan y las que TG no hace.
//
// El archivo es una COPIA del que mandó el cliente; el original no se toca.
// La lista de qué borrar sale de pendientes-cliente.mjs, que es donde vive el criterio.
//
//   node visor/scripts/podar-pendientes.mjs           → dry run
//   node visor/scripts/podar-pendientes.mjs --apply
import { readFileSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";

const APLICAR = process.argv.includes("--apply");
const RUTA = new URL("../../Catalogo-cliente-PENDIENTES.xlsx", import.meta.url).pathname;

// Qué filas SOBREVIVEN. Se importa el cruce para no duplicar el criterio en dos lugares.
const { aBorrar, resumen } = await import("./pendientes-cliente.mjs").then((m) => m.decidir());

// ── ZIP crudo ────────────────────────────────────────────────────────────────────────
function leerZip(ruta) {
  const buf = readFileSync(ruta);
  const entradas = [];
  let fin = buf.length - 22;
  while (fin >= 0 && buf.readUInt32LE(fin) !== 0x06054b50) fin--;
  let p = buf.readUInt32LE(fin + 16);
  const n = buf.readUInt16LE(fin + 10);
  for (let i = 0; i < n; i++) {
    const metodo = buf.readUInt16LE(p + 10);
    const compLen = buf.readUInt32LE(p + 20);
    const nomLen = buf.readUInt16LE(p + 28);
    const extLen = buf.readUInt16LE(p + 30);
    const comLen = buf.readUInt16LE(p + 32);
    const offLocal = buf.readUInt32LE(p + 42);
    const nombre = buf.toString("utf8", p + 46, p + 46 + nomLen);
    const lNom = buf.readUInt16LE(offLocal + 26);
    const lExt = buf.readUInt16LE(offLocal + 28);
    const ini = offLocal + 30 + lNom + lExt;
    const datos = buf.subarray(ini, ini + compLen);
    entradas.push({ nombre, contenido: metodo === 8 ? zlib.inflateRawSync(datos) : datos });
    p += 46 + nomLen + extLen + comLen;
  }
  return entradas;
}

function escribirZip(ruta, entradas) {
  const locales = [];
  const central = [];
  let off = 0;
  for (const e of entradas) {
    const nom = Buffer.from(e.nombre, "utf8");
    const comp = zlib.deflateRawSync(e.contenido, { level: 6 });
    const crc = zlib.crc32 ? zlib.crc32(e.contenido) : crc32(e.contenido);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(e.contenido.length, 22);
    lh.writeUInt16LE(nom.length, 26);
    locales.push(lh, nom, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(e.contenido.length, 24);
    ch.writeUInt16LE(nom.length, 28);
    ch.writeUInt32LE(off, 42);
    central.push(ch, nom);
    off += 30 + nom.length + comp.length;
  }
  const cuerpo = Buffer.concat(locales);
  const dir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(cuerpo.length, 16);
  writeFileSync(ruta, Buffer.concat([cuerpo, dir, eocd]));
}

// CRC-32 propio: `zlib.crc32` no existe en todas las versiones de Node.
let TABLA = null;
function crc32(buf) {
  if (!TABLA) {
    TABLA = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLA[i] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ── La poda ──────────────────────────────────────────────────────────────────────────
const entradas = leerZip(RUTA);
const eDe = (n) => entradas.find((e) => e.nombre === n);
const txt = (n) => eDe(n).contenido.toString("utf8");

const dec = (s) => String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const HOJAS = [...txt("xl/workbook.xml").matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"[^>]*\/?>/g)].map((m) => ({ nombre: dec(m[1]), rid: m[2] }));
const RID = Object.fromEntries([...txt("xl/_rels/workbook.xml.rels").matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
const rutaHoja = "xl/" + RID[HOJAS.find((x) => x.nombre === "Lista de precios").rid].replace(/^\//, "");

let xml = eDe(rutaHoja).contenido.toString("utf8");
const borrar = new Set(aBorrar);
let quitadas = 0;

// Se BORRAN las filas, sin renumerar: los `r=` quedan salteados y Excel lo acepta sin
// problema. Renumerar obligaría a reescribir cada referencia de celda de la fila.
xml = xml.replace(/<row r="(\d+)"[^>]*>[\s\S]*?<\/row>|<row r="(\d+)"[^>]*\/>/g, (todo, a, b) => {
  const n = Number(a ?? b);
  if (!borrar.has(n)) return todo;
  quitadas++;
  return "";
});

console.log(resumen);
console.log(`\nFilas a quitar de "Lista de precios": ${quitadas}`);
if (!APLICAR) {
  console.log("DRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}

eDe(rutaHoja).contenido = Buffer.from(xml, "utf8");
escribirZip(RUTA, entradas);
console.log(`\nEscrito ${RUTA}`);
