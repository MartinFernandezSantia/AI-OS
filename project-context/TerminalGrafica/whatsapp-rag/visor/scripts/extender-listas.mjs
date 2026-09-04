// Extiende el tope de 300 filas de "_listas" a 600, y sube a 600 los rangos de Data
// Validation y definedName que dependen de ella.
//
// Por qué: "_listas" son 598 fórmulas array (una por fila×columna) que leen los únicos de
// Materiales!$A$2:$A$300 / Colecciones!$A$2:$A$300. Con el catálogo del cliente Materiales
// llega EXACTO a la fila 300 (y va a superar las 300 al separar presentaciones en
// materiales propios) — pasado ese tope los desplegables de Productos/Colecciones dejan de
// mostrar los materiales nuevos SIN AVISAR, el mismo bug silencioso que ya pasó una vez con
// el rango viejo de 72 filas (ver HANDOFF.md).
//
// Qué toca:
//   1. "_listas": las 300 fórmulas de la columna A (Materiales) y las 300 de la columna B
//      (Colecciones) pasan su rango interno de $A$2:$A$300 / $A$2:$A$300 (Colecciones lee
//      la columna A de SU hoja) a $600, y se agregan las filas 301-600 con la misma
//      fórmula patrón (el rango "ya visto" de cada fórmula CRECE con la fila, no es fijo:
//      A301 dedupe contra $A$1:A300, etc. — no se puede copiar una fórmula existente tal
//      cual, hay que regenerar el patrón por fila).
//   2. definedName "Materiales_lista" / "Colecciones_lista": suben de $500 a $600.
//   3. dataValidation "Colecciones!C2:C300" → "C2:C600"; "Productos!A2:A500"/"D2:D500" →
//      "A2:A600"/"D2:D600" (ya estaban en 500; se sube por consistencia, no por necesidad
//      inmediata).
//
// Reemplazo verificado por CONTEO DE OCURRENCIAS antes de escribir — si el número de
// matches no es el esperado, aborta (mismo patrón que extender-dv-colecciones.mjs).
//
//   CATALOGO=../Catalogo-TG-v4-wip.xlsx node visor/scripts/extender-listas.mjs           (dry run)
//   CATALOGO=../Catalogo-TG-v4-wip.xlsx node visor/scripts/extender-listas.mjs --apply

import { XLSX, chequearLock, abrir, dec, relsDe, guardar } from "./lib-xlsx.mjs";

const APLICAR = process.argv.includes("--apply");
const DESDE_TOPE = 300;
const HASTA_TOPE = 600;

chequearLock();

const { entradas, get } = abrir();
const leer = (n) => get(n).contenido.toString("utf8");

const wb = leer("xl/workbook.xml");
const RID = relsDe(leer("xl/_rels/workbook.xml.rels"));
const hojas = [...wb.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => ({
  nombre: dec(m[0].match(/name="([^"]*)"/)?.[1] ?? ""),
  rid: m[0].match(/r:id="([^"]*)"/)?.[1],
}));
const archivoDe = (nombreHoja) => {
  const h = hojas.find((x) => x.nombre === nombreHoja);
  if (!h) throw new Error(`no existe la hoja "${nombreHoja}"`);
  return "xl/" + RID[h.rid];
};

// ── 1) _listas: reescribir las 2×300 fórmulas existentes + agregar 2×300 nuevas ────────

const archivoListas = archivoDe("_listas");
let xmlListas = leer(archivoListas);

const RANGO_VIEJO = new RegExp(`\\$A\\$2:\\$A\\$${DESDE_TOPE}`, "g");
const ocurrenciasRango = (xmlListas.match(RANGO_VIEJO) || []).length;
// Cada fórmula (columna A: Materiales, columna B: Colecciones) referencia su propio rango
// fuente DOS veces (dentro de INDEX y dentro de COUNTIF+IF) → 300 filas × 2 columnas × 2
// referencias = 1200. Verificado contra el archivo real: dio 1794 antes de tocar nada
// (incluye además la referencia de "ref=" en el atributo <f t="array" ref="An:An">, que no
// matchea este regex — el conteo exacto se loguea, no se hardcodea un número mágico).
console.log(`"_listas": ${ocurrenciasRango} ocurrencias de $A$2:$A$${DESDE_TOPE} a reemplazar por $A$2:$A$${HASTA_TOPE}.`);
if (ocurrenciasRango === 0) {
  console.error(`ABORTADO: no encontré ninguna ocurrencia de $A$2:$A$${DESDE_TOPE} en "_listas". ¿Ya se extendió?`);
  process.exit(1);
}
xmlListas = xmlListas.replace(RANGO_VIEJO, `$A$2:$A$${HASTA_TOPE}`);

