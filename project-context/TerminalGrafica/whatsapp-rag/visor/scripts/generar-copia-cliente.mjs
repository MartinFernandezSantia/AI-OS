// Genera la COPIA DEL CATÁLOGO PARA EL CLIENTE a partir de Catalogo-TG-v3-wip.xlsx.
//
// Qué hace, en orden:
//   1. Aborta si el destino ya existe (salvo --force) o si origen/destino están lockeados.
//   2. Borra las hojas "Parámetros" y "Casos de prueba" (motor de pruebas interno) tocando
//      workbook.xml + workbook.xml.rels + [Content_Types].xml + el array de entradas del ZIP.
//      Los r:id/sheetId de las hojas restantes NO se renumeran (los huecos son válidos).
//   3. Agrega la hoja "Pendientes" (vacía, 4 columnas de texto libre: Producto, Descripción,
//      Cómo se cobra, Notas) reusando el r:id/sheetId/archivo que quedaron libres al borrar
//      "Parámetros" — para que el cliente anote ahí un producto que no encaja en ninguna
//      forma de cobro del catálogo, en vez de forzarlo. Se ubica después de Materiales y
//      antes de "_listas" (oculta).
//   4. Deja la vista inicial en "Instrucciones" (activeTab, tabSelected, topLeftCell/activeCell A1).
//   5. Hornea los valores cacheados <v> de las 598 fórmulas array de "_listas" (si no,
//      Excel puede abrir con los dropdowns vacíos hasta el primer recálculo).
//   6. Marca docProps/core.xml con un título para el cliente.
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
import { cadenasDe, dec, empaquetar, esc, indiceCadenas } from "./lib-xlsx.mjs";

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

// ── 4.5) agregar la hoja "Pendientes" (solo en la copia cliente) ──────────────────────
//
// Para cuando el cliente quiere cargar un producto cuya forma de cobro no encaja con el
// catálogo (ver "LO QUE NO ENCAJA" en instrucciones-cliente.md): lo anota acá en vez de
// forzarlo a pliego/m2/item. 4 columnas de texto libre, sin dropdowns, hoja vacía lista
// para completar. Reusa el rId y el número de sheetN.xml que quedaron libres al borrar
// "Parámetros" (rId7 → sheet5.xml, sheetId 5) — más simple que inventar uno nuevo y
// perfectamente válido (huecos en sheetId/rId son legales en OOXML, como ya asume este
// mismo script para las hojas que NO se renumeran tras el borrado).
const PENDIENTES_NOMBRE = "Pendientes";
const PENDIENTES_SHEET_ID = 5; // libre: era el sheetId de "Parámetros"
const PENDIENTES_RID = "rId7"; // libre: era el r:id de "Parámetros"
const PENDIENTES_ARCHIVO_REL = "worksheets/sheet5.xml"; // libre: era el archivo de "Parámetros"
const PENDIENTES_ARCHIVO_ZIP = `xl/${PENDIENTES_ARCHIVO_REL}`;
const PENDIENTES_ENCABEZADOS = ["Producto", "Descripción", "Cómo se cobra", "Notas"];

if (entradasNuevas.some((e) => e.nombre === PENDIENTES_ARCHIVO_ZIP)) {
  throw new Error(`${PENDIENTES_ARCHIVO_ZIP} ya existe — el rId/archivo elegido para "Pendientes" no está libre`);
}
if (hojasWb.some((h) => h.nombre === PENDIENTES_NOMBRE)) {
  throw new Error(`ya existe una hoja "${PENDIENTES_NOMBRE}" en el origen — no debería`);
}

// Registrar los 4 encabezados en sharedStrings (reusa si ya existieran, agrega si no).
const ssEntradaPend = entradasNuevas.find((e) => e.nombre === "xl/sharedStrings.xml");
if (!ssEntradaPend) throw new Error("no está xl/sharedStrings.xml — no se puede registrar la hoja Pendientes");
const indicePend = indiceCadenas(ssEntradaPend);
const idxEncabezados = PENDIENTES_ENCABEZADOS.map((t) => indicePend.idDe(t));
indicePend.aplicar();

// style s="5" = el estilo de header que ya usan todas las hojas de datos (font blanco
// bold, fill oscuro sólido) — ver sheet2.xml (Colecciones) fila 1. Nada nuevo en styles.xml.
const HEADER_S = 5;
const filaHeader =
  `<row r="1" customFormat="false" ht="28" hidden="false" customHeight="true" outlineLevel="0" collapsed="false">` +
  idxEncabezados
    .map((idx, i) => `<c r="${String.fromCharCode(65 + i)}1" s="${HEADER_S}" t="s"><v>${idx}</v></c>`)
    .join("") +
  `</row>`;

