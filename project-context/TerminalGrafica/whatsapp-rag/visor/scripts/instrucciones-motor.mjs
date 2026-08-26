// Reescribe la hoja Instrucciones para el MOTOR de medida libre:
//  - PARTE 1 modo pliego: el rinde ya no viene de la columna — se CALCULA con la geometría
//    del material (fórmula + ejemplo 12x8 movido desde la PARTE 2, caso borde rinde 0).
//  - PARTE 1 modo m2: explicita que vale cualquier medida.
//  - PARTE 2: la carga cambia — geometría en Materiales una sola vez; el rinde a mano queda
//    solo para unidades no geométricas; errores silenciosos nuevos.
//
// Es la base del futuro system prompt del bot: acá vive la fórmula general (los chunks
// llevan solo los DATOS: área útil, separación, escala).
//
//   node scripts/instrucciones-motor.mjs           (dry run)
//   node scripts/instrucciones-motor.mjs --apply

import { XLSX, abrir, chequearLock, guardar, indiceCadenas } from "./lib-xlsx.mjs";

const APPLY = process.argv.includes("--apply");

/** Reemplazos 1 línea → 1 línea (texto exacto). */
const REEMPLAZOS = new Map([
  [
    "Cada producto dice de qué material se hace y cuánto rinde ese material. El precio sale de ahí.",
    "Cada producto dice de qué material se hace. Las medidas del catálogo son REFERENCIAS: se cotiza CUALQUIER medida que pida el cliente.",
  ],
  [
    '1. Rinde: la columna "Piezas por unidad de cobro" del producto ya trae el número.',
    "1. Rinde: cuántas piezas entran en una unidad de cobro. Se calcula con la geometría del",
  ],
  [
    "1. m2 de una pieza = (ancho × alto) ÷ 10.000. Las medidas están en centímetros.",
    "1. m2 de una pieza = (ancho × alto) ÷ 10.000. Las medidas están en centímetros. Vale CUALQUIER medida.",
  ],
  [
    "   Modo pliego → el PRODUCTO necesita 'Piezas por unidad de cobro'. El material NO lleva mínimo facturable.",
    "   Modo pliego → el MATERIAL necesita 'Área útil ancho/alto (cm)' y 'Separación (cm)';",
  ],
]);

/** Líneas a insertar DESPUÉS de un ancla (que puede ser una línea ya reemplazada). */
const INSERTAR_DESPUES = [
  [
    "1. Rinde: cuántas piezas entran en una unidad de cobro. Se calcula con la geometría del",
    [
      "   MATERIAL (hoja Materiales: 'Área útil ancho/alto (cm)' y 'Separación (cm)'):",
      "   columnas × filas que entran = floor((útil + sep) ÷ (pieza + sep)) en cada eje,",
      "   probando las DOS orientaciones y tomando la que rinde más. Vale CUALQUIER medida.",
      "   Ejemplo: pieza de 12x8 troquelada (área útil 28x44, separación 0,3).",
      "   Acostada: 28,3÷12,3 = 2 columnas × 44,3÷8,3 = 5 filas = 10. Parada: 3 × 3 = 9. → 10.",
      "   Si el rinde da 0 (la pieza no entra en ninguna orientación), NO cotizar: derivar a consulta.",
    ],
  ],
  [
    "   Modo pliego → el MATERIAL necesita 'Área útil ancho/alto (cm)' y 'Separación (cm)';",
    [
      "                 no lleva mínimo facturable. El producto deja el rinde VACÍO: se calcula.",
      "                 'Piezas por unidad de cobro' se carga SOLO para unidades no geométricas.",
    ],
  ],
  [
    "   Precio por unidad: 18000 | Mínimo facturable: 0,3 | Nota: confirmado el 26/08/2026",
    [
      "   (Material de PLIEGO: cargar también 'Área útil ancho/alto (cm)' y 'Separación (cm)',",
      "   una sola vez, en la primera fila del material.)",
    ],
  ],
];

