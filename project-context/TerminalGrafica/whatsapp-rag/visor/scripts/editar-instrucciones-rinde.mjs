// Etapa 1 · flexibilidad-motor-cotizacion.md — quita de la hoja Instrucciones las
// menciones a la columna "Piezas por unidad de cobro" (que ya no existe en Productos).
//
// Dos cambios:
//   1. La línea "se carga SOLO para unidades no geométricas" (fila 93) se borra entera.
//   2. La sección "DE DÓNDE SALE EL RINDE" (filas 103-113) se reescribe: el rinde sale
//      SIEMPRE de la geometría, no hay columna para cargarlo.
//
// La hoja se resuelve por NOMBRE (no se asume sheet1) y los textos de ancla tienen que
// matchear EXACTO, o el script aborta sin tocar nada.
//
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/editar-instrucciones-rinde.mjs          (dry run)
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/editar-instrucciones-rinde.mjs --apply

import { XLSX, abrir, chequearLock, guardar, indiceCadenas, relsDe } from "./lib-xlsx.mjs";

const APPLY = process.argv.includes("--apply");
const HOJA = "Instrucciones";

const { entradas, get } = abrir();
const leer = (n) => get(n).contenido.toString("utf8");

const wbXml = leer("xl/workbook.xml");
const HOJAS = [...wbXml.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => ({
  nombre: m[0].match(/\bname="([^"]*)"/)?.[1],
  rid: m[0].match(/\br:id="([^"]*)"/)?.[1],
}));
const RID_TARGET = relsDe(leer("xl/_rels/workbook.xml.rels"));
const hoja = HOJAS.find((h) => h.nombre === HOJA);
if (!hoja) {
  console.error(`✗ el Excel no tiene la hoja "${HOJA}". Hoja index: ${JSON.stringify(HOJAS.map((h) => h.nombre))}`);
  process.exit(1);
}
console.log(`hoja "${HOJA}" → ${RID_TARGET[hoja.rid]} (no se asume sheet1)`);
const entrada = get("xl/" + RID_TARGET[hoja.rid]);
const xml = entrada.contenido.toString("utf8");

const indice = indiceCadenas(get("xl/sharedStrings.xml"));
const CADENAS = indice.cadenas;

// ── parsear col A, huecos incluidos ────────────────────────────────────────────────────
const filas = []; // {texto, s} · texto null = fila vacía (los huecos NO existen como <row>)
let esperada = 1;
for (const m of xml.matchAll(/<row r="(\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/row>)/g)) {
  const r = Number(m[1]);
  while (esperada < r) { filas.push({ texto: null, s: null }); esperada++; }
  const c = (m[2] ?? "").match(/<c r="A\d+"(?:[^>]*\bs="(\d+)")?[^>]*>(?:<v>(\d+)<\/v>)?/);
  filas.push(
    c ? { texto: c[2] !== undefined ? CADENAS[Number(c[2])] : null, s: c[1] ?? "0" }
      : { texto: null, s: null },
  );
  esperada = r + 1;
}

// ── 1) borrar la línea "se carga SOLO para unidades no geométricas" ────────────────────
const LINEA_93 = "                 'Piezas por unidad de cobro' se carga SOLO para unidades no geométricas.";
const i93 = filas.findIndex((f) => f.texto === LINEA_93);
if (i93 < 0) {
  console.error(`✗ no encontré la línea: ${LINEA_93}`);
  process.exit(1);
}
filas.splice(i93, 1);

// ── 2) reescribir la sección "DE DÓNDE SALE EL RINDE" ──────────────────────────────────
const INICIO_SECCION = 'DE DÓNDE SALE EL RINDE ("Piezas por unidad de cobro")';
const iIni = filas.findIndex((f) => f.texto === INICIO_SECCION);
if (iIni < 0) {
  console.error(`✗ no encontré el inicio de la sección: ${INICIO_SECCION}`);
  process.exit(1);
}
// La sección termina en la línea "manda sobre el cálculo, y el visor avisa si no coincide."
const FIN_SECCION = "manda sobre el cálculo, y el visor avisa si no coincide con la geometría.";
const iFin = filas.findIndex((f) => f.texto === FIN_SECCION);
if (iFin < 0 || iFin < iIni) {
  console.error(`✗ no encontré el cierre de la sección: ${FIN_SECCION}`);
  process.exit(1);
}
const sSeccion = filas[iIni].s;
const NUEVA_SECCION = [
  "DE DÓNDE SALE EL RINDE",
  "Ya NO se carga a mano: el rinde sale SIEMPRE de la geometría. La geometría se declara",
  "UNA vez por material en la hoja Materiales ('Área útil ancho/alto (cm)' y 'Separación (cm)')",
  "y el rinde se calcula solo, con la fórmula de la PARTE 1: el visor lo calcula para las",
  "medidas de referencia y el bot para cualquier otra medida que pida el cliente.",
  "   Troquelado o medio corte: área útil 28 x 44 cm, separación 0,3 cm.",
  "   Solo impresión:           área útil 31 x 46 cm, separación 0.",
];
filas.splice(iIni, iFin - iIni + 1, ...NUEVA_SECCION.map((texto) => ({ texto, s: sSeccion })));

console.log(`archivo: ${XLSX}`);
console.log(`línea borrada (fila 93): ✓ · sección "DE DÓNDE SALE EL RINDE" reescrita: ✓`);

// ── reconstruir sheet ──────────────────────────────────────────────────────────────────
const ATTRS = (xml.match(/<row r="\d+"([^>]*?)(?:\/>|>)/) ?? [, ""])[1].replace(/\s*ht="[\d.]+"/, "");
const filasXml = filas
  .map((f, i) => {
    const r = i + 1;
    return f.texto === null
      ? `<row r="${r}"${ATTRS}/>`
      : `<row r="${r}"${ATTRS}><c r="A${r}" s="${f.s}" t="s"><v>${indice.idDe(f.texto)}</v></c></row>`;
  })
  .join("");
entrada.contenido = Buffer.from(
  xml
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${filasXml}</sheetData>`)
    .replace(/<dimension ref="[^"]*"\s*\/>/, `<dimension ref="A1:A${filas.length}"/>`),
  "utf8",
);
indice.aplicar();

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}
chequearLock();
guardar(entradas);
console.log("\n✓ Instrucciones actualizadas (rinde solo por geometría).");