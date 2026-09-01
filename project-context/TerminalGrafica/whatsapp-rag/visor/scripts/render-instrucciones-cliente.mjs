// Renderiza `instrucciones-cliente.md` a la hoja "Instrucciones" del catálogo.
//
// Por qué un .md fuente y no las líneas embebidas acá: el texto es prosa que va a iterar
// (lo lee el cliente y lo lee SU Claude), y en un .md los cambios se revisan como un diff
// legible. El script queda como renderizador y no vuelve a tocarse.
//
// Micro-sintaxis del .md → los 4 estilos que la hoja YA usa:
//   "# ..."        → título principal (14pt negrita azul)
//   "## ..."       → encabezado de sección (11pt negrita)
//   "> ..."        → gris itálica (ejemplos y notas)
//   cualquier otra → texto normal (Arial 10)
//   línea vacía    → fila vacía
//
// Los estilos NO se hardcodean: se leen del sheet1 actual, así un retoque de paleta en
// LibreOffice sobrevive a la regeneración.
//
//   CATALOGO=Catalogo-TG-cliente.xlsx node scripts/render-instrucciones-cliente.mjs
//   CATALOGO=Catalogo-TG-cliente.xlsx node scripts/render-instrucciones-cliente.mjs --apply

import fs from "node:fs";
import path from "node:path";
import { XLSX, chequearLock, abrir, indiceCadenas, guardar } from "./lib-xlsx.mjs";

const APPLY = process.argv.includes("--apply");
const MD = path.resolve(import.meta.dirname, "instrucciones-cliente.md");

// ── parseo del .md ─────────────────────────────────────────────────────────────────────
// La indentación con espacios se PRESERVA tal cual: todo el look de los ejemplos
// ("   Colección:   Imanes") son espacios literales dentro de la celda.
const H = "H", T = "T", N = "N", G = "G", V = null;

const LINEAS = fs.readFileSync(MD, "utf8").replace(/\r\n/g, "\n").split("\n").map((linea) => {
  if (!linea.trim()) return [V];
  let m;
  if ((m = linea.match(/^##\s+(.*)$/))) return [m[1], T];
  if ((m = linea.match(/^#\s+(.*)$/))) return [m[1], H];
  // "> " marca gris itálica; se le saca el marcador y UN espacio, no el resto de la sangría.
  if ((m = linea.match(/^>\s?(.*)$/))) return [m[1], G];
  return [linea, N];
});

// El .md termina con newline → última entrada vacía espuria.
while (LINEAS.length && LINEAS[LINEAS.length - 1][0] === V) LINEAS.pop();

// ── el archivo ─────────────────────────────────────────────────────────────────────────
chequearLock();
const { entradas, get } = abrir();

// La hoja Instrucciones es sheet1 en este archivo (fila 1 = el título). Se verifica en vez
// de asumirlo: si el orden de hojas cambia, este script tiene que romper, no escribir en
// la hoja equivocada.
const wb = get("xl/workbook.xml").contenido.toString("utf8");
const primera = wb.match(/<sheet[^>]*name="([^"]*)"/)?.[1];
if (primera !== "Instrucciones") {
  throw new Error(`la primera hoja es "${primera}", no "Instrucciones" — revisar antes de escribir`);
}

const sheet1xml = get("xl/worksheets/sheet1.xml").contenido.toString("utf8");

// ── estilos: se toman del sheet1 ACTUAL ────────────────────────────────────────────────
// El regex contempla tags self-closing (<c r="A5" s="11"/>): sin eso, un [\s\S]*? se come
// el contenido hasta el próximo cierre y desalinea todo. Ya mordió una vez en este repo.
const estilosUsados = [...sheet1xml.matchAll(/<c r="A(\d+)"(?:[^>]*\bs="(\d+)")?[^>]*\/?>/g)]
  .map((m) => ({ fila: Number(m[1]), s: m[2] ?? "0" }));
const sDe = (fila, fallback) => estilosUsados.find((e) => e.fila === fila)?.s ?? fallback;

// Filas de referencia de la hoja original (ver reescribir-instrucciones.mjs):
//   1 = título principal · 8 = encabezado de sección · 3 = normal · 22 = gris itálica
const EST = { [H]: sDe(1, "1"), [T]: sDe(8, "3"), [N]: sDe(3, "2"), [G]: sDe(22, "4") };

// ── sharedStrings ──────────────────────────────────────────────────────────────────────
const idx = indiceCadenas(get("xl/sharedStrings.xml"));

const filas = LINEAS.map(([texto, estilo], i) => {
  const r = i + 1;
  if (texto === V) return `<row r="${r}"/>`;
  return `<row r="${r}"><c r="A${r}" s="${EST[estilo] ?? "0"}" t="s"><v>${idx.idDe(texto)}</v></c></row>`;
}).join("");

idx.aplicar();

// ── sheet1: reemplazar sheetData, conservando cols/sheetViews ──────────────────────────
const s1 = get("xl/worksheets/sheet1.xml");
s1.contenido = Buffer.from(
  sheet1xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${filas}</sheetData>`),
  "utf8",
);

const conTexto = LINEAS.filter(([t]) => t !== V).length;
console.log(`archivo:  ${XLSX}`);
console.log(`fuente:   ${MD}`);
console.log(`filas:    ${LINEAS.length} (${conTexto} con texto, ${LINEAS.length - conTexto} vacías)`);
console.log(`estilos:  H=${EST[H]} T=${EST[T]} N=${EST[N]} G=${EST[G]}`);

if (!APPLY) {
  console.log("\nDRY RUN — nada escrito. Correr con --apply.");
  process.exit(0);
}

guardar(entradas);
console.log("\n✓ escrito.");
