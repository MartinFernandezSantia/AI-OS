// Porta las hojas "Parámetros" y "Casos de prueba" del v3 al catálogo apuntado por CATALOGO=.
//
// Por qué: la copia que manda el cliente NO trae esas dos hojas (son el motor de pruebas
// interno, ver generar-copia-cliente.mjs que las QUITA a propósito). Sin "Parámetros" el
// build ni arranca (paramNum() revienta si falta "Mínimo por trabajo" o "Redondeo"), y sin
// "Casos de prueba" no hay contra qué correr el gate. Es la operación inversa a
// generar-copia-cliente.mjs: en vez de borrar hojas del v3, las AGREGA al catálogo destino.
//
// Solo copia DATOS (texto/número), no fórmulas ni dataValidation — ninguna de las dos hojas
// las tiene (verificado: son tablas simples, Parámetros 4 filas, Casos de prueba 132+1).
// Los estilos del origen NO se preservan tal cual (el destino puede tener su propio
// styles.xml con otra cantidad de cellXfs, típico si pasó por openpyxl): las celdas de
// datos salen sin estilo especial y el header reusa el mismo estilo que ya usan las demás
// hojas de datos del destino (autodetectado desde la fila 1 de "Materiales").
//
//   CATALOGO=../Catalogo-TG-v4-wip.xlsx node visor/scripts/portar-hojas.mjs           (dry run)
//   CATALOGO=../Catalogo-TG-v4-wip.xlsx node visor/scripts/portar-hojas.mjs --apply

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { XLSX, chequearLock, abrir, cadenasDe, dec, esc, relsDe, valorCelda, guardar } from "./lib-xlsx.mjs";

const APLICAR = process.argv.includes("--apply");
const ORIGEN = path.resolve(import.meta.dirname, "../../Catalogo-TG-v3.xlsx");
const HOJAS_A_PORTAR = ["Parámetros", "Casos de prueba"];

// ── leer el origen (v3) ─────────────────────────────────────────────────────────────────

function abrirDe(ruta) {
  const buf = fs.readFileSync(ruta);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  const nEnt = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entradas = [];
  for (let e = 0; e < nEnt; e++) {
    const metodo = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nl = buf.readUInt16LE(off + 28);
    const xl = buf.readUInt16LE(off + 30);
    const cl = buf.readUInt16LE(off + 32);
    const lo = buf.readUInt32LE(off + 42);
    const nombre = buf.toString("utf8", off + 46, off + 46 + nl);
    off += 46 + nl + xl + cl;
    const lnl = buf.readUInt16LE(lo + 26);
    const lxl = buf.readUInt16LE(lo + 28);
    const ini = lo + 30 + lnl + lxl;
    const d = buf.subarray(ini, ini + csize);
    entradas.push({ nombre, contenido: metodo === 0 ? d : zlib.inflateRawSync(d) });
  }
  const get = (n) => {
    const e = entradas.find((x) => x.nombre === n);
    if (!e) throw new Error(`${ruta}: no existe la entrada ${n}`);
    return e;
  };
  return { get };
}

if (!fs.existsSync(ORIGEN)) throw new Error(`no existe el origen ${ORIGEN}`);
const origen = abrirDe(ORIGEN);
const wbOrigen = origen.get("xl/workbook.xml").contenido.toString("utf8");
const ridOrigen = relsDe(origen.get("xl/_rels/workbook.xml.rels").contenido.toString("utf8"));
const cadenasOrigen = cadenasDe(origen.get("xl/sharedStrings.xml").contenido.toString("utf8"));

const sheetTagsOrigen = [...wbOrigen.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => m[0]);
const hojasOrigen = sheetTagsOrigen.map((tag) => ({
  tag,
  nombre: dec(tag.match(/\bname="([^"]*)"/)?.[1] ?? ""),
  rid: tag.match(/\br:id="([^"]*)"/)?.[1],
}));

