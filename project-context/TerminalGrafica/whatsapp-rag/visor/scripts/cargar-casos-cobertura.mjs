// Deja la hoja "Casos de prueba" con UNA sola convención: la Cantidad va en PIEZAS, como
// la escribe el cliente ("100 tarjetas" = 100), nunca en unidades de cobro ya convertidas.
//
// Hace dos cosas:
//   1. CORRIGE las 7 filas de materiales por paquete que estaban cargadas en unidades
//      (Cantidad 1 = "un paquete de 100"). Los precios esperados NO cambian.
//   2. AGREGA los 37 casos de datos-casos-cobertura.mjs, uno por cada material que no
//      tenía ninguno. Con ellos los 73 materiales del catálogo quedan cubiertos.
//
// Por qué importa la convención: mientras la hoja cargó la cantidad ya dividida, el gate
// del build NUNCA ejerció la conversión piezas→paquetes — el bug del $54.000.000 que sí
// vive en el auditor de producción. Los casos lo esquivaban por construcción.
//
//   node visor/scripts/cargar-casos-cobertura.mjs          → dry run
//   node visor/scripts/cargar-casos-cobertura.mjs --apply
//   CATALOGO=Catalogo-TG-v3.xlsx node …                    → sobre otra copia
import { XLSX, chequearLock, abrir, cadenasDe, dec, indiceCadenas, guardar } from "./lib-xlsx.mjs";
import { CASOS_COBERTURA } from "./datos-casos-cobertura.mjs";

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
const LETRA = (i) => String.fromCharCode(65 + i);

const HOJA = "Casos de prueba";
const RUTA = rutaDe(HOJA);

// ── Las 7 filas a corregir: Pedido → cantidad en PIEZAS ───────────────────────────────
// El número sale del propio texto del pedido, que es lo que el cliente diría. Verificado
// contra el motor: con estas cantidades los 93 casos siguen dando el mismo precio.
const EN_PIEZAS = {
  "100 tarjetas 9x5 simple faz": 100,
  "500 tarjetas 9x5 doble faz": 500,
  "1000 tarjetas 9x5 simple faz encapsuladas": 1000,
  "500 hojas membretadas A4": 500,
  "10 talonarios de factura": 10,
  "500 volantes A6": 500,
  "1 talonario x10 (NO exento, ya supera el mínimo)": 10,
};

// ── Leer la hoja: encabezado, filas existentes, estilos ───────────────────────────────
let xml = leer(RUTA);

const encabezado = [];
const pedidosExistentes = new Set();
const estilos = {};
let ultima = 0;
// Pedido → { fila, letraCantidad, celdaXml } de las que hay que corregir.
const aCorregir = new Map();

const iPedido = 0; // columna A
let iCantidad = -1;

for (const f of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
  const n = Number(f[1]);
  ultima = Math.max(ultima, n);
  const celdas = [...f[2].matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)];
  let pedido = null;
  for (const c of celdas) {
    const v = (c[4] || "").match(/<v>([\s\S]*?)<\/v>/);
    const texto = v ? (/t="s"/.test(c[3]) ? CADENAS[Number(v[1])] : v[1]) : null;
    const col = c[1].charCodeAt(0) - 65;
    if (n === 1) {
      encabezado[col] = texto;
      if (String(texto).trim() === "Cantidad") iCantidad = col;
    } else {
      if (col === iPedido && texto !== null) pedido = String(texto).trim();
      if (n === 2) {
        const s = c[3].match(/s="(\d+)"/);
        if (s) estilos[c[1]] = s[1];
      }
    }
  }
  if (n > 1 && pedido) {
    pedidosExistentes.add(pedido);
    if (Object.prototype.hasOwnProperty.call(EN_PIEZAS, pedido)) {
      aCorregir.set(pedido, { fila: n });
    }
  }
}

if (iCantidad < 0) throw new Error('la hoja no tiene columna "Cantidad"');
const LETRA_CANT = LETRA(iCantidad);

