// Escribe la descripción de una colección en la hoja Colecciones. La descripción encabeza
// TODOS los chunks de la colección, así que una vacía deja al bot sin contexto de qué es
// eso que está cotizando.
//
// Por defecto solo escribe donde la celda está VACÍA: no pisa texto que puede haber escrito
// Martin. `--reemplazar` levanta esa protección, para las que hay que reescribir a
// propósito — y entonces el dry run muestra el antes y el después.
//
//   node visor/scripts/describir-colecciones.mjs                    → dry run
//   CATALOGO=Catalogo-TG-v3.xlsx node … --apply
//   CATALOGO=Catalogo-TG-v3.xlsx node … --reemplazar --apply
import { XLSX, chequearLock, abrir, cadenasDe, dec, indiceCadenas, guardar } from "./lib-xlsx.mjs";

const APLICAR = process.argv.includes("--apply");
const REEMPLAZAR = process.argv.includes("--reemplazar");

const DESCRIPCIONES = {
  // Estaba vacía y la colección ya tiene un producto (el escaneo de planos). Sin esto su
  // chunk arranca con el título pelado y el bot no sabe de qué se trata.
  "Diseño y servicios":
    "Servicios sobre archivos, sin impresión: escaneo y digitalización de planos y documentos en gran formato.",

  // La que había hablaba solo de lo que se vende suelto ("posters, banners roll-up y porta
  // banners tipo X"), y desde que entraron los combos la colección también tiene la lona
  // con la estructura incluida. Sin nombrarlos, el bot que lee este encabezado no sabe que
  // existen — y son justo lo que el cliente pide como "banner completo".
  "Gran formato y cartelería":
    "Impresión de gran formato lista para usar: posters, porta banners tipo X y roll-up, y planos. " +
    "También hay combos que traen la lona impresa junto con su estructura, a precio cerrado.",
};

chequearLock();

const { entradas } = abrir();
const entradaDe = (n) => entradas.find((e) => e.nombre === n);
const leer = (n) => entradaDe(n).contenido.toString("utf8");

const HOJAS = [...leer("xl/workbook.xml").matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"[^>]*\/?>/g)].map((m) => ({
  nombre: dec(m[1]),
  rid: m[2],
}));
const RID = Object.fromEntries(
  [...leer("xl/_rels/workbook.xml.rels").matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]),
);
const ruta = "xl/" + RID[HOJAS.find((x) => x.nombre === "Colecciones").rid].replace(/^\//, "");

const SS = indiceCadenas(entradaDe("xl/sharedStrings.xml"));
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));

let xml = leer(ruta);

// Dónde está cada colección y qué letra es "Descripción".
let colDesc = null;
const filaDe = {};
const yaTiene = new Set();
const actualDe = {}; // para mostrar el ANTES cuando se reemplaza
for (const f of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
  const n = Number(f[1]);
  let nombreFila = null;
  const celdas = {};
  for (const c of f[2].matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const v = (c[4] || "").match(/<v>([\s\S]*?)<\/v>/);
    if (!v) continue;
    const texto = /t="s"/.test(c[3]) ? String(CADENAS[Number(v[1])] ?? "") : v[1];
    if (n === 1 && texto.trim() === "Descripción") colDesc = c[1];
    if (n > 1 && c[1] === "A") nombreFila = texto.trim();
    celdas[c[1]] = texto;
  }
  if (n > 1 && nombreFila) {
    filaDe[nombreFila] = n;
    const actual = String(celdas[colDesc] ?? "").trim();
    if (colDesc && actual) { yaTiene.add(nombreFila); actualDe[nombreFila] = actual; }
  }
}
if (!colDesc) throw new Error('la hoja Colecciones no tiene columna "Descripción"');

// El estilo se copia de una celda de descripción existente.
const estilo = (() => {
  const m = xml.match(new RegExp(`<c r="${colDesc}\\d+"([^>]*?)(?:/>|>)`));
  const s = m && m[1].match(/s="(\d+)"/);
  return s ? ` s="${s[1]}"` : "";
})();

// La última fila, para poder AGREGAR una colección que ni siquiera esté declarada. Pasa:
// "Diseño y servicios" se usó en un producto sin existir en esta hoja, y su chunk salía
// con el título pelado y sin descripción.
let ultima = 0;
for (const f of xml.matchAll(/<row r="(\d+)"/g)) ultima = Math.max(ultima, Number(f[1]));
const estiloA = (() => {
  const m = xml.match(/<c r="A[2-9]\d*"([^>]*?)(?:\/>|>)/);
  const s = m && m[1].match(/s="(\d+)"/);
  return s ? ` s="${s[1]}"` : "";
})();

const aEscribir = [];
const aCrear = [];
for (const [nombre, texto] of Object.entries(DESCRIPCIONES)) {
  const n = filaDe[nombre];
  if (!n) { aCrear.push({ nombre, texto }); continue; }
  if (yaTiene.has(nombre)) {
    if (!REEMPLAZAR) { console.log(`· "${nombre}" ya tiene descripción — se saltea (--reemplazar la pisa)`); continue; }
    if (actualDe[nombre] === texto) { console.log(`· "${nombre}" ya dice exactamente esto`); continue; }
  }
  aEscribir.push({ nombre, fila: n, texto, antes: actualDe[nombre] });
}

for (const { nombre, fila, texto, antes } of aEscribir) {
  console.log(`+ ${colDesc}${fila}  ${nombre}`);
  if (antes) console.log(`    ANTES:  ${antes}`);
  console.log(`    ${antes ? "AHORA:  " : "    "}${texto}`);
  const celda = `<c r="${colDesc}${fila}"${estilo} t="s"><v>${SS.idDe(texto)}</v></c>`;
  xml = xml.replace(new RegExp(`(<row r="${fila}"[^>]*>)([\\s\\S]*?)(</row>)`), (t, a, cuerpo, z) => {
    // Si la celda ya existe se REEMPLAZA; si no (estaba vacía), se agrega al final.
    const existe = new RegExp(`<c r="${colDesc}${fila}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
    return existe.test(cuerpo)
      ? `${a}${cuerpo.replace(existe, celda)}${z}`
      : `${a}${cuerpo}${celda}${z}`;
  });
}

if (aCrear.length) {
  const filas = aCrear
    .map(({ nombre, texto }, i) => {
      const n = ultima + 1 + i;
      console.log(`+ fila ${n} NUEVA  ${nombre}`);
      console.log(`    ${texto}`);
      return (
        `<row r="${n}">` +
        `<c r="A${n}"${estiloA} t="s"><v>${SS.idDe(nombre)}</v></c>` +
        `<c r="${colDesc}${n}"${estilo} t="s"><v>${SS.idDe(texto)}</v></c>` +
        `</row>`
      );
    })
    .join("");
  xml = xml.replace(/<\/sheetData>/, `${filas}</sheetData>`);
}

console.log(`\n${aEscribir.length + aCrear.length} descripción(es) a escribir (${aCrear.length} colección/es nueva/s).`);
if (!APLICAR) {
  console.log("DRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}
if (!aEscribir.length && !aCrear.length) process.exit(0);

SS.aplicar();
entradaDe(ruta).contenido = Buffer.from(xml, "utf8");
guardar(entradas);
console.log(`Escrito ${XLSX}.`);
