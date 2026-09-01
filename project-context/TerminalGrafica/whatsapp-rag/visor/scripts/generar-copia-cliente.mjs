// Genera la COPIA DEL CATÁLOGO PARA EL CLIENTE a partir de Catalogo-TG-v3-wip.xlsx.
//
// Qué hace, en orden:
//   1. Aborta si el destino ya existe (salvo --force) o si origen/destino están lockeados.
//   2. Borra las hojas "Parámetros" y "Casos de prueba" (motor de pruebas interno) tocando
//      workbook.xml + workbook.xml.rels + [Content_Types].xml + el array de entradas del ZIP.
//      Los r:id/sheetId de las hojas restantes NO se renumeran (los huecos son válidos).
//   3. Deja la vista inicial en "Instrucciones" (activeTab, tabSelected, topLeftCell/activeCell A1).
//   4. Hornea los valores cacheados <v> de las 598 fórmulas array de "_listas" (si no,
//      Excel puede abrir con los dropdowns vacíos hasta el primer recálculo).
//   5. Marca docProps/core.xml con un título para el cliente.
//
// Lo que NO hace este script: no toca la hoja "Instrucciones" (eso lo hace, aparte,
// render-instrucciones-cliente.mjs corriendo CATALOGO=Catalogo-TG-cliente.xlsx --apply).
//
// Uso:
//   node visor/scripts/generar-copia-cliente.mjs                  # dry-run
//   node visor/scripts/generar-copia-cliente.mjs --apply          # escribe
//   node visor/scripts/generar-copia-cliente.mjs --apply --force  # pisa el destino si ya existe
//   node visor/scripts/generar-copia-cliente.mjs --apply --sin-cache  # no hornea _listas
//
// Después de correr esto (con --apply):
//   CATALOGO=Catalogo-TG-cliente.xlsx node visor/scripts/render-instrucciones-cliente.mjs --apply

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { cadenasDe, dec, empaquetar } from "./lib-xlsx.mjs";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const SIN_CACHE = process.argv.includes("--sin-cache");
const CACHEAR_LISTAS = !SIN_CACHE;

// Origen FIJO: la copia de trabajo con los fixes del día. Nunca el Catalogo-TG-v3.xlsx
// "oficial" (ese no se toca) ni lo que diga CATALOGO= — este script no es de los que operan
// sobre "el catálogo actual", así que ignora esa convención a propósito.
const ORIGEN = path.resolve(import.meta.dirname, "../../Catalogo-TG-v3-wip.xlsx");
const DESTINO = path.resolve(path.dirname(ORIGEN), "Catalogo-TG-cliente.xlsx");

const HOJAS_A_BORRAR = ["Parámetros", "Casos de prueba"];
const HOJAS_ESPERADAS = [
  "Instrucciones", "Colecciones", "Productos", "Materiales",
  "Parámetros", "Casos de prueba", "_listas",
];

// ── guardas previas ─────────────────────────────────────────────────────────────────────

function chequearLockDe(archivo) {
  const lock = path.join(path.dirname(archivo), `.~lock.${path.basename(archivo)}#`);
  if (fs.existsSync(lock)) {
    console.error(`ABORTADO: "${path.basename(archivo)}" está abierto en LibreOffice (existe ${path.basename(lock)}).`);
    console.error("Cerralo y volvé a correr el script.");
    process.exit(1);
  }
}

chequearLockDe(ORIGEN);
chequearLockDe(DESTINO);

if (!fs.existsSync(ORIGEN)) {
  console.error(`ABORTADO: no existe el origen ${ORIGEN}`);
  process.exit(1);
}

if (fs.existsSync(DESTINO) && !FORCE) {
  console.error(`ABORTADO: ya existe ${DESTINO}.`);
  console.error("Esa copia puede tener trabajo del cliente adentro — pisarla en silencio sería");
  console.error("la peor falla posible de este script. Si estás SEGURO, corré con --force.");
  process.exit(1);
}

// ── abrir el origen (reimplementación local de abrir(), porque lib-xlsx.mjs lee de XLSX
//    fijo vía CATALOGO/env — acá necesitamos leer el origen y escribir a otro archivo) ───