function filasDeOrigen(nombreHoja) {
  const h = hojasOrigen.find((x) => x.nombre === nombreHoja);
  if (!h) throw new Error(`el origen no tiene la hoja "${nombreHoja}"`);
  const archivo = "xl/" + ridOrigen[h.rid];
  const xml = origen.get(archivo).contenido.toString("utf8");
  const filas = [];
  for (const f of xml.matchAll(/<row[^>]*\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    if (!f[2]) continue;
    const celdas = {};
    for (const c of f[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const val = valorCelda(c[2], c[3] ?? "", cadenasOrigen);
      if (val !== undefined) celdas[c[1]] = val;
    }
    if (Object.keys(celdas).length) filas.push({ n: Number(f[1]), celdas });
  }
  return filas;
}

const datosAPortar = HOJAS_A_PORTAR.map((nombre) => ({ nombre, filas: filasDeOrigen(nombre) }));
for (const { nombre, filas } of datosAPortar) {
  console.log(`"${nombre}": ${filas.length} filas (incluye header) leídas de ${path.basename(ORIGEN)}.`);
}

// ── destino (CATALOGO=) ─────────────────────────────────────────────────────────────────

const { entradas, get } = abrir();
const leer = (n) => get(n).contenido.toString("utf8");

const wbDestino = leer("xl/workbook.xml");
const hojasDestino = [...wbDestino.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => ({
  tag: m[0],
  nombre: dec(m[0].match(/\bname="([^"]*)"/)?.[1] ?? ""),
}));

const yaEstan = HOJAS_A_PORTAR.filter((n) => hojasDestino.some((h) => h.nombre === n));
if (yaEstan.length === HOJAS_A_PORTAR.length) {
  console.log("Las dos hojas ya están en el destino. Nada que hacer.");
  process.exit(0);
}
if (yaEstan.length) {
  throw new Error(`el destino ya tiene "${yaEstan.join(", ")}" pero no la otra — estado a medio portar, revisar a mano`);
}

const relsDestinoXml = leer("xl/_rels/workbook.xml.rels");
const ridMapDestino = relsDe(relsDestinoXml);
const sheetIdsUsados = [...wbDestino.matchAll(/\bsheetId="(\d+)"/g)].map((m) => Number(m[1]));
const ridsUsados = [...relsDestinoXml.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]));
const archivosUsados = new Set(Object.values(ridMapDestino));

let proximoSheetId = Math.max(0, ...sheetIdsUsados) + 1;
let proximoRid = Math.max(0, ...ridsUsados) + 1;
function proximoArchivoLibre() {
  for (let n = 1; ; n++) {
    const cand = `worksheets/sheet${n}.xml`;
    if (!archivosUsados.has(cand)) return cand;
  }
}

// Estilo de header a reusar en las hojas nuevas: el que usa la fila 1 de "Materiales" en
// el destino (mismo criterio que generar-copia-cliente.mjs usa para "Pendientes").
const materialesTag = hojasDestino.find((h) => h.nombre === "Materiales")?.tag;
if (!materialesTag) throw new Error('el destino no tiene una hoja "Materiales" de la que copiar el estilo de header');
const ridMateriales = materialesTag.match(/\br:id="([^"]*)"/)?.[1];
const xmlMateriales = leer("xl/" + ridMapDestino[ridMateriales]);
const HEADER_S = xmlMateriales.match(/<c r="A1"\s+s="(\d+)"/)?.[1] ?? "0";
console.log(`estilo de header reusado del destino: s="${HEADER_S}"`);

// Registrar cadenas nuevas en el sharedStrings del destino.
const ssEntry = get("xl/sharedStrings.xml");
const cadenasDestino = cadenasDe(ssEntry.contenido.toString("utf8"));
const indice = new Map(cadenasDestino.map((t, i) => [t, i]).reverse());
const nuevasCadenas = [];
function idDe(t) {
  if (indice.has(t)) return indice.get(t);
  const id = cadenasDestino.length + nuevasCadenas.length;
  nuevasCadenas.push(t);
  indice.set(t, id);
  return id;
}

function colALetra(letra) { return letra; } // ya viene como letra desde valorCelda's caller

function celdaXml(col, n, valor, esHeader) {
  const ref = `${col}${n}`;
  if (valor === undefined || valor === null || valor === "") return "";
  if (typeof valor === "number" || (/^-?\d+(\.\d+)?$/.test(String(valor)) && String(valor).trim() !== "")) {
    // Números: t="n" (sin índice de sharedStrings), igual que valorCelda los devuelve
    // decodificados como string — pero acá conviene preservar el tipo numérico real.
    return `<c r="${ref}"${esHeader ? ` s="${HEADER_S}"` : ""} t="n"><v>${valor}</v></c>`;
  }
  return `<c r="${ref}"${esHeader ? ` s="${HEADER_S}"` : ""} t="s"><v>${idDe(String(valor))}</v></c>`;
}

