// Normaliza un .xlsx guardado por openpyxl (todo el texto como t="inlineStr", sin
// xl/sharedStrings.xml) al formato tradicional (t="s" + sharedStrings.xml).
//
// Por qué: el resto del toolchain (agregar-columna.mjs, los cargar-*.mjs, volcar-hoja.mjs)
// asume sharedStrings.xml para poder REGISTRAR cadenas nuevas — indiceCadenas() llama
// get("xl/sharedStrings.xml") sin tolerancia, y volcar-hoja.mjs ni siquiera pasa por
// valorCelda(). Sin esta pasada, esos scripts fallan o (peor) escriben t="s" apuntando a
// un sharedStrings que no existe. Una normalización acá y de ahí en más todo funciona
// sin tocar ningún otro script.
//
// No toca hojas que ya usan t="s" en alguna celda (no debería pasar en un archivo entero
// guardado por openpyxl, pero si una hoja viene mixta, sus celdas t="s" quedan intactas:
// solo se reescriben las t="inlineStr").
//
//   node scripts/normalizar-inline.mjs                (dry run)
//   CATALOGO=../Catalogo-TG-v4-wip.xlsx node scripts/normalizar-inline.mjs --apply

import { XLSX, chequearLock, abrir, cadenasDe, esc, guardar } from "./lib-xlsx.mjs";

const APLICAR = process.argv.includes("--apply");

const { entradas, getOpcional } = abrir();
const HOJA_XML = /^xl\/worksheets\/sheet\d+\.xml$/;

const ssEntry = getOpcional("xl/sharedStrings.xml");
const cadenasExistentes = ssEntry ? cadenasDe(ssEntry.contenido.toString("utf8")) : [];
const indice = new Map(cadenasExistentes.map((t, i) => [t, i]).reverse());
const nuevas = [];
const idDe = (t) => {
  if (indice.has(t)) return indice.get(t);
  const id = cadenasExistentes.length + nuevas.length;
  nuevas.push(t);
  indice.set(t, id);
  return id;
};

function textoInlineDe(cuerpoCelda) {
  const is = cuerpoCelda.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "";
  let t = "";
  for (const tm of is.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
    t += tm[1]
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }
  return t;
}

let celdasConvertidas = 0;
const escrituras = new Map();

for (const en of entradas) {
  if (!HOJA_XML.test(en.nombre)) continue;
  const xml = en.contenido.toString("utf8");
  if (!xml.includes('t="inlineStr"')) continue;

  const nuevo = xml.replace(
    /<c r="([A-Z]+\d+)"([^>]*?)\bt="inlineStr"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    (todo, ref, antes, despues, cuerpo) => {
      if (!cuerpo) return `<c r="${ref}"${antes}${despues}/>`; // inlineStr sin <is>: celda vacía
      const texto = textoInlineDe(cuerpo);
      celdasConvertidas++;
      const attrsSinT = (antes + despues).replace(/\s*t="inlineStr"/, "");
      return `<c r="${ref}"${attrsSinT} t="s"><v>${idDe(texto)}</v></c>`;
    },
  );
  if (nuevo !== xml) escrituras.set(en.nombre, nuevo);
}

console.log(`${celdasConvertidas} celda(s) inlineStr → sharedStrings, en ${escrituras.size} hoja(s).`);
console.log(`${nuevas.length} cadena(s) nueva(s) en sharedStrings (${cadenasExistentes.length} ya había).`);

if (!APLICAR) {
  console.log("DRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}
if (!celdasConvertidas) {
  console.log("No hay nada que normalizar.");
  process.exit(0);
}

chequearLock();

for (const [nombre, xml] of escrituras) {
  entradas.find((e) => e.nombre === nombre).contenido = Buffer.from(xml, "utf8");
}

const total = cadenasExistentes.length + nuevas.length;
const siNuevas = nuevas.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join("");

if (ssEntry) {
  const xml = ssEntry.contenido.toString("utf8");
  ssEntry.contenido = Buffer.from(
    xml
      .replace(/<sst([^>]*)>/, (_, a) =>
        `<sst${a
          .replace(/count="\d+"/, `count="${total}"`)
          .replace(/uniqueCount="\d+"/, `uniqueCount="${total}"`)}>`)
      .replace(/<\/sst>/, `${siNuevas}</sst>`),
    "utf8",
  );
} else {
  // El archivo del cliente no tiene sharedStrings.xml: crearlo entero y registrarlo en
  // [Content_Types].xml + xl/_rels/workbook.xml.rels, o Excel/LibreOffice lo ignoran.
  const nuevoXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${total}" uniqueCount="${total}">` +
    siNuevas +
    `</sst>`;
  entradas.push({ nombre: "xl/sharedStrings.xml", contenido: Buffer.from(nuevoXml, "utf8") });

  const ct = entradas.find((e) => e.nombre === "[Content_Types].xml");
  if (!ct.contenido.toString("utf8").includes("sharedStrings")) {
    ct.contenido = Buffer.from(
      ct.contenido.toString("utf8").replace(
        "</Types>",
        `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
      ),
      "utf8",
    );
  }

  const rels = entradas.find((e) => e.nombre === "xl/_rels/workbook.xml.rels");
  const relsXml = rels.contenido.toString("utf8");
  if (!relsXml.includes("sharedStrings")) {
    const idsUsados = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
    const nextId = Math.max(0, ...idsUsados) + 1;
    rels.contenido = Buffer.from(
      relsXml.replace(
        "</Relationships>",
        `<Relationship Id="rId${nextId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
      ),
      "utf8",
    );
  }
}

guardar(entradas);
console.log(`Escrito ${XLSX}.`);
