// Agrega la columna "Material base" a la hoja Colecciones: el material que el bot cotiza
// cuando el cliente no pide una opción especial (decisión de la revisión de Fase 3, ver
// plans/workflow-n8n-v1.md § Revisión acordada). Con dropdown contra Materiales_lista,
// igual que el desplegable de Material en Productos.
//
// El mapa colección→base es explícito acá abajo, no una heurística: el dry run lo muestra.
// Cambiar la base después es solo elegir otra opción del desplegable en el Excel.
//
//   node scripts/material-base-colecciones.mjs           (dry run)
//   node scripts/material-base-colecciones.mjs --apply

import { XLSX, abrir, chequearLock, guardar, indiceCadenas } from "./lib-xlsx.mjs";

const APPLY = process.argv.includes("--apply");

const TITULO = "Material base";

/** colección → material base. "Stickers con forma": lo definió Martín (papel = básico,
 *  OPP = especial). "Carteles y vidrieras": adhesivo como base (más simple y barato que
 *  el rígido montado). Las otras dos tienen un solo material. */
const BASE = new Map([
  ["Stickers con forma", "Papel autoadhesivo troquelado o medio corte"],
  ["Stickers para exterior", "Vinilo UV troquelado"],
  ["Carteles y vidrieras", "Vinilo y lona UV"],
  ["Banners y lonas", "Lona"],
]);

const { entradas, get } = abrir();
const indice = indiceCadenas(get("xl/sharedStrings.xml"));
const hoja = get("xl/worksheets/sheet2.xml"); // Colecciones
let xml = hoja.contenido.toString("utf8");

if (/<c r="C1"/.test(xml) || /<dataValidations/.test(xml)) {
  console.error("ABORTADO: la hoja Colecciones ya tiene columna C o una validación.");
  process.exit(1);
}

// ── sanity: cada base existe como material en la hoja Materiales (columna A) ───────────
const matXml = get("xl/worksheets/sheet4.xml").contenido.toString("utf8");
const materiales = new Set(
  [...matXml.matchAll(/<c r="A\d+"[^>]*t="s"[^>]*><v>(\d+)<\/v>/g)].map((m) => indice.cadenas[Number(m[1])]),
);
const inexistentes = [...BASE.values()].filter((b) => !materiales.has(b));
if (inexistentes.length) {
  console.error(`ABORTADO: bases que no existen en la hoja Materiales: ${inexistentes.join(" · ")}`);
  process.exit(1);
}

// ── ubicar la fila de cada colección (columna A = shared string) ───────────────────────
const destino = new Map(); // nro de fila → material base
const vistas = [];
for (const m of xml.matchAll(/<row r="(\d+)"[^>]*>[\s\S]*?<c r="A\d+"[^>]*t="s"[^>]*><v>(\d+)<\/v>/g)) {
  const r = Number(m[1]);
  if (r === 1) continue;
  const nombre = indice.cadenas[Number(m[2])];
  vistas.push(nombre);
  if (BASE.has(nombre)) destino.set(r, BASE.get(nombre));
}
const sinBase = vistas.filter((n) => !BASE.has(n));
const sinFila = [...BASE.keys()].filter((n) => !vistas.includes(n));
if (sinBase.length || sinFila.length) {
  if (sinBase.length) console.error(`ABORTADO: colecciones de la hoja sin base en el mapa: ${sinBase.join(" · ")}`);
  if (sinFila.length) console.error(`ABORTADO: colecciones del mapa que no están en la hoja: ${sinFila.join(" · ")}`);
  process.exit(1);
}

console.log(`archivo: ${XLSX}`);
console.log("fila | colección | material base");
for (const [r, base] of destino) {
  const nombre = vistas[r - 2];
  console.log(`${String(r).padStart(4)} | ${nombre} | ${base}`);
}

// ── header C1 (mismo estilo s=5 que la fila 1) ─────────────────────────────────────────
xml = xml.replace(/(<row r="1"[^>]*>[\s\S]*?)(<\/row>)/, (_, fila, cierre) => {
  return fila + `<c r="C1" s="5" t="s"><v>${indice.idDe(TITULO)}</v></c>` + cierre;
});

// ── valores C2..C5 (estilo s=6, el de texto de la columna A) ───────────────────────────
xml = xml.replace(/(<row r="(\d+)"[^>]*>[\s\S]*?)(<\/row>)/g, (todo, fila, rStr, cierre) => {
  const r = Number(rStr);
  if (!destino.has(r)) return todo;
  return fila + `<c r="C${r}" s="6" t="s"><v>${indice.idDe(destino.get(r))}</v></c>` + cierre;
});

// ── dimensión y ancho de columna ───────────────────────────────────────────────────────
xml = xml.replace(/<dimension ref="A1:B(\d+)"\/>/, (_, n) => `<dimension ref="A1:C${n}"/>`);
xml = xml.replace(
  /(<col [^>]*max="2"[^>]*\/>)/,
  `$1<col collapsed="false" customWidth="true" hidden="false" outlineLevel="0" max="3" min="3" style="0" width="34"/>`,
);

// ── dropdown contra Materiales_lista (mismo formato que los de Productos) ──────────────
// Rango C2:C35: acompaña el límite de crecimiento de Colecciones (B35 en _listas).
const validacion =
  `<dataValidations count="1">` +
  `<dataValidation allowBlank="true" ` +
  `error="Elegí un material de la lista desplegable. Si necesitás uno nuevo, agregalo primero en la hoja Materiales." ` +
  `errorStyle="stop" errorTitle="Ese material no existe" operator="between" ` +
  `prompt="El material que se cotiza cuando el cliente no pide una opción especial. Sale de la hoja Materiales." ` +
  `promptTitle="Material base" showDropDown="false" showErrorMessage="true" showInputMessage="true" ` +
  `sqref="C2:C35" type="list"><formula1>Materiales_lista</formula1><formula2>0</formula2></dataValidation>` +
  `</dataValidations>`;
xml = xml.replace(/<printOptions/, `${validacion}<printOptions`);

hoja.contenido = Buffer.from(xml, "utf8");
indice.aplicar();

console.log(`\ncolecciones con base: ${destino.size} · cadenas nuevas: ${indice.nuevas()}`);
if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}
chequearLock();
guardar(entradas);
console.log("\n✓ Columna 'Material base' agregada a Colecciones.");