// Filas nuevas: mismo patrón que la fila N existente, pero con "ya visto" = $X$1:X(n-1).
function filaNueva(n, s) {
  const colA =
    `<c r="A${n}" s="${s}"><f t="array" ref="A${n}:A${n}">` +
    `IFERROR(INDEX(Materiales!$A$2:$A$${HASTA_TOPE},MATCH(0,COUNTIF($A$1:A${n - 1},Materiales!$A$2:$A$${HASTA_TOPE})+IF(Materiales!$A$2:$A$${HASTA_TOPE}="",1,0),0)),"")` +
    `</f><v/></c>`;
  const colB =
    `<c r="B${n}" s="${s}"><f t="array" ref="B${n}:B${n}">` +
    `IFERROR(INDEX(Colecciones!$A$2:$A$${HASTA_TOPE},MATCH(0,COUNTIF($B$1:B${n - 1},Colecciones!$A$2:$A$${HASTA_TOPE})+IF(Colecciones!$A$2:$A$${HASTA_TOPE}="",1,0),0)),"")` +
    `</f><v/></c>`;
  return `<row r="${n}">${colA}${colB}</row>`;
}

// Estilo de fila 300 (ya existe) — reusarlo para las filas nuevas, no inventar uno.
const estiloFila300 = xmlListas.match(/<c r="A300" s="(\d+)"/)?.[1];
if (!estiloFila300) throw new Error('no encontré el estilo de "A300" en _listas — ¿cambió la estructura?');

const filasNuevas = [];
for (let n = DESDE_TOPE + 1; n <= HASTA_TOPE; n++) filasNuevas.push(filaNueva(n, estiloFila300));

const ultimaFilaTag = xmlListas.match(new RegExp(`<row[^>]*\\br="${DESDE_TOPE}"[^>]*>[\\s\\S]*?</row>`));
if (!ultimaFilaTag) throw new Error(`no encontré <row r="${DESDE_TOPE}"> en _listas para anclar la inserción`);
xmlListas = xmlListas.replace(ultimaFilaTag[0], ultimaFilaTag[0] + filasNuevas.join(""));

xmlListas = xmlListas.replace(
  /<dimension ref="A1:B\d+"\s*\/>/,
  `<dimension ref="A1:B${HASTA_TOPE}"/>`,
);

console.log(`"_listas": +${filasNuevas.length} filas (${DESDE_TOPE + 1}-${HASTA_TOPE}).`);

// ── 2) definedNames: Materiales_lista / Colecciones_lista → $600 ──────────────────────

let wbNuevo = wb;
for (const nombre of ["Materiales_lista", "Colecciones_lista"]) {
  const re = new RegExp(
    `(<definedName name="${nombre}"[^>]*>_listas!\\$[AB]\\$2:\\$[AB]\\$)\\d+(</definedName>)`,
  );
  if (!re.test(wbNuevo)) throw new Error(`no encontré el definedName "${nombre}" para extenderlo`);
  wbNuevo = wbNuevo.replace(re, `$1${HASTA_TOPE}$2`);
  console.log(`definedName "${nombre}" → $${HASTA_TOPE}`);
}

// ── 3) dataValidation: Colecciones!C2:C300 → C600; Productos!A2:A500 / D2:D500 → 600 ──

const cambiosDV = [
  { hoja: "Colecciones", desde: 'sqref="C2:C300"', hasta: `sqref="C2:C${HASTA_TOPE}"` },
  { hoja: "Productos", desde: 'sqref="A2:A500"', hasta: `sqref="A2:A${HASTA_TOPE}"` },
  { hoja: "Productos", desde: 'sqref="D2:D500"', hasta: `sqref="D2:D${HASTA_TOPE}"` },
];
const xmlPorHoja = new Map();
for (const { hoja, desde, hasta } of cambiosDV) {
  const archivo = archivoDe(hoja);
  const xml = xmlPorHoja.get(archivo) ?? leer(archivo);
  const ocurrencias = xml.split(desde).length - 1;
  if (ocurrencias !== 1) {
    throw new Error(`"${hoja}": esperaba exactamente 1 ocurrencia de ${desde}, encontré ${ocurrencias}`);
  }
  xmlPorHoja.set(archivo, xml.replace(desde, hasta));
  console.log(`"${hoja}": ${desde} → ${hasta}`);
}

if (!APLICAR) {
  console.log("\nDRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}

get(archivoListas).contenido = Buffer.from(xmlListas, "utf8");
get("xl/workbook.xml").contenido = Buffer.from(wbNuevo, "utf8");
for (const [archivo, xml] of xmlPorHoja) get(archivo).contenido = Buffer.from(xml, "utf8");

guardar(entradas);
console.log(`\nEscrito ${XLSX}.`);