function abrirDe(ruta) {
  const buf = fs.readFileSync(ruta);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${ruta}: no se encontró el EOCD — ¿no es un .xlsx válido?`);
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
    if (!e) throw new Error(`no existe la entrada ${n}`);
    return e;
  };
  return { entradas, get };
}

const { entradas, get } = abrirDe(ORIGEN);

// ── verificar la estructura de hojas esperada ──────────────────────────────────────────

const wbXml = get("xl/workbook.xml").contenido.toString("utf8");

// <sheet name="X" sheetId="N" state="..." r:id="rIdM"/> — self-closing, atributos en
// cualquier orden (LibreOffice). Se captura name + r:id con dos regex ancladas al tag
// completo, no se asume orden de atributos.
const sheetTags = [...wbXml.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => m[0]);
const hojasWb = sheetTags.map((tag) => {
  const nombre = tag.match(/\bname="([^"]*)"/)?.[1];
  const rid = tag.match(/\br:id="([^"]*)"/)?.[1];
  return { tag, nombre, rid };
});

const nombresEncontrados = hojasWb.map((h) => h.nombre);
const faltantes = HOJAS_ESPERADAS.filter((n) => !nombresEncontrados.includes(n));
const sobrantes = nombresEncontrados.filter((n) => !HOJAS_ESPERADAS.includes(n));
if (faltantes.length || sobrantes.length) {
  console.error("ABORTADO: la estructura de hojas cambió respecto de lo esperado.");
  console.error(`esperadas: ${HOJAS_ESPERADAS.join(", ")}`);
  console.error(`encontradas: ${nombresEncontrados.join(", ")}`);
  if (faltantes.length) console.error(`faltan: ${faltantes.join(", ")}`);
  if (sobrantes.length) console.error(`de más: ${sobrantes.join(", ")}`);
  process.exit(1);
}

// ── resolver nombre → r:id → archivo, dinámicamente ────────────────────────────────────

const relsXml = get("xl/_rels/workbook.xml.rels").contenido.toString("utf8");

function archivoDeRid(rid) {
  const tag = relsXml.match(new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*/>`))?.[0]
    ?? relsXml.match(new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*>`))?.[0];
  if (!tag) throw new Error(`no se encontró la Relationship ${rid} en workbook.xml.rels`);
  const target = tag.match(/\bTarget="([^"]*)"/)?.[1];
  if (!target) throw new Error(`Relationship ${rid} sin Target`);
  return target.replace(/^\/?/, ""); // relativo a xl/
}

const aBorrar = HOJAS_A_BORRAR.map((nombre) => {
  const h = hojasWb.find((x) => x.nombre === nombre);
  if (!h) throw new Error(`no se encontró la hoja "${nombre}" en workbook.xml`);
  const archivoRel = archivoDeRid(h.rid); // ej. "worksheets/sheet5.xml"
  const archivoZip = `xl/${archivoRel}`;
  return { nombre, rid: h.rid, sheetTag: h.tag, archivoRel, archivoZip };
});

console.log("hojas a eliminar de la copia cliente:");
for (const h of aBorrar) console.log(`  ${h.nombre.padEnd(20)} ${h.rid}  →  ${h.archivoZip}`);

// ── 1) workbook.xml: eliminar los <sheet> y fijar activeTab=0 ─────────────────────────

let wbNuevo = wbXml;
for (const h of aBorrar) {
  if (!wbNuevo.includes(h.sheetTag)) throw new Error(`no se pudo anclar el <sheet> de "${h.nombre}" para borrarlo`);
  wbNuevo = wbNuevo.replace(h.sheetTag, "");
}
if (!/activeTab="\d+"/.test(wbNuevo)) throw new Error('no se encontró activeTab="N" en workbookView');
wbNuevo = wbNuevo.replace(/activeTab="\d+"/, 'activeTab="0"');

// ── 2) workbook.xml.rels: eliminar las <Relationship> de esas hojas ────────────────────

let relsNuevo = relsXml;
for (const h of aBorrar) {
  const relTag = relsNuevo.match(new RegExp(`<Relationship\\b[^>]*\\bId="${h.rid}"[^>]*/>`))?.[0];
  if (!relTag) throw new Error(`no se pudo anclar la Relationship ${h.rid} para borrarla`);
  relsNuevo = relsNuevo.replace(relTag, "");
}

// ── 3) [Content_Types].xml: eliminar los <Override> de esas hojas ──────────────────────

const ctXml = get("[Content_Types].xml").contenido.toString("utf8");
let ctNuevo = ctXml;
for (const h of aBorrar) {
  const overrideTag = ctNuevo.match(new RegExp(`<Override\\b[^>]*PartName="/${h.archivoZip.replace(/\//g, "\\/")}"[^>]*/>`))?.[0];
  if (!overrideTag) throw new Error(`no se pudo anclar el Override de ${h.archivoZip} para borrarlo`);
  ctNuevo = ctNuevo.replace(overrideTag, "");
}

// ── 4) array de entradas del ZIP: filtrar los archivos de esas hojas ───────────────────

const archivosABorrar = new Set(aBorrar.map((h) => h.archivoZip));
let entradasNuevas = entradas.filter((e) => !archivosABorrar.has(e.nombre));

// ── 5) vista inicial: Instrucciones (sheet1) tabSelected + topLeftCell/activeCell A1 ───

const sheet1Nombre = "xl/worksheets/sheet1.xml";
const sheet1EntradaOrig = entradasNuevas.find((e) => e.nombre === sheet1Nombre);
if (!sheet1EntradaOrig) throw new Error(`no está ${sheet1Nombre} — ¿la hoja Instrucciones dejó de ser sheet1?`);
const primeraHojaWb = hojasWb.find((h) => !HOJAS_A_BORRAR.includes(h.nombre) && archivoDeRid(h.rid) === "worksheets/sheet1.xml");
if (!primeraHojaWb || primeraHojaWb.nombre !== "Instrucciones") {
  throw new Error(`sheet1.xml no corresponde a "Instrucciones" (es "${primeraHojaWb?.nombre}") — revisar antes de fijar la vista inicial`);
}

let sheet1Xml = sheet1EntradaOrig.contenido.toString("utf8");
sheet1Xml = sheet1Xml.replace(/tabSelected="(?:true|false)"/, 'tabSelected="true"');
sheet1Xml = sheet1Xml.replace(/topLeftCell="[^"]*"/, 'topLeftCell="A1"');
if (/activeCell="[^"]*"/.test(sheet1Xml)) sheet1Xml = sheet1Xml.replace(/activeCell="[^"]*"/, 'activeCell="A1"');
if (/sqref="[^"]*"/.test(sheet1Xml)) sheet1Xml = sheet1Xml.replace(/sqref="[^"]*"/, 'sqref="A1"');

// ── 6) hornear los valores cacheados de _listas ────────────────────────────────────────

let cacheados = 0;
let materialesLen = 0, coleccionesLen = 0;

if (CACHEAR_LISTAS) {
  const ss = cadenasDe(get("xl/sharedStrings.xml").contenido.toString("utf8"));

  // Resolver Materiales y Colecciones por nombre → r:id → archivo (no hardcodear sheetN).
  function xmlDeHoja(nombre) {
    const h = hojasWb.find((x) => x.nombre === nombre);
    if (!h) throw new Error(`no se encontró la hoja "${nombre}"`);
    const archivo = `xl/${archivoDeRid(h.rid)}`;
    const entrada = entradasNuevas.find((e) => e.nombre === archivo);
    if (!entrada) throw new Error(`no está la entrada ${archivo} para "${nombre}"`);
    return entrada.contenido.toString("utf8");
  }

  function columnaA(xml, maxRow) {
    const vals = [];
    for (let r = 2; r <= maxRow; r++) {
      const m = xml.match(new RegExp(`<c r="A${r}"[^>]*>([\\s\\S]*?)</c>|<c r="A${r}"[^>]*/>`));
      if (!m) { vals.push(""); continue; }
      const cellTag = m[0];
      const t = cellTag.match(/ t="([^"]*)"/)?.[1] ?? "n";
      const v = cellTag.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (v === undefined) { vals.push(""); continue; }
      vals.push(t === "s" ? (ss[Number(v)] ?? "") : dec(v));
    }
    return vals;
  }

  function unicosEnOrden(arr) {
    const vistos = new Set(), out = [];
    for (const v of arr) {
      if (v === "" || vistos.has(v)) continue;
      vistos.add(v);
      out.push(v);
    }
    return out;
  }

  const materialesUnicos = unicosEnOrden(columnaA(xmlDeHoja("Materiales"), 300));
  const coleccionesUnicos = unicosEnOrden(columnaA(xmlDeHoja("Colecciones"), 300));
  materialesLen = materialesUnicos.length;
  coleccionesLen = coleccionesUnicos.length;

  const hojaListas = hojasWb.find((h) => h.nombre === "_listas");
  if (!hojaListas) throw new Error('no se encontró la hoja "_listas" en workbook.xml');
  const archivoListas = `xl/${archivoDeRid(hojaListas.rid)}`;
  const listasEntrada = entradasNuevas.find((e) => e.nombre === archivoListas);
  if (!listasEntrada) throw new Error(`no está la entrada ${archivoListas} para "_listas"`);

  let listasXml = listasEntrada.contenido.toString("utf8");

  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function inyectarCache(xml, columna, valores) {
    let out = xml;
    let n = 0;
    for (let i = 0; i < valores.length; i++) {
      const fila = i + 2;
      const valor = valores[i];
      if (valor === undefined) continue; // más allá del último valor → resultado "" → sin <v>
      // La celda con la fórmula: <c r="A2" s="8"><f t="array" ref="A2">...</f></c>
      const re = new RegExp(`(<c r="${columna}${fila}"[^>]*>)(<f t="array"[^>]*>[\\s\\S]*?</f>)(</c>)`);
      const m = out.match(re);
      if (!m) throw new Error(`no se encontró la celda ${columna}${fila} con fórmula array en _listas`);
      const vTag = `<v>${esc(valor)}</v>`;
      // t="str" en la CELDA (no en sharedStrings) para un resultado de fórmula que es texto.
      const cAbierta = m[1].includes(' t="') ? m[1] : m[1].replace(/>$/, ' t="str">');
      out = out.replace(m[0], `${cAbierta}${m[2]}${vTag}${m[3]}`);
      n++;
    }
    return { xml: out, n };
  }

  const r1 = inyectarCache(listasXml, "A", materialesUnicos);
  listasXml = r1.xml;
  const r2 = inyectarCache(listasXml, "B", coleccionesUnicos);
  listasXml = r2.xml;
  cacheados = r1.n + r2.n;

  listasEntrada.contenido = Buffer.from(listasXml, "utf8");
}

// ── 7) marcar docProps/core.xml con un título para el cliente ─────────────────────────

const TITULO = "Catálogo Terminal Gráfica — carga de productos";
const coreEntrada = entradasNuevas.find((e) => e.nombre === "docProps/core.xml");
if (!coreEntrada) throw new Error("no está docProps/core.xml");
let coreXml = coreEntrada.contenido.toString("utf8");
if (/<dc:title>[\s\S]*?<\/dc:title>/.test(coreXml)) {
  coreXml = coreXml.replace(/<dc:title>[\s\S]*?<\/dc:title>/, `<dc:title>${TITULO}</dc:title>`);
} else {
  coreXml = coreXml.replace(/<\/cp:coreProperties>/, `<dc:title>${TITULO}</dc:title></cp:coreProperties>`);
}
coreEntrada.contenido = Buffer.from(coreXml, "utf8");

// ── aplicar las mutaciones de texto pendientes a las entradas en memoria ───────────────

entradasNuevas = entradasNuevas.map((e) => {
  if (e.nombre === "xl/workbook.xml") return { ...e, contenido: Buffer.from(wbNuevo, "utf8") };
  if (e.nombre === "xl/_rels/workbook.xml.rels") return { ...e, contenido: Buffer.from(relsNuevo, "utf8") };
  if (e.nombre === "[Content_Types].xml") return { ...e, contenido: Buffer.from(ctNuevo, "utf8") };
  if (e.nombre === sheet1Nombre) return { ...e, contenido: Buffer.from(sheet1Xml, "utf8") };
  return e; // _listas y core.xml ya mutados in-place arriba
});

// ── reporte ─────────────────────────────────────────────────────────────────────────────

console.log(`\norigen:   ${ORIGEN}`);
console.log(`destino:  ${DESTINO}`);
console.log(`\nhojas eliminadas: ${HOJAS_A_BORRAR.join(", ")}`);
console.log(`entradas ZIP: ${entradas.length} → ${entradasNuevas.length}`);
console.log(`activeTab → 0 (Instrucciones), tabSelected/topLeftCell/activeCell → A1 en sheet1`);
console.log(`título docProps/core.xml → "${TITULO}"`);
if (CACHEAR_LISTAS) {
  console.log(`\ncacheo de _listas: ACTIVADO`);
  console.log(`  Materiales!A2:A300 → ${materialesLen} valores únicos`);
  console.log(`  Colecciones!A2:A300 → ${coleccionesLen} valores únicos`);
  console.log(`  celdas <v> inyectadas: ${cacheados}`);
} else {
  console.log(`\ncacheo de _listas: DESACTIVADO (--sin-cache)`);
}

if (!APPLY) {
  console.log("\nDRY RUN — nada escrito. Correr con --apply.");
  process.exit(0);
}

const buf = empaquetar(entradasNuevas);
fs.writeFileSync(DESTINO, buf);
console.log(`\n✓ escrito: ${DESTINO}`);
console.log("\nSiguiente paso (aparte):");
console.log("  CATALOGO=Catalogo-TG-cliente.xlsx node visor/scripts/render-instrucciones-cliente.mjs --apply");
