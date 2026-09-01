// Prepara el terreno para el Arreglo 1 (extender Data Validation de Colecciones):
// 1) backup con timestamp del original
// 2) copia de trabajo (wip) sobre la que se aplica el arreglo real
//
//   node scripts/preparar-wip-colecciones.mjs

import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "../..");
const original = path.join(dir, "Catalogo-TG-v3.xlsx");
const ts = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace("T", "-")
  .slice(0, 15); // YYYYMMDD-HHMMSS
const backup = path.join(dir, `Catalogo-TG-v3.xlsx.bak-${ts}`);
const wip = path.join(dir, "Catalogo-TG-v3-wip.xlsx");

if (!fs.existsSync(original)) {
  console.error(`ABORTADO: no existe ${original}`);
  process.exit(1);
}

fs.copyFileSync(original, backup);
fs.copyFileSync(original, wip);

console.log("original:", original);
console.log("backup:  ", backup);
console.log("wip:     ", wip);
