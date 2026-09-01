// Verificación del Arreglo 1: compara Catalogo-TG-v3-wip.xlsx contra Catalogo-TG-v3.xlsx
// (el original, intacto). Chequea:
//  - ZIP válido (todas las entradas listan e inflan) en ambos archivos
//  - todas las hojas EXCEPTO Colecciones byte-idénticas
//  - sqref="C2:C300" presente en Colecciones del wip
//  - A2:A500 / D2:D500 de Productos intactos en el wip
//  - las <f t="array" de _listas siguen en la misma cantidad
//
//   node scripts/verificar-wip-colecciones.mjs

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

function abrirArchivo(rutaArchivo) {
  const buf = fs.readFileSync(rutaArchivo);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error(`${rutaArchivo}: no es un ZIP válido (sin EOCD)`);
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
    const contenido = metodo === 0 ? d : zlib.inflateRawSync(d);
    entradas.push({ nombre, contenido });
  }
  return entradas;
}

const dir = path.resolve(import.meta.dirname, "../..");
const rutaOriginal = path.join(dir, "Catalogo-TG-v3.xlsx");
const rutaWip = path.join(dir, "Catalogo-TG-v3-wip.xlsx");

let fallas = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "OK  " : "FAIL"} ${msg}`);
  if (!cond) fallas++;
};

// ── ZIP válido en ambos ─────────────────────────────────────────────────────
let original, wip;
try {
  original = abrirArchivo(rutaOriginal);
  ok(true, `ZIP válido: ${rutaOriginal} (${original.length} entradas, todas inflan)`);
} catch (e) {
  ok(false, `ZIP válido original: ${e.message}`);
}
try {
  wip = abrirArchivo(rutaWip);
  ok(true, `ZIP válido: ${rutaWip} (${wip.length} entradas, todas inflan)`);
} catch (e) {
  ok(false, `ZIP válido wip: ${e.message}`);
}
if (!original || !wip) process.exit(1);

// ── mismas entradas ──────────────────────────────────────────────────────────
const nombresOriginal = new Set(original.map((e) => e.nombre));
const nombresWip = new Set(wip.map((e) => e.nombre));
ok(
  nombresOriginal.size === nombresWip.size && [...nombresOriginal].every((n) => nombresWip.has(n)),
  "mismo conjunto de entradas en original y wip",
);

// ── hojas idénticas excepto Colecciones (sheet2.xml) ────────────────────────
const excepcion = "xl/worksheets/sheet2.xml";
for (const nombre of nombresOriginal) {
  const eo = original.find((e) => e.nombre === nombre);
  const ew = wip.find((e) => e.nombre === nombre);
  const iguales = Buffer.compare(eo.contenido, ew.contenido) === 0;
  if (nombre === excepcion) {
    ok(!iguales, `${nombre} (Colecciones) cambió respecto al original (esperado)`);
  } else {
    ok(iguales, `${nombre} byte-idéntico al original`);
  }
}

// ── sqref extendido en Colecciones ──────────────────────────────────────────
const colWip = wip.find((e) => e.nombre === excepcion).contenido.toString("utf8");
ok(colWip.includes('sqref="C2:C300"'), 'Colecciones (wip) contiene sqref="C2:C300"');
ok(!colWip.includes('sqref="C2:C35"'), 'Colecciones (wip) ya NO contiene sqref="C2:C35"');

// ── rangos de Productos intactos (sheet3.xml) ───────────────────────────────
const prodWip = wip.find((e) => e.nombre === "xl/worksheets/sheet3.xml").contenido.toString("utf8");
ok(prodWip.includes('sqref="A2:A500"'), 'Productos (wip) mantiene sqref="A2:A500"');
ok(prodWip.includes('sqref="D2:D500"'), 'Productos (wip) mantiene sqref="D2:D500"');

// ── fórmulas array de _listas (sheet7.xml) vivas ────────────────────────────
const contarArray = (buf) => (buf.toString("utf8").match(/<f t="array"/g) || []).length;
const nArrOriginal = contarArray(original.find((e) => e.nombre === "xl/worksheets/sheet7.xml").contenido);
const nArrWip = contarArray(wip.find((e) => e.nombre === "xl/worksheets/sheet7.xml").contenido);
ok(nArrWip === nArrOriginal && nArrWip > 0, `_listas: ${nArrWip} <f t="array" (igual que el original, ${nArrOriginal})`);

console.log();
console.log(fallas === 0 ? `TODO OK (${original.length} entradas verificadas)` : `${fallas} verificación(es) FALLIDA(S)`);
process.exit(fallas === 0 ? 0 : 1);