function hojaXmlDe(filas) {
  const maxCol = filas.reduce((acc, f) => {
    const cols = Object.keys(f.celdas);
    const m = cols.reduce((a, c) => (c.length > a.length || c > a ? c : a), "A");
    return m > acc ? m : acc;
  }, "A");
  const maxFila = Math.max(...filas.map((f) => f.n));
  const filasXml = filas
    .map((f) => {
      const celdas = Object.entries(f.celdas)
        .map(([col, val]) => celdaXml(col, f.n, val, f.n === 1))
        .join("");
      if (!celdas) return "";
      return `<row r="${f.n}">${celdas}</row>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${maxCol}${maxFila}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane xSplit="0" ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetData>${filasXml}</sheetData>` +
    `</worksheet>`
  );
}

// ── armar las 3 hojas a insertar (mismo orden que HOJAS_A_PORTAR) ─────────────────────

const nuevasHojas = datosAPortar.map(({ nombre, filas }) => {
  const sheetId = proximoSheetId++;
  const rid = `rId${proximoRid++}`;
  const archivoRel = proximoArchivoLibre();
  archivosUsados.add(archivoRel);
  return { nombre, sheetId, rid, archivoRel, archivoZip: `xl/${archivoRel}`, xml: hojaXmlDe(filas) };
});

console.log("\nhojas a insertar:");
for (const h of nuevasHojas) console.log(`  ${h.nombre.padEnd(20)} sheetId=${h.sheetId} ${h.rid} → ${h.archivoZip}`);
console.log(`\n${nuevasCadenas.length} cadena(s) nueva(s) en sharedStrings.`);

if (!APLICAR) {
  console.log("\nDRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}

chequearLock();

// 1) workbook.xml: insertar <sheet> ANTES de "_listas" (que debe quedar última).
const tagListas = hojasDestino.find((h) => h.nombre === "_listas")?.tag;
if (!tagListas) throw new Error('el destino no tiene "_listas" — no se sabe dónde insertar');
let wbNuevo = wbDestino.replace(
  tagListas,
  nuevasHojas.map((h) => `<sheet name="${esc(h.nombre)}" sheetId="${h.sheetId}" state="visible" r:id="${h.rid}"/>`).join("") + tagListas,
);

// 2) workbook.xml.rels: agregar las <Relationship>.
let relsNuevo = relsDestinoXml.replace(
  "</Relationships>",
  nuevasHojas
    .map((h) => `<Relationship Id="${h.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${h.archivoRel}"/>`)
    .join("") + "</Relationships>",
);

// 3) [Content_Types].xml: agregar los <Override>.
const ctXml = leer("[Content_Types].xml");
let ctNuevo = ctXml.replace(
  "</Types>",
  nuevasHojas
    .map((h) => `<Override PartName="/${h.archivoZip}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("") + "</Types>",
);

// 4) sharedStrings.xml: agregar las cadenas nuevas.
const totalCadenas = cadenasDestino.length + nuevasCadenas.length;
const ssXml = ssEntry.contenido.toString("utf8");
const siExtra = nuevasCadenas.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join("");
const ssNuevo = ssXml
  .replace(/<sst([^>]*)>/, (_, a) =>
    `<sst${a.replace(/count="\d+"/, `count="${totalCadenas}"`).replace(/uniqueCount="\d+"/, `uniqueCount="${totalCadenas}"`)}>`)
  .replace(/<\/sst>/, `${siExtra}</sst>`);

// 5) aplicar todo + agregar las entradas nuevas del ZIP.
get("xl/workbook.xml").contenido = Buffer.from(wbNuevo, "utf8");
get("xl/_rels/workbook.xml.rels").contenido = Buffer.from(relsNuevo, "utf8");
get("[Content_Types].xml").contenido = Buffer.from(ctNuevo, "utf8");
ssEntry.contenido = Buffer.from(ssNuevo, "utf8");
for (const h of nuevasHojas) entradas.push({ nombre: h.archivoZip, contenido: Buffer.from(h.xml, "utf8") });

guardar(entradas);
console.log(`\nEscrito ${XLSX}.`);
