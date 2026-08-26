// Cambia la unidad "pliego" → "pliego A3" en la hoja Materiales del catálogo.
//
// Por qué: el tamaño del pliego era un dato del cliente (hoja "Pliegos A3" del Excel
// original) que se perdió al armar el v2, y quedó hardcodeado en el código del visor.
// Ponerlo en la unidad lo devuelve al dato, que es donde tiene que vivir: si mañana
// entra un material por pliego A4, el chunk lo dice solo.
//
// Cómo: sustitución quirúrgica sobre sharedStrings.xml, reempaquetando el ZIP entrada por
// entrada. NO se toca styles.xml ni las worksheets → el formato queda intacto.
//
//   node scripts/unidad-pliego-a3.mjs           (dry run: muestra qué cambiaría)
//   node scripts/unidad-pliego-a3.mjs --apply   (escribe el archivo)

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const XLSX = path.resolve(import.meta.dirname, "../../Catalogo-TG-v2.xlsx");
const VIEJO = "pliego";
const NUEVO = "pliego A3";
const APPLY = process.argv.includes("--apply");

// ── leer el ZIP ────────────────────────────────────────────────────────────────────────
const buf = fs.readFileSync(XLSX);
let eocd = -1;
for (let i = buf.length - 22; i >= 0; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) throw new Error("No se encontró el EOCD: ¿es un .xlsx?");

const n = buf.readUInt16LE(eocd + 10);
let off = buf.readUInt32LE(eocd + 16);
const entradas = [];
for (let e = 0; e < n; e++) {
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
  const datos = buf.subarray(ini, ini + csize);
  entradas.push({ nombre, contenido: metodo === 0 ? datos : zlib.inflateRawSync(datos) });
}

// ── sustituir en sharedStrings ─────────────────────────────────────────────────────────
const ss = entradas.find((e) => e.nombre === "xl/sharedStrings.xml");
if (!ss) throw new Error("El archivo no tiene sharedStrings.xml.");

const xml = ss.contenido.toString("utf8");
// Solo la cadena EXACTA "pliego" como <t> completo: no toca "Piezas por pliego" ni las
// descripciones que mencionan la palabra.
const re = new RegExp(`(<t(?:\\s[^>]*)?>)${VIEJO}(</t>)`, "g");
const hits = [...xml.matchAll(re)].length;

console.log(`archivo : ${XLSX}`);
console.log(`entradas: ${entradas.length}`);
console.log(`"${VIEJO}" como celda exacta: ${hits} ocurrencia(s) en sharedStrings`);

if (hits === 0) {
  const yaA3 = [...xml.matchAll(new RegExp(`(<t(?:\\s[^>]*)?>)${NUEVO}(</t>)`, "g"))].length;
  console.log(yaA3 > 0 ? `Ya dice "${NUEVO}" (${yaA3}). Nada que hacer.` : "No se encontró la cadena. Revisar a mano.");
  process.exit(0);
}

ss.contenido = Buffer.from(xml.replace(re, `$1${NUEVO}$2`), "utf8");

if (!APPLY) {
  console.log(`\nDRY RUN — se cambiarían ${hits} a "${NUEVO}". Correr con --apply para escribir.`);
  process.exit(0);
}

// ── reempaquetar ───────────────────────────────────────────────────────────────────────
const crc32 = (() => {
  const T = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    T[i] = c;
  }
  return (b) => {
    let c = -1;
    for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

const locales = [];
const central = [];
let cursor = 0;

for (const en of entradas) {
  const nombre = Buffer.from(en.nombre, "utf8");
  const crudo = en.contenido;
  const comp = zlib.deflateRawSync(crudo, { level: 9 });
  const crc = crc32(crudo);

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);   // versión necesaria
  lh.writeUInt16LE(0, 6);    // flags
  lh.writeUInt16LE(8, 8);    // deflate
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(crudo.length, 22);
  lh.writeUInt16LE(nombre.length, 26);
  locales.push(lh, nombre, comp);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);   // versión que lo creó
  ch.writeUInt16LE(20, 6);   // versión necesaria
  ch.writeUInt16LE(8, 10);   // deflate
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(crudo.length, 24);
  ch.writeUInt16LE(nombre.length, 28);
  ch.writeUInt32LE(cursor, 42);
  central.push(ch, nombre);

  cursor += lh.length + nombre.length + comp.length;
}

const cuerpo = Buffer.concat(locales);
const dir = Buffer.concat(central);
const eocdOut = Buffer.alloc(22);
eocdOut.writeUInt32LE(0x06054b50, 0);
eocdOut.writeUInt16LE(entradas.length, 8);
eocdOut.writeUInt16LE(entradas.length, 10);
eocdOut.writeUInt32LE(dir.length, 12);
eocdOut.writeUInt32LE(cuerpo.length, 16);

fs.writeFileSync(XLSX, Buffer.concat([cuerpo, dir, eocdOut]));
console.log(`\n✓ Escrito: ${hits} celda(s) ahora dicen "${NUEVO}".`);
