// Agrega 7 casos de prueba del MOTOR de medida libre a la hoja "Casos de prueba":
// medidas que NO están en el catálogo (2x2, 5x8), una donde gana la orientación rotada,
// una sin separación, una que no entra en el pliego (→ consulta), y los dos parámetros
// que ningún caso viejo activaba: el mínimo por trabajo ($4.000) y el redondeo ($100).
//
// La columna "Piezas por unidad de cobro" lleva el rinde ESPERADO: documenta el paso
// intermedio del cálculo (los precios están verificados a mano contra las escalas).
//
//   node scripts/casos-motor.mjs           (dry run)
//   node scripts/casos-motor.mjs --apply

import { XLSX, abrir, chequearLock, guardar, indiceCadenas } from "./lib-xlsx.mjs";

const APPLY = process.argv.includes("--apply");

const TROQ = "Papel autoadhesivo troquelado o medio corte";
const IMPRESION = "Papel autoadhesivo solo impresión";

/** [Pedido, Cantidad, Material, Ancho, Alto, Rinde esperado, Precio correcto].
 *  Rinde/precio null = celda vacía. El precio puede ser texto (caso "derivar a consulta"). */
const CASOS = [
  // 2x2 troq: 12×19 = 228/pliego · ceil(500/228)=3 pliegos · tramo 2-10 → 3×2.200
  ["500 stickers 2x2 cm (medida libre)", 500, TROQ, 2, 2, 228, 6600],
  // 5x8: derecha 5×5=25 (rotada 24) · ceil(100/25)=4 → 4×2.200
  ["100 etiquetas 5x8 cm (medida libre)", 100, TROQ, 5, 8, 25, 8800],
  // 20x6: derecha 1×7=7, ROTADA 4×2=8 · ceil(80/8)=10 → 10×2.200
  ["80 etiquetas 20x6 cm (gana la orientación rotada)", 80, TROQ, 20, 6, 8, 22000],
  // 4x4 sin separación: 7×11=77 en 31x46 · ceil(300/77)=4 → 4×1.800
  ["300 etiquetas 4x4 cm solo impresión (sin separación)", 300, IMPRESION, 4, 4, 77, 7200],
  // no entra en 28x44 en ninguna orientación → rinde 0 → consulta
  ["20 stickers 30x45 cm (no entra en el pliego)", 20, TROQ, 30, 45, 0, "Derivar a consulta: no entra en el pliego"],
  // 1 pliego × 2.500 = 2.500 < mínimo por trabajo → 4.000
  ["10 stickers 3x3 cm (activa el mínimo por trabajo)", 10, TROQ, 3, 3, 104, 4000],
  // 0,54 m2 × 16.000 = 8.640 → redondeo al múltiplo de $100 más cercano
  ["1 lona de 90x60 cm (activa el redondeo)", 1, "Lona", 90, 60, null, 8600],
];

const { entradas, get } = abrir();
const indice = indiceCadenas(get("xl/sharedStrings.xml"));
const hoja = get("xl/worksheets/sheet6.xml"); // Casos de prueba
const xml = hoja.contenido.toString("utf8");

if (xml.includes("medida libre")) {
  console.error("ABORTADO: los casos del motor ya están cargados.");
  process.exit(1);
}

// Los materiales se referencian por su cadena EXISTENTE: un typo acá rompería el caso.
for (const [, , mat] of CASOS) {
  if (!indice.cadenas.includes(mat)) {
    console.error(`ABORTADO: el material "${mat}" no existe en el archivo.`);
    process.exit(1);
  }
}

const ultima = Math.max(...[...xml.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1])));
console.log(`archivo: ${XLSX}`);
console.log(`última fila actual: ${ultima} · casos a agregar: ${CASOS.length}`);
for (const [pedido, , , a, h, rinde, precio] of CASOS) {
  console.log(`  + ${pedido} · ${a}x${h} · rinde ${rinde ?? "—"} · ${precio}`);
}

// ── armar las filas nuevas (estilos reusados: A s=8, B-F s=9, G s=14) ──────────────────
const ATTRS = (xml.match(/<row r="\d+"([^>]*?)>/) ?? [, ""])[1]
  .replace(/\s*ht="[\d.]+"/, "")
  .replace(/customHeight="true"/, 'customHeight="false"');

const celda = (col, r, v, s) =>
  v === null || v === undefined
    ? ""
    : typeof v === "number"
      ? `<c r="${col}${r}" s="${s}" t="n"><v>${v}</v></c>`
      : `<c r="${col}${r}" s="${s}" t="s"><v>${indice.idDe(v)}</v></c>`;

const nuevasFilas = CASOS.map((caso, i) => {
  const r = ultima + 1 + i;
  const [pedido, cant, mat, a, h, rinde, precio] = caso;
  return (
    `<row r="${r}"${ATTRS}>` +
    celda("A", r, pedido, "8") +
    celda("B", r, cant, "9") +
    celda("C", r, mat, "9") +
    celda("D", r, a, "9") +
    celda("E", r, h, "9") +
    celda("F", r, rinde, "9") +
    celda("G", r, precio, "14") +
    `</row>`
  );
}).join("");

hoja.contenido = Buffer.from(
  xml
    .replace(/<\/sheetData>/, `${nuevasFilas}</sheetData>`)
    .replace(/<dimension ref="A1:G\d+"\/>/, `<dimension ref="A1:G${ultima + CASOS.length}"/>`),
  "utf8",
);
indice.aplicar();

console.log(`\nfilas: ${ultima} → ${ultima + CASOS.length} · cadenas nuevas: ${indice.nuevas()}`);
if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}
chequearLock();
guardar(entradas);
console.log(`\n✓ ${CASOS.length} casos del motor agregados.`);