/** Bloques a reemplazar: [primera línea, última línea] (inclusive) → líneas nuevas. */
const BLOQUES = [
  [
    "Cuántas piezas salen de UNA unidad de cobro. Si la unidad es el pliego A3, es geometría:",
    "   Se toma 10. (Se suma la separación al área y a la pieza antes de dividir.)",
    [
      "Ya NO se carga a mano para los pliegos. La geometría se declara UNA vez por material en",
      "la hoja Materiales ('Área útil ancho/alto (cm)' y 'Separación (cm)') y el rinde se",
      "calcula solo, con la fórmula de la PARTE 1: el visor lo calcula para las medidas de",
      "referencia y el bot para cualquier otra medida que pida el cliente.",
      "   Troquelado o medio corte: área útil 28 x 44 cm, separación 0,3 cm.",
      "   Solo impresión:           área útil 31 x 46 cm, separación 0.",
      "La columna 'Piezas por unidad de cobro' queda SOLO para unidades no geométricas — una",
      "bobina, una plancha — donde el rinde es dato del taller, no geometría. Si se carga,",
      "manda sobre el cálculo, y el visor avisa si no coincide con la geometría.",
    ],
  ],
  [
    "- Producto de modo pliego sin rinde: el chunk sale con precio pero SIN cuántas piezas entran,",
    "  así que parece completo y no lo está. El bot no puede dividir y va a inventar el número.",
    [
      "- Material de modo pliego sin geometría: no hay de dónde calcular el rinde. El visor lo",
      "  avisa al cargar el archivo; hasta cargarla, el bot no puede cotizar ese material.",
      "- Rinde cargado a mano Y geometría que no coinciden: gana el dato cargado y el visor avisa.",
      "- Pieza más grande que el área útil: rinde 0. Se deriva a consulta, nunca se inventa.",
    ],
  ],
];

// ── leer Instrucciones (columna A, huecos incluidos) ───────────────────────────────────
const { entradas, get } = abrir();
const indice = indiceCadenas(get("xl/sharedStrings.xml"));
const hoja = get("xl/worksheets/sheet1.xml");
const xml = hoja.contenido.toString("utf8");

const filas = []; // {texto, s} · texto null = fila vacía (los huecos NO existen como <row>)
let esperada = 1;
for (const m of xml.matchAll(/<row r="(\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/row>)/g)) {
  const r = Number(m[1]);
  while (esperada < r) { filas.push({ texto: null, s: null }); esperada++; }
  const c = (m[2] ?? "").match(/<c r="A\d+"(?:[^>]*\bs="(\d+)")?[^>]*>(?:<v>(\d+)<\/v>)?/);
  filas.push(
    c ? { texto: c[2] !== undefined ? indice.cadenas[Number(c[2])] : null, s: c[1] ?? "0" }
      : { texto: null, s: null },
  );
  esperada = r + 1;
}
const antes = filas.length;

// ── aplicar: reemplazos → bloques → inserciones ────────────────────────────────────────
let nRe = 0;
for (const f of filas) {
  if (f.texto !== null && REEMPLAZOS.has(f.texto)) { f.texto = REEMPLAZOS.get(f.texto); nRe++; }
}
if (nRe !== REEMPLAZOS.size) {
  console.error(`ABORTADO: se esperaban ${REEMPLAZOS.size} reemplazos y matchearon ${nRe}. ¿Cambió el texto?`);
  process.exit(1);
}

let nBloq = 0;
for (const [primera, ultima, nuevas] of BLOQUES) {
  const i = filas.findIndex((f) => f.texto === primera);
  const j = filas.findIndex((f) => f.texto === ultima);
  if (i < 0 || j < i) {
    console.error(`ABORTADO: bloque no encontrado ("${primera.slice(0, 50)}…").`);
    process.exit(1);
  }
  const s = filas[i].s;
  filas.splice(i, j - i + 1, ...nuevas.map((texto) => ({ texto, s })));
  nBloq++;
}

let nIns = 0;
for (const [ancla, lineas] of INSERTAR_DESPUES) {
  const i = filas.findIndex((f) => f.texto === ancla);
  if (i < 0) {
    console.error(`ABORTADO: ancla no encontrada ("${ancla.slice(0, 50)}…").`);
    process.exit(1);
  }
  filas.splice(i + 1, 0, ...lineas.map((texto) => ({ texto, s: filas[i].s })));
  nIns += lineas.length;
}

console.log(`archivo: ${XLSX}`);
console.log(`reemplazos: ${nRe} · bloques: ${nBloq} · líneas insertadas: ${nIns}`);
console.log(`Instrucciones: ${antes} → ${filas.length} filas`);
console.log("\n── texto resultante ──");
for (const f of filas) console.log(f.texto ?? "");

// ── reconstruir sheet1 ─────────────────────────────────────────────────────────────────
const ATTRS = (xml.match(/<row r="\d+"([^>]*?)(?:\/>|>)/) ?? [, ""])[1].replace(/\s*ht="[\d.]+"/, "");
const filasXml = filas
  .map((f, i) => {
    const r = i + 1;
    return f.texto === null
      ? `<row r="${r}"${ATTRS}/>`
      : `<row r="${r}"${ATTRS}><c r="A${r}" s="${f.s}" t="s"><v>${indice.idDe(f.texto)}</v></c></row>`;
  })
  .join("");
hoja.contenido = Buffer.from(
  xml
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${filasXml}</sheetData>`)
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:A${filas.length}"/>`),
  "utf8",
);
indice.aplicar();

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}
chequearLock();
guardar(entradas);
console.log("\n✓ Instrucciones reescritas para el motor de medida libre.");
