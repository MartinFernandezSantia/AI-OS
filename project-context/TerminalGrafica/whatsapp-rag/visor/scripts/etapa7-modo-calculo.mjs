// Etapa 7 del plan flexibilidad-motor-cotizacion.md: columna explícita "Modo de cálculo".
// Unidad queda para lo que TG entiende; la columna declara el modo en claro, con desplegable.
//
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/etapa7-modo-calculo.mjs          (dry run)
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/etapa7-modo-calculo.mjs --apply
//
// Operaciones:
//   1. Materiales: columna O "Modo de cálculo" (al final, tras "Precio total por tramo").
//   2. Carga en los materiales nuevos de las etapas 2-3: Corte a medida=fijo,
//      Troquelado=proporcional (el primer tramo total lo marca la columna N),
//      rifas=tramo total.
//   3. Desplegable: valores en _listas!C2:C5 + definedName Modo_calculo_lista +
//      dataValidation en Materiales O2:O600.
//
// NINGÚN PRECIO SE MUEVE: la columna, para estos materiales, da el mismo modo que el
// prefijo de la unidad. Los 166 casos son la red.

import { XLSX, abrir, cadenasDe, chequearLock, dec, indiceCadenas, relsDe, guardar } from "./lib-xlsx.mjs";

const APPLY = process.argv.includes("--apply");

chequearLock();

const { entradas } = abrir();
const entradaDe = (n) => entradas.find((e) => e.nombre === n);
const leer = (n) => entradaDe(n).contenido.toString("utf8");

const HOJAS = [...leer("xl/workbook.xml").matchAll(/<sheet\b[^>]*\/>/g)].map((m) => ({
  nombre: dec(m[0].match(/\bname="([^"]*)"/)?.[1] ?? ""),
  rid: m[0].match(/\br:id="([^"]*)"/)?.[1],
}));
const RID = relsDe(leer("xl/_rels/workbook.xml.rels"));
const rutaDe = (hoja) => {
  const h = HOJAS.find((x) => x.nombre === hoja);
  if (!h) throw new Error(`el Excel no tiene la hoja "${hoja}"`);
  return "xl/" + RID[h.rid];
};

const SS = indiceCadenas(entradaDe("xl/sharedStrings.xml"));
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));

const VALORES = ["proporcional", "fijo", "tramo total", "superficie"];
const MODOS = [
  ["Corte a medida", "fijo"],
  ["Troquelado (corte con forma en papel)", "proporcional"],
  ["Talonario de rifas 100 números 10x7 cm", "tramo total"],
  ["Talonario de rifas 100 números 15x7 cm", "tramo total"],
];

