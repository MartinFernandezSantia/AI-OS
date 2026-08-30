// Carga los productos que mandó el cliente en NUESTRO Excel: agrega filas a Colecciones,
// Productos, Materiales y Casos de prueba. Los datos están en datos-productos-nuevos.mjs.
//
// Idempotente: lo que ya está cargado (por nombre exacto) se saltea. Se puede correr de
// nuevo después de editar los datos y solo agrega lo que falta.
//
//   node visor/scripts/cargar-productos-nuevos.mjs          → dry run
//   node visor/scripts/cargar-productos-nuevos.mjs --apply
//   CATALOGO=../Catalogo-TG-v3.xlsx node …                  → sobre otra copia
import { XLSX, chequearLock, abrir, cadenasDe, dec, indiceCadenas, guardar } from "./lib-xlsx.mjs";
import { COLECCIONES, MATERIALES, PRODUCTOS, CASOS } from "./datos-productos-nuevos.mjs";

const APLICAR = process.argv.includes("--apply");

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
const rutaDe = (hoja) => {
  const h = HOJAS.find((x) => x.nombre === hoja);
  if (!h) throw new Error(`el Excel no tiene la hoja "${hoja}"`);
  return "xl/" + RID[h.rid].replace(/^\//, "");
};

const SS = indiceCadenas(entradaDe("xl/sharedStrings.xml"));
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));

const LETRA = (i) => String.fromCharCode(65 + i); // 0 → "A"

/** Lee una hoja: encabezado, valores de la primera columna, última fila y estilos por columna. */
function inspeccionar(hoja) {
  const xml = leer(rutaDe(hoja));
  let ultima = 0;
  const encabezado = [];
  const primeraCol = new Set();
  const estilos = {}; // letra de columna → s="" de una fila de DATOS
  for (const f of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const n = Number(f[1]);
    ultima = Math.max(ultima, n);
    for (const c of f[2].matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = (c[4] || "").match(/<v>([\s\S]*?)<\/v>/);
      const texto = v ? (/t="s"/.test(c[3]) ? CADENAS[Number(v[1])] : v[1]) : null;
      if (n === 1) encabezado[c[1].charCodeAt(0) - 65] = texto;
      else {
        if (c[1] === "A" && texto !== null) primeraCol.add(String(texto).trim());
        // El estilo de la SEGUNDA fila (primera de datos) es el que se replica.
        if (n === 2) {
          const s = c[3].match(/s="(\d+)"/);
          if (s) estilos[c[1]] = s[1];
        }
      }
    }
  }
  return { xml, encabezado, primeraCol, ultima, estilos };
}

/** Una celda: number si es numérica, cadena compartida si es texto, nada si viene vacía. */
function celda(letra, fila, valor, estilos) {
  if (valor === null || valor === undefined || valor === "") return "";
  const s = estilos[letra] ? ` s="${estilos[letra]}"` : "";
  if (typeof valor === "number") return `<c r="${letra}${fila}"${s} t="n"><v>${valor}</v></c>`;
  return `<c r="${letra}${fila}"${s} t="s"><v>${SS.idDe(String(valor))}</v></c>`;
}

/** Agrega filas al final de una hoja. `filas` son arrays alineados al ENCABEZADO. */
function agregar(hoja, filas) {
  const { xml, encabezado, ultima, estilos } = inspeccionar(hoja);
  if (!filas.length) return { xml, agregadas: 0, encabezado };
  const nuevas = filas
    .map((valores, i) => {
      const n = ultima + 1 + i;
      const celdas = valores.map((v, j) => celda(LETRA(j), n, v, estilos)).join("");
      return `<row r="${n}">${celdas}</row>`;
    })
    .join("");
  return { xml: xml.replace(/<\/sheetData>/, `${nuevas}</sheetData>`), agregadas: filas.length, encabezado };
}

// ── armar las filas, salteando lo que ya está ─────────────────────────────────────────
const resumen = [];
const escrituras = [];

function preparar(hoja, existentes, items, clave, aFila) {
  const nuevos = items.filter((x) => !existentes.has(clave(x)));
  const saltados = items.length - nuevos.length;
  const { xml, agregadas, encabezado } = agregar(hoja, nuevos.map(aFila));
  resumen.push({ hoja, agregadas, saltados, encabezado, muestra: nuevos.slice(0, 3).map(clave) });
  if (agregadas) escrituras.push({ ruta: rutaDe(hoja), xml });
  return nuevos;
}