// ── 1) Corregir las 7 cantidades ──────────────────────────────────────────────────────
// Sustitución quirúrgica celda por celda. Ojo con los self-closing (`<c r="B5" s="2"/>`):
// un regex con [\s\S]*? que no los contemple se come hasta el próximo cierre y desalinea
// toda la fila (ya mordió una vez en este proyecto).
const faltantes = Object.keys(EN_PIEZAS).filter((p) => !aCorregir.has(p));
if (faltantes.length) {
  throw new Error(
    "no encontré estas filas en la hoja (¿cambió el texto del Pedido?):\n  - " + faltantes.join("\n  - "),
  );
}

const corregidas = [];
for (const [pedido, { fila }] of aCorregir) {
  const valor = EN_PIEZAS[pedido];
  const re = new RegExp(`<c r="${LETRA_CANT}${fila}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
  const m = xml.match(re);
  if (!m) throw new Error(`no encontré la celda ${LETRA_CANT}${fila} (${pedido})`);
  const anterior = m[2] ? (m[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1] : "(vacía)";
  const attrs = m[1].replace(/\st="[^"]*"/g, "");
  xml = xml.replace(re, `<c r="${LETRA_CANT}${fila}"${attrs} t="n"><v>${valor}</v></c>`);
  corregidas.push({ pedido, fila, anterior, valor });
}

// ── 2) Agregar los 37 casos nuevos ────────────────────────────────────────────────────
const COLS = ["Pedido", "Cantidad", "Material", "Ancho (cm)", "Alto (cm)", "Piezas por unidad de cobro", "Precio correcto"];
for (const [i, c] of COLS.entries()) {
  if (String(encabezado[i] ?? "").trim() !== c) {
    throw new Error(`la columna ${LETRA(i)} de "${HOJA}" es "${encabezado[i]}" y esperaba "${c}"`);
  }
}

function celda(letra, fila, valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  const s = estilos[letra] ? ` s="${estilos[letra]}"` : "";
  if (typeof valor === "number") return `<c r="${letra}${fila}" ${s.trim()} t="n"><v>${valor}</v></c>`.replace(/\s+/g, " ").replace(" >", ">");
  return `<c r="${letra}${fila}"${s} t="s"><v>${SS.idDe(String(valor))}</v></c>`;
}

const nuevos = CASOS_COBERTURA.filter((c) => !pedidosExistentes.has(String(c["Pedido"]).trim()));
const saltados = CASOS_COBERTURA.length - nuevos.length;

let filasXml = "";
nuevos.forEach((c, i) => {
  const n = ultima + 1 + i;
  const celdas = COLS.map((col, j) => celda(LETRA(j), n, c[col])).join("");
  filasXml += `<row r="${n}">${celdas}</row>`;
});
if (filasXml) xml = xml.replace(/<\/sheetData>/, `${filasXml}</sheetData>`);

// ── Informe ───────────────────────────────────────────────────────────────────────────
console.log(`Cantidades corregidas a PIEZAS (${corregidas.length}):`);
for (const c of corregidas) {
  console.log(`  fila ${String(c.fila).padStart(3)}  ${c.anterior} → ${String(c.valor).padEnd(5)} ${c.pedido}`);
}
console.log(`\nCasos nuevos: +${nuevos.length}${saltados ? `  (${saltados} ya estaban)` : ""}`);
for (const c of nuevos.slice(0, 3)) console.log(`  ${c["Pedido"]}`);
if (nuevos.length > 3) console.log(`  … y ${nuevos.length - 3} más`);
console.log(`\n${SS.nuevas()} cadena(s) nueva(s) a sharedStrings.`);

if (!APLICAR) {
  console.log("\nDRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}

SS.aplicar();
entradaDe(RUTA).contenido = Buffer.from(xml, "utf8");
guardar(entradas);
console.log(`\nEscrito ${XLSX}.`);
