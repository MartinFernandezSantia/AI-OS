// Etapa 2 del plan flexibilidad-motor-cotizacion.md: da de alta el modo de cobro `fijo`
// con el material "Corte a medida" (recargo por diseño, $5.000 fijos por trabajo).
//
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/etapa2-corte-medida.mjs          (dry run)
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/etapa2-corte-medida.mjs --apply
//
// Operaciones:
//   1. Materiales: fila "Corte a medida" — Unidad "modelo de corte" (dispara el modo fijo),
//      tramo único Desde 1, Precio 5000, Sin mínimo por trabajo = sí (es un agregado).
//   2. Productos: producto "Corte a medida" en "Encuadernación y terminaciones".
//   3. Casos de prueba: 3 filas (cantidades 1, 8, 50) con el MISMO Precio correcto 5000.
//   4. Pendientes: retira las filas 2 y 6 (el material y la nota de los 5 productos).

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

const letraCol = (n) => {
  let s = "";
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
};

/** Máxima fila con celdas en una hoja. */
function ultimaFila(xml) {
  let max = 0;
  for (const m of xml.matchAll(/<c r="[A-Z]+(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** El estilo de la celda COL+filaRef (para que la fila nueva parezca dato, no encabezado). */
function estiloDe(xml, col, filaRef) {
  const m = xml.match(new RegExp(`<c r="${col}${filaRef}"([^>]*?)(?:/>|>)`));
  const s = m && m[1].match(/\bs="(\d+)"/);
  return s ? ` s="${s[1]}"` : "";
}

/** XML de una celda: número crudo o texto vía sharedStrings. */
function celda(col, fila, valor, estilo) {
  const ref = `${col}${fila}`;
  if (typeof valor === "number") return `<c r="${ref}"${estilo}><v>${valor}</v></c>`;
  return `<c r="${ref}"${estilo} t="s"><v>${SS.idDe(String(valor))}</v></c>`;
}

/** Agrega filas a una hoja. `filas` = array de { celdas: [[col, valor], ...] }. */
function agregarFilas(hoja, filas) {
  const ruta = rutaDe(hoja);
  const xml = leer(ruta);
  const base = ultimaFila(xml);
  const maxCol = Math.max(...filas.flatMap((f) => f.celdas.map(([c]) => c.charCodeAt(0) - 64)));
  const nuevas = filas
    .map((f, i) => {
      const n = base + 1 + i;
      const cuerpo = f.celdas
        .map(([col, v]) => celda(col, n, v, estiloDe(xml, col, base || 1)))
        .join("");
      return `<row r="${n}">${cuerpo}</row>`;
    })
    .join("");
  const nuevo = xml
    .replace(/<\/sheetData>/, `${nuevas}</sheetData>`)
    .replace(/<dimension ref="[^"]*"\s*\/>/, `<dimension ref="A1:${letraCol(maxCol)}${base + filas.length}"/>`);
  entradaDe(ruta).contenido = Buffer.from(nuevo, "utf8");
  return filas.length;
}

/** Borra filas por número (idempotente). */
function borrarFilas(hoja, numeros) {
  const ruta = rutaDe(hoja);
  let xml = leer(ruta);
  let borradas = 0;
  for (const n of numeros) {
    const re = new RegExp(`<row[^>]*\\br="${n}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/row>)`);
    if (!re.test(xml)) {
      console.log(`  Pendientes fila ${n}: ya no está — nada que hacer.`);
      continue;
    }
    xml = xml.replace(re, "");
    borradas++;
  }
  entradaDe(ruta).contenido = Buffer.from(xml, "utf8");
  return borradas;
}

// ── 1) Materiales ─────────────────────────────────────────────────────────────────────
const material = {
  nombre: "Corte a medida",
  celdas: [
    ["A", "Corte a medida"],
    ["B", "modelo de corte"],
    ["C", 1],
    ["E", 5000],
    ["K", "sí"], // Sin mínimo por trabajo: es un agregado sobre un trabajo ya cobrado.
  ],
};
const filasMaterial = [material];
const yaExiste = leer(rutaDe("Materiales")).includes("Corte a medida");
if (yaExiste) {
  console.log("Materiales: 'Corte a medida' ya existe — nada que agregar.");
  filasMaterial.length = 0;
}

// ── 2) Productos ──────────────────────────────────────────────────────────────────────
const producto = {
  nombre: "Corte a medida",
  celdas: [
    ["A", "Encuadernación y terminaciones"],
    ["B", "Corte a medida"],
    ["C", "Recargo fijo por modelo o diseño de corte recto a medida. Se cobra una sola vez, sin importar la cantidad de piezas."],
    ["D", "Corte a medida"],
    ["G", "corte a medida, recorte, cortar a medida, corte recto"],
  ],
};
const filasProducto = [producto];
if (leer(rutaDe("Productos")).includes("Corte a medida")) {
  console.log("Productos: 'Corte a medida' ya existe — nada que agregar.");
  filasProducto.length = 0;
}

// ── 3) Casos de prueba ────────────────────────────────────────────────────────────────
const casos = [
  { pedido: "1 corte a medida", cantidad: 1, precio: 5000 },
  { pedido: "8 cortes a medida", cantidad: 8, precio: 5000 },
  { pedido: "50 cortes a medida", cantidad: 50, precio: 5000 },
];
const filasCasos = casos.map((c) => ({
  celdas: [
    ["A", c.pedido],
    ["B", c.cantidad],
    ["C", "Corte a medida"],
    ["G", c.precio],
  ],
}));

// ── 4) Pendientes ─────────────────────────────────────────────────────────────────────
const PENDIENTES_A_BORRAR = [2, 6];

console.log(`catálogo: ${XLSX}`);
if (filasMaterial.length) console.log(`Materiales: +1 fila "${material.nombre}" (modelo de corte, $5000 fijo, sin mínimo)`);
if (filasProducto.length) console.log(`Productos: +1 fila "${producto.nombre}" en Encuadernación y terminaciones`);
console.log(`Casos de prueba: +${filasCasos.length} filas (1/8/50 → $5000)`);
console.log(`Pendientes: borrar filas ${PENDIENTES_A_BORRAR.join(", ")}`);

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}

if (filasMaterial.length) agregarFilas("Materiales", filasMaterial);
if (filasProducto.length) agregarFilas("Productos", filasProducto);
agregarFilas("Casos de prueba", filasCasos);
borrarFilas("Pendientes", PENDIENTES_A_BORRAR);

SS.aplicar();
guardar(entradas);
console.log(`\n✓ Escrito ${XLSX}.`);