// Colecciones: Colección | Descripción | Material base | Sin mínimo por trabajo
{
  const { primeraCol, encabezado } = inspeccionar("Colecciones");
  const iSinMin = encabezado.indexOf("Sin mínimo por trabajo");
  if (iSinMin < 0) throw new Error('falta la columna "Sin mínimo por trabajo" — corré columna-sin-minimo.mjs primero');
  preparar("Colecciones", primeraCol, COLECCIONES, (c) => c.nombre, (c) => {
    const fila = [c.nombre, c.descripcion, ""]; // sin material base: se decide si hace falta
    fila[iSinMin] = c.sinMinimo ? "sí" : "";
    return fila;
  });
}

// Materiales: Material | Unidad | Desde | Hasta | Precio por unidad | Mínimo facturable |
//             Nota | Área útil ancho | Área útil alto | Separación
// Una fila POR TRAMO. Sin geometría: son unidades de cobro no geométricas (modo item).
{
  const { primeraCol, encabezado } = inspeccionar("Materiales");
  const iSinMin = encabezado.indexOf("Sin mínimo por trabajo");
  if (iSinMin < 0) throw new Error('falta la columna "Sin mínimo por trabajo" en Materiales — corré agregar-columna.mjs primero');
  const filas = [];
  const nuevos = [];
  for (const m of MATERIALES) {
    if (primeraCol.has(m.material)) continue;
    nuevos.push(m.material);
    for (const [desde, hasta, precio] of m.tramos) {
      const fila = [m.material, m.unidad, desde, hasta ?? "", precio];
      // La marca va SOLO en la primera fila del material, igual que la geometría: es un
      // dato del material, no del tramo.
      if (m.sinMinimo && filas.every((f) => f[0] !== m.material)) fila[iSinMin] = "sí";
      filas.push(fila);
    }
  }
  const { xml, agregadas } = agregar("Materiales", filas);
  resumen.push({
    hoja: "Materiales",
    agregadas,
    saltados: MATERIALES.length - nuevos.length,
    detalle: `${nuevos.length} materiales → ${filas.length} filas de tramo`,
    muestra: nuevos.slice(0, 3),
  });
  if (agregadas) escrituras.push({ ruta: rutaDe("Materiales"), xml });
}

// Productos: Colección | Producto | Descripción | Material | Ancho | Alto | Piezas por unidad
// El rinde va VACÍO: en modo item no existe (una unidad de cobro es un ítem).
{
  const { primeraCol, encabezado } = inspeccionar("Productos");
  // La primera columna de Productos es Colección, no el nombre: para la idempotencia hace
  // falta mirar la columna Producto.
  const xmlP = leer(rutaDe("Productos"));
  const iProd = encabezado.indexOf("Producto");
  const existentes = new Set();
  for (const f of xmlP.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    if (Number(f[1]) === 1) continue;
    const c = f[2].match(new RegExp(`<c r="${LETRA(iProd)}\\d+"([^>]*?)>([\\s\\S]*?)</c>`));
    const v = c && c[2].match(/<v>([\s\S]*?)<\/v>/);
    if (v) existentes.add(String(/t="s"/.test(c[1]) ? CADENAS[Number(v[1])] : v[1]).trim());
  }
  const iSin = encabezado.indexOf("Sinónimos");
  preparar("Productos", existentes, PRODUCTOS, (p) => p.producto, (p) => {
    const fila = [p.coleccion, p.producto, p.descripcion ?? "", p.material, p.medida?.[0] ?? "", p.medida?.[1] ?? "", ""];
    if (iSin >= 0 && p.sinonimos) fila[iSin] = p.sinonimos;
    return fila;
  });
  void primeraCol;
}

// Casos de prueba: Pedido | Cantidad | Material | Ancho | Alto | Piezas por unidad | Precio
{
  const { primeraCol } = inspeccionar("Casos de prueba");
  preparar("Casos de prueba", primeraCol, CASOS, (c) => c[0], ([pedido, cant, material, a, h, precio]) => [
    pedido, cant, material, a, h, "", precio,
  ]);
}

// ── informe ───────────────────────────────────────────────────────────────────────────
for (const r of resumen) {
  console.log(`${r.hoja.padEnd(18)} +${String(r.agregadas).padStart(3)} filas` +
    `${r.saltados ? `  (${r.saltados} ya estaban)` : ""}${r.detalle ? `  — ${r.detalle}` : ""}`);
  if (r.muestra?.length) console.log(`    ${r.muestra.join(" · ")}${r.agregadas > 3 ? " · …" : ""}`);
}
console.log(`\n${SS.nuevas()} cadena(s) nueva(s) a sharedStrings.`);

if (!APLICAR) {
  console.log("DRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}
if (!escrituras.length) {
  console.log("No hay nada que agregar.");
  process.exit(0);
}

SS.aplicar();
for (const { ruta, xml } of escrituras) entradaDe(ruta).contenido = Buffer.from(xml, "utf8");
guardar(entradas);
console.log(`Escrito ${XLSX}.`);
