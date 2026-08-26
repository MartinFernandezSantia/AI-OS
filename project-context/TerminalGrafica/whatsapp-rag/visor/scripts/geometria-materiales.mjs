// Agrega la GEOMETRÍA de la unidad de cobro a la hoja Materiales: tres columnas nuevas
// (Área útil ancho/alto y Separación) con valores en la PRIMERA fila de cada material de
// modo pliego. Los materiales m2 quedan con las celdas vacías (chunk disperso).
//
// Por qué: el bot pasa a cotizar CUALQUIER medida, y para eso el área útil y la separación
// tienen que ser DATO (hoy viven como prosa en Instrucciones). El mapa material→geometría
// es explícito acá abajo, no una heurística por nombre: el dry run muestra la tabla.
//
//   node scripts/geometria-materiales.mjs           (dry run)
//   node scripts/geometria-materiales.mjs --apply

import { XLSX, abrir, chequearLock, guardar, indiceCadenas } from "./lib-xlsx.mjs";

const APPLY = process.argv.includes("--apply");

const COLS = [
  ["H", "Área útil ancho (cm)"],
  ["I", "Área útil alto (cm)"],
  ["J", "Separación (cm)"],
];

/** material → [área útil ancho, área útil alto, separación]. Troquelado/medio corte pierde
 *  margen por el corte: 28x44 con 0,3 de separación. Solo impresión: 31x46 sin separación. */
const GEOMETRIA = new Map([
  ["Papel autoadhesivo troquelado o medio corte", [28, 44, 0.3]],
  ["OPP brillo troquelado", [28, 44, 0.3]],
  ["OPP plata, holográfico, cristal o mate troquelado", [28, 44, 0.3]],
  ["Papel autoadhesivo solo impresión", [31, 46, 0]],
  ["OPP brillo", [31, 46, 0]],
  ["OPP plata, holográfico, cristal o mate", [31, 46, 0]],
]);

const { entradas, get } = abrir();
const indice = indiceCadenas(get("xl/sharedStrings.xml"));
const hoja = get("xl/worksheets/sheet4.xml"); // Materiales
let xml = hoja.contenido.toString("utf8");

if (xml.includes("Área útil") || /<c r="H1"/.test(xml)) {
  console.error("ABORTADO: la hoja Materiales ya tiene columnas de geometría.");
  process.exit(1);
}

// ── ubicar la PRIMERA fila de cada material (columna A = shared string) ────────────────
const vistos = new Set();
const destino = new Map(); // nro de fila → [a, h, sep]
for (const m of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
  const r = Number(m[1]);
  if (r === 1) continue;
  const a = m[2].match(/<c r="A\d+"[^>]*t="s"[^>]*><v>(\d+)<\/v>/);
  if (!a) continue;
  const nombre = indice.cadenas[Number(a[1])];
  if (vistos.has(nombre)) continue;
  vistos.add(nombre);
  if (GEOMETRIA.has(nombre)) destino.set(r, GEOMETRIA.get(nombre));
}

const sinFila = [...GEOMETRIA.keys()].filter((n) => !vistos.has(n));
if (sinFila.length) {
  console.error(`ABORTADO: materiales del mapa que no están en la hoja: ${sinFila.join(" · ")}`);
  process.exit(1);
}

console.log(`archivo: ${XLSX}`);
console.log("fila | material | área útil | separación");
for (const m of xml.matchAll(/<row r="(\d+)"[^>]*>[\s\S]*?<c r="A\d+"[^>]*t="s"[^>]*><v>(\d+)<\/v>/g)) {
  const r = Number(m[1]);
  if (!destino.has(r)) continue;
  const [a, h, s] = destino.get(r);
  console.log(`${String(r).padStart(4)} | ${indice.cadenas[Number(m[2])]} | ${a}x${h} cm | ${s} cm`);
}
console.log(`materiales m2 (sin geometría): ${[...vistos].filter((n) => !GEOMETRIA.has(n)).join(" · ")}`);

// ── headers H1/I1/J1 (mismo estilo s=5 que el resto de la fila 1) ──────────────────────
xml = xml.replace(/(<row r="1"[^>]*>[\s\S]*?)(<\/row>)/, (_, fila, cierre) => {
  const celdas = COLS.map(([col, titulo]) => `<c r="${col}1" s="5" t="s"><v>${indice.idDe(titulo)}</v></c>`).join("");
  return fila + celdas + cierre;
});

// ── valores en la primera fila de cada material pliego ─────────────────────────────────
// Estilos reusados de la hoja: s=9 enteros (Desde/Hasta), s=12 decimales (Mínimo 0,5).
xml = xml.replace(/(<row r="(\d+)"[^>]*>[\s\S]*?)(<\/row>)/g, (todo, fila, rStr, cierre) => {
  const r = Number(rStr);
  if (!destino.has(r)) return todo;
  const [a, h, s] = destino.get(r);
  const celdas =
    `<c r="H${r}" s="9" t="n"><v>${a}</v></c>` +
    `<c r="I${r}" s="9" t="n"><v>${h}</v></c>` +
    `<c r="J${r}" s="12" t="n"><v>${s}</v></c>`;
  return fila + celdas + cierre;
});

// ── dimensión y anchos de columna ──────────────────────────────────────────────────────
xml = xml.replace(/<dimension ref="A1:G(\d+)"\/>/, (_, n) => `<dimension ref="A1:J${n}"/>`);
xml = xml.replace(
  /(<col [^>]*max="7"[^>]*\/>)/,
  `$1<col collapsed="false" customWidth="true" hidden="false" outlineLevel="0" max="10" min="8" style="0" width="16"/>`,
);

hoja.contenido = Buffer.from(xml, "utf8");
indice.aplicar();

console.log(`\nfilas con geometría: ${destino.size} · cadenas nuevas: ${indice.nuevas()}`);
if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}
chequearLock();
guardar(entradas);
console.log("\n✓ Geometría agregada a Materiales.");
