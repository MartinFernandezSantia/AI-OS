// Quita la columna G ("Piezas por unidad de cobro") de la hoja Productos.
//
// Por qué: la columna está VACÍA en las tres versiones del catálogo desde que el rinde se
// calcula por geometría (el rinde efectivo ya no la lee — visor/lib/chunk.ts calcula solo).
// Es ruido muerto que invita a cargar a mano un dato que el sistema calcula.
//
// Se verifica el índice REAL del sheet XML por nombre de hoja (no se asume sheet1) y se
// aborta si el header de la columna G no es el esperado, para no borrar por accidente una
// columna distinta.
//
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/quitar-columna-productos.mjs          (dry run)
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/quitar-columna-productos.mjs --apply

import { XLSX, abrir, cadenasDe, chequearLock, guardar, relsDe, valorCelda } from "./lib-xlsx.mjs";

const APPLY = process.argv.includes("--apply");
const HOJA = "Productos";
const LETRA = "G";
const HEADER_ESPERADO = "Piezas por unidad de cobro";

const { entradas, get } = abrir();
const leer = (n) => get(n).contenido.toString("utf8");

const wbXml = leer("xl/workbook.xml");
const HOJAS = [...wbXml.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => ({
  nombre: m[0].match(/\bname="([^"]*)"/)?.[1],
  rid: m[0].match(/\br:id="([^"]*)"/)?.[1],
}));
const RID_TARGET = relsDe(leer("xl/_rels/workbook.xml.rels"));
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));

const hoja = HOJAS.find((h) => h.nombre === HOJA);
if (!hoja) {
  console.error(`✗ el Excel no tiene la hoja "${HOJA}". Hoja index: ${JSON.stringify(HOJAS.map((h) => h.nombre))}`);
  process.exit(1);
}
console.log(`hoja "${HOJA}" → ${RID_TARGET[hoja.rid]} (no se asume sheet1)`);
const entrada = get("xl/" + RID_TARGET[hoja.rid]);
const xml = entrada.contenido.toString("utf8");

// ── 1) Verificar el header de la columna G ─────────────────────────────────────────────
let headerEncontrado = null;
for (const m of xml.matchAll(/<row r="1"[^>]*>([\s\S]*?)<\/row>/g)) {
  for (const c of m[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = (c[1].match(/\br="([A-Z]+)\d+"/) || [])[1];
    if (ref === LETRA) {
      const v = valorCelda(c[1], c[2], CADENAS);
      if (v !== undefined) headerEncontrado = String(v).trim();
    }
  }
}
if (headerEncontrado !== HEADER_ESPERADO) {
  console.error(
    `✗ la columna ${LETRA}1 de "${HOJA}" es "${headerEncontrado}", esperaba "${HEADER_ESPERADO}". ` +
      `No toco nada: puede que el índice de columnas haya cambiado.`,
  );
  process.exit(1);
}
console.log(`columna ${LETRA}1 = "${headerEncontrado}" ✓`);

// ── 2) Quitar la columna G y correr H→G, I→H (borrar una columna en medio la desplaza) ─
const RE_CELDA = /<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const LETRA_G = "G";
const rangoDe = (n) => {
  let s = "";
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
};

let celdasQuitadas = 0, filasTocadas = 0;
const nuevoXml = xml.replace(
  /<row r="\d+"[^>]*>([\s\S]*?)<\/row>/g,
  (m, cuerpo) => {
    // Se reconstruye cada celda: G se borra, las posteriores (H, I…) se corren a la izquierda.
    const celdas = [...cuerpo.matchAll(RE_CELDA)];
    const transformadas = celdas.map((c) => {
      const ref = (c[1].match(/\br="([A-Z]+\d+)"/) || [])[1];
      const col = (ref || "").match(/^([A-Z]+)/)?.[1];
      if (!col) return c[0]; // celda sin ref: no se toca
      const colNum = [...col].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
      const gNum = [...LETRA_G].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
      if (colNum === gNum) return null; // columna G: se borra
      if (colNum > gNum) {
        const nueva = rangoDe(colNum - 1) + ref.slice(col.length);
        return c[0].replace(ref, nueva);
      }
      return c[0];
    });

    const quitadasAcá = transformadas.filter((t) => t === null).length;
    const nuevoCuerpo = transformadas.join("");
    if (nuevoCuerpo === cuerpo) return m; // fila sin G ni columnas posteriores: intacta
    celdasQuitadas += quitadasAcá;
    filasTocadas++;
    const apertura = m.slice(0, m.length - cuerpo.length - 6);
    return apertura + nuevoCuerpo + "</row>";
  },
);

// ── 3) Recalcular el rango de dimension (A..H ahora) ───────────────────────────────────
let maxFila = 0, maxCol = 0;
for (const m of nuevoXml.matchAll(/<c r="([A-Z]+)(\d+)"[^>]*>/g)) {
  const col = m[1].length; // aproximación: más letras = columna más lejana
  const colNum = [...m[1]].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
  const fila = Number(m[2]);
  if (fila > maxFila) maxFila = fila;
  if (colNum > maxCol) maxCol = colNum;
}
const letraCol = (n) => {
  let s = "";
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
};
const dimension = `A1:${letraCol(maxCol)}${maxFila}`;

const xmlFinal = nuevoXml.replace(/<dimension ref="[^"]*"\s*\/>/, `<dimension ref="${dimension}"/>`);

console.log(`\nceldas G quitadas: ${celdasQuitadas} · filas tocadas: ${filasTocadas}`);
console.log(`dimension → ${dimension}`);

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}

entrada.contenido = Buffer.from(xmlFinal, "utf8");
chequearLock();
guardar(entradas);
console.log(`\n✓ columna ${LETRA} quitada de "${HOJA}".`);