const ULTIMA_FILA = 300; // mismo tope que usan los dataValidation de sqref en otras hojas (p. ej. C2:C300 en Colecciones)
const pendientesXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xr2="http://schemas.microsoft.com/office/spreadsheetml/2015/revision2" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
  `<sheetPr filterMode="false"><pageSetUpPr fitToPage="false"/></sheetPr>` +
  `<dimension ref="A1:D${ULTIMA_FILA}"/>` +
  `<sheetViews><sheetView showFormulas="false" showGridLines="true" showRowColHeaders="true" showZeros="true" rightToLeft="false" tabSelected="false" showOutlineSymbols="true" defaultGridColor="true" view="normal" topLeftCell="A1" colorId="64" zoomScale="100" zoomScaleNormal="100" zoomScalePageLayoutView="100" workbookViewId="0">` +
  `<pane xSplit="0" ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
  `<selection pane="topLeft" activeCell="A1" activeCellId="0" sqref="A1"/>` +
  `<selection pane="bottomLeft" activeCell="A2" activeCellId="1" sqref="A2"/>` +
  `</sheetView></sheetViews>` +
  `<sheetFormatPr defaultColWidth="8.54296875" defaultRowHeight="15" customHeight="true" zeroHeight="false" outlineLevelRow="0" outlineLevelCol="0"></sheetFormatPr>` +
  `<cols>` +
  `<col collapsed="false" customWidth="true" hidden="false" outlineLevel="0" max="1" min="1" style="0" width="26"/>` +
  `<col collapsed="false" customWidth="true" hidden="false" outlineLevel="0" max="2" min="2" style="0" width="45"/>` +
  `<col collapsed="false" customWidth="true" hidden="false" outlineLevel="0" max="3" min="3" style="0" width="45"/>` +
  `<col collapsed="false" customWidth="true" hidden="false" outlineLevel="0" max="4" min="4" style="0" width="34"/>` +
  `</cols>` +
  `<sheetData>${filaHeader}</sheetData>` +
  `<printOptions headings="false" gridLines="false" gridLinesSet="true" horizontalCentered="false" verticalCentered="false"/>` +
  `<pageMargins left="0.747916666666667" right="0.747916666666667" top="0.984027777777778" bottom="0.984027777777778" header="0.511811023622047" footer="0.511811023622047"/>` +
  `<pageSetup paperSize="9" scale="100" fitToWidth="1" fitToHeight="1" pageOrder="downThenOver" orientation="portrait" blackAndWhite="false" draft="false" cellComments="none" horizontalDpi="300" verticalDpi="300" copies="1"/>` +
  `<headerFooter differentFirst="false" differentOddEven="false"><oddHeader></oddHeader><oddFooter></oddFooter></headerFooter>` +
  `</worksheet>`;

entradasNuevas.push({ nombre: PENDIENTES_ARCHIVO_ZIP, contenido: Buffer.from(pendientesXml, "utf8") });

// workbook.xml: agregar <sheet> al final de <sheets> — <sheets> cierra justo antes de
// <definedNames>, y como "_listas" es la última hoja (oculta, al final siempre), anclar
// ahí inserta a Pendientes INMEDIATAMENTE ANTES de "_listas". Orden final de pestañas:
// Instrucciones, Colecciones, Productos, Materiales, Pendientes, _listas (oculta).
const sheetTagListas = hojasWb.find((h) => h.nombre === "_listas")?.tag;
if (!sheetTagListas) throw new Error('no se encontró el <sheet> de "_listas" en workbook.xml para anclar la inserción');
if (!wbNuevo.includes(sheetTagListas)) throw new Error('no se pudo anclar el <sheet> de "_listas" en el workbook.xml ya editado');
const sheetTagPendientes = `<sheet name="${esc(PENDIENTES_NOMBRE)}" sheetId="${PENDIENTES_SHEET_ID}" state="visible" r:id="${PENDIENTES_RID}"/>`;
wbNuevo = wbNuevo.replace(sheetTagListas, `${sheetTagPendientes}${sheetTagListas}`);

// xl/_rels/workbook.xml.rels: agregar la Relationship de Pendientes (al final, antes de </Relationships>).
const relPendientes = `<Relationship Id="${PENDIENTES_RID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${PENDIENTES_ARCHIVO_REL}"/>`;
if (!/<\/Relationships>/.test(relsNuevo)) throw new Error("no se encontró </Relationships> para insertar la Relationship de Pendientes");
relsNuevo = relsNuevo.replace(/<\/Relationships>/, `${relPendientes}</Relationships>`);

// [Content_Types].xml: agregar el Override de sheet5.xml (mismo ContentType que las demás
// hojas de worksheet), al final antes de </Types>.
const overridePendientes = `<Override PartName="/${PENDIENTES_ARCHIVO_ZIP}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
if (!/<\/Types>/.test(ctNuevo)) throw new Error("no se encontró </Types> para insertar el Override de Pendientes");
ctNuevo = ctNuevo.replace(/<\/Types>/, `${overridePendientes}</Types>`);

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
console.log(`hoja agregada: "${PENDIENTES_NOMBRE}" (${PENDIENTES_RID} → ${PENDIENTES_ARCHIVO_ZIP}, sheetId=${PENDIENTES_SHEET_ID}) — vacía, encabezados: ${PENDIENTES_ENCABEZADOS.join(" | ")}`);
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