function valorCeldaDe(attrs, cuerpo) {
  if (/ t="inlineStr"/.test(attrs)) {
    if (!cuerpo) return undefined;
    let t = "";
    for (const tm of cuerpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += dec(tm[1]);
    return t;
  }
  const v = cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (v === undefined) return undefined;
  return / t="s"/.test(attrs) ? (CADENAS[Number(v)] ?? "") : dec(v);
}

// ── 1) Columna O en Materiales ─────────────────────────────────────────────────────────
const rutaMat = rutaDe("Materiales");
let xmlMat = leer(rutaMat);
if (xmlMat.includes('r="O1"')) {
  console.log("Materiales: la columna O ya existe — nada que hacer.");
} else {
  const re = /(<row r="1"[^>]*>)([\s\S]*?)(<\/row>)/;
  const m = xmlMat.match(re);
  const estilo = m && m[2].match(/<c r="N1"([^>]*?)(?:\/>|>)/)?.[1]?.match(/\bs="(\d+)"/);
  const nueva = `${m[1]}${m[2]}<c r="O1"${estilo ? ` s="${estilo[1]}"` : ""} t="s"><v>${SS.idDe("Modo de cálculo")}</v></c>${m[3]}`;
  xmlMat = xmlMat.replace(re, nueva);
  console.log("Materiales: columna O \"Modo de cálculo\" agregada.");
}

// ── 2) Marcar los materiales nuevos (la columna en la PRIMERA fila de cada uno) ────────
let marcadas = 0;
for (const [material, modo] of MODOS) {
  // Encontrar la primera fila del material y agregarle la celda O.
  const reFila = new RegExp(`(<row r="(\\d+)"[^>]*>)([\\s\\S]*?)(<\\/row>)`, "g");
  const coincidencia = [...xmlMat.matchAll(reFila)].find((mm) => {
    const a = mm[3].match(/<c r="A\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/);
    if (!a) return false;
    return valorCeldaDe(a[1], a[2] ?? "") === material;
  });
  if (!coincidencia) {
    console.log(`  ! no encontré el material "${material}"`);
    continue;
  }
  const n = coincidencia[2];
  if (xmlMat.includes(`r="O${n}"`)) {
    console.log(`  ${material}: O${n} ya cargado.`);
    continue;
  }
  const estilo = coincidencia[3].match(/<c r="N\d+"([^>]*?)(?:\/>|>)/)?.[1]?.match(/\bs="(\d+)"/);
  const nueva = `${coincidencia[1]}${coincidencia[3]}<c r="O${n}"${estilo ? ` s="${estilo[1]}"` : ""} t="s"><v>${SS.idDe(modo)}</v></c>${coincidencia[4]}`;
  xmlMat = xmlMat.replace(coincidencia[0], nueva);
  console.log(`  ${material}: O${n} = "${modo}"`);
  marcadas++;
}

// ── 3) Desplegable: _listas + definedName + dataValidation ─────────────────────────────
const rutaListas = rutaDe("_listas");
let xmlListas = leer(rutaListas);
let listasTocadas = 0;
if (xmlListas.includes('r="C1"')) {
  console.log("_listas: la columna C ya existe.");
} else {
  const re1 = /(<row r="1"[^>]*>)([\s\S]*?)(<\/row>)/;
  const m1 = xmlListas.match(re1);
  xmlListas = xmlListas.replace(re1, `${m1[1]}${m1[2]}<c r="C1" t="s"><v>${SS.idDe("Modo de cálculo — desplegable")}</v></c>${m1[3]}`);
  // C2:C5 con los 4 valores (los desplegables de A/B son fórmulas; estos son literales).
  const celdas = VALORES.map((v, i) => `<c r="C${i + 2}" t="s"><v>${SS.idDe(v)}</v></c>`).join("");
  xmlListas = xmlListas.replace(/<\/sheetData>/, `<row r="2">${celdas}</row></sheetData>`);
  listasTocadas = 1;
  console.log("_listas: columna C con los 4 modos.");
}

let xmlWorkbook = leer("xl/workbook.xml");
if (xmlWorkbook.includes('name="Modo_calculo_lista"')) {
  console.log("workbook: el definedName Modo_calculo_lista ya existe.");
} else {
  xmlWorkbook = xmlWorkbook.replace(
    /<\/definedNames>/,
    `<definedName name="Modo_calculo_lista" hidden="0" function="0" vbProcedure="0">_listas!$C$2:$C$5</definedName></definedNames>`,
  );
  console.log("workbook: definedName Modo_calculo_lista agregado.");
}

if (!xmlMat.includes("<dataValidations")) {
  const dv =
    `<dataValidations count="1"><dataValidation sqref="O2:O600" showDropDown="0" showInputMessage="1" showErrorMessage="1" allowBlank="1" ` +
    `errorTitle="Modo de cálculo inválido" error="Elegí uno de la lista: proporcional, superficie, fijo o tramo total." ` +
    `promptTitle="Modo de cálculo" prompt="Cómo se cobra este material. Vacío = se deduce de la Unidad." type="list" ` +
    `errorStyle="stop" operator="between"><formula1>Modo_calculo_lista</formula1><formula2>0</formula2></dataValidation></dataValidations>`;
  xmlMat = xmlMat.replace(/<\/sheetData>/, `</sheetData>${dv}`);
  console.log("Materiales: dataValidation del desplegable agregado (O2:O600).");
} else {
  console.log("Materiales: ya tenía dataValidations — no se toca.");
}

console.log(`\ncatálogo: ${XLSX}`);
console.log(`marcas de modo: ${marcadas} · _listas: ${listasTocadas}`);

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}

entradaDe(rutaMat).contenido = Buffer.from(xmlMat, "utf8");
if (listasTocadas) entradaDe(rutaListas).contenido = Buffer.from(xmlListas, "utf8");
entradaDe("xl/workbook.xml").contenido = Buffer.from(xmlWorkbook, "utf8");
SS.aplicar();
guardar(entradas);
console.log(`\n✓ Escrito ${XLSX}.`);