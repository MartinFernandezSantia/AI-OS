// Agrega los 5 productos de datos-offset-pliego.mjs a la hoja Productos. Los materiales ya
// existen en Materiales con su escala completa (carga previa del cliente); solo faltaba
// exponerlos con un producto, si no quedan huérfanos y sin chunk.
//
//   node visor/scripts/cargar-offset-pliego.mjs          → dry run
//   node visor/scripts/cargar-offset-pliego.mjs --apply
import { XLSX, chequearLock, abrir, cadenasDe, dec, esc, relsDe, valorCelda, indiceCadenas, guardar } from "./lib-xlsx.mjs";
import { PRODUCTOS } from "./datos-offset-pliego.mjs";

const APLICAR = process.argv.includes("--apply");

chequearLock();

const { entradas, get, getOpcional } = abrir();
const leer = (n) => get(n).contenido.toString("utf8");

const HOJAS = [...leer("xl/workbook.xml").matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => {
  const attrs = m[1];
  return {
    nombre: dec(attrs.match(/\bname="([^"]+)"/)?.[1] ?? ""),
    rid: attrs.match(/r:id="(rId\d+)"/)?.[1],
  };
});
const RELS = relsDe(leer("xl/_rels/workbook.xml.rels"));
const rutaDe = (hoja) => {
  const h = HOJAS.find((x) => x.nombre === hoja);
  if (!h) throw new Error(`el Excel no tiene la hoja "${hoja}"`);
  return "xl/" + RELS[h.rid];
};

const ssEntry = getOpcional("xl/sharedStrings.xml");
const SS = indiceCadenas(ssEntry ?? { contenido: Buffer.from("<sst/>", "utf8") });
const CADENAS = cadenasDe(ssEntry ? leer("xl/sharedStrings.xml") : "");

const LETRA = (i) => String.fromCharCode(65 + i);

/** Encabezado (fila 1) y última fila de una hoja, tolerando t="s"/inlineStr/crudo. */
function inspeccionar(hoja) {
  const xml = leer(rutaDe(hoja));
  let ultima = 0;
  const encabezado = [];
  const estilos = {};
  for (const f of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const n = Number(f[1]);
    ultima = Math.max(ultima, n);
    for (const c of f[2].matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = c[1].charCodeAt(0) - 65;
      const texto = valorCelda(c[3], c[4], CADENAS);
      if (n === 1) encabezado[col] = texto ?? null;
      if (n === 2) {
        const s = c[3].match(/\bs="(\d+)"/);
        if (s) estilos[c[1]] = s[1];
      }
    }
  }
  return { xml, encabezado, ultima, estilos };
}

function celda(letra, fila, valor, estilos) {
  if (valor === null || valor === undefined || valor === "") return "";
  const s = estilos[letra] ? ` s="${estilos[letra]}"` : "";
  if (typeof valor === "number") return `<c r="${letra}${fila}"${s} t="n"><v>${valor}</v></c>`;
  return `<c r="${letra}${fila}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(valor))}</t></is></c>`;
}

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

// Productos: Colección | Producto | Descripción | Material | Ancho | Alto | Piezas por
// unidad de cobro | Sinónimos | Formato. La primera columna de Productos es Colección, no
// el nombre: idempotencia por la columna Producto.
const { encabezado } = inspeccionar("Productos");
const xmlP = leer(rutaDe("Productos"));
const iProd = encabezado.indexOf("Producto");
const existentes = new Set();
for (const f of xmlP.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
  if (Number(f[1]) === 1) continue;
  const c = f[2].match(new RegExp(`<c r="${LETRA(iProd)}\\d+"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`));
  if (!c) continue;
  const v = valorCelda(c[1], c[2], CADENAS);
  if (v !== undefined) existentes.add(String(v).trim());
}

const iSin = encabezado.indexOf("Sinónimos");
const iFmt = encabezado.indexOf("Formato");
if (iFmt < 0) throw new Error('falta la columna "Formato" en Productos');

const nuevos = PRODUCTOS.filter((p) => !existentes.has(p.producto));
const saltados = PRODUCTOS.length - nuevos.length;
const filas = nuevos.map((p) => {
  const fila = [p.coleccion, p.producto, p.descripcion ?? "", p.material, p.medida?.[0] ?? "", p.medida?.[1] ?? "", ""];
  if (iSin >= 0 && p.sinonimos) fila[iSin] = p.sinonimos;
  if (p.formato) fila[iFmt] = p.formato;
  return fila;
});

const { xml, agregadas } = agregar("Productos", filas);

console.log(`Productos          +${String(agregadas).padStart(3)} filas${saltados ? `  (${saltados} ya estaban)` : ""}`);
if (nuevos.length) console.log(`    ${nuevos.map((p) => p.producto).join(" · ")}`);
console.log(`\n${SS.nuevas()} cadena(s) nueva(s) a sharedStrings (no hacen falta: se escribe inlineStr).`);

if (!APLICAR) {
  console.log("DRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}
if (!agregadas) {
  console.log("No hay nada que agregar.");
  process.exit(0);
}

get(rutaDe("Productos")).contenido = Buffer.from(xml, "utf8");
guardar(entradas);
console.log(`Escrito ${XLSX}.`);
