// Etapa 3 del plan flexibilidad-motor-cotizacion.md: tramos con PRECIO TOTAL (la marca
// "este precio es el total del tramo" va en la FILA del tramo, no en el material).
//
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/etapa3-troquelado-rifas.mjs          (dry run)
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/etapa3-troquelado-rifas.mjs --apply
//
// Operaciones:
//   1. Materiales: columna nueva "Precio total por tramo" (N, al final) + 3 materiales:
//      · "Troquelado (corte con forma en papel)" — unidad, 4 tramos, SOLO el primero total.
//      · "Talonario de rifas 100 números 10x7 cm" y "15x7 cm" — talonario, 6 tramos totales
//        (la escala va en TALONARIOS: 100 números por talonario, conversión 1:100 exacta).
//   2. Productos: troquelado en Encuadernación y terminaciones; rifas en Papelería comercial
//      (familia "Talonario de rifas" → UN chunk con las dos medidas como variantes).
//   3. Casos de prueba: troquelado (bordes de los 4 tramos) + rifas (bordes de los 6).
//   4. Pendientes: retira filas 3, 4 y 5.

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

function ultimaFila(xml) {
  let max = 0;
  for (const m of xml.matchAll(/<c r="[A-Z]+(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max;
}

function estiloDe(xml, col, filaRef) {
  const m = xml.match(new RegExp(`<c r="${col}${filaRef}"([^>]*?)(?:/>|>)`));
  const s = m && m[1].match(/\bs="(\d+)"/);
  return s ? ` s="${s[1]}"` : "";
}

function celda(col, fila, valor, estilo) {
  const ref = `${col}${fila}`;
  if (typeof valor === "number") return `<c r="${ref}"${estilo}><v>${valor}</v></c>`;
  return `<c r="${ref}"${estilo} t="s"><v>${SS.idDe(String(valor))}</v></c>`;
}

/** Agrega el encabezado de una columna nueva al final de la fila 1 de una hoja. */
function agregarColumna(hoja, col, nombre) {
  const ruta = rutaDe(hoja);
  const xml = leer(ruta);
  const re = /(<row r="1"[^>]*>)([\s\S]*?)(<\/row>)/;
  const m = xml.match(re);
  if (!m) throw new Error(`"${hoja}": no encontré la fila 1`);
  if (xml.includes(`r="${col}1"`)) return console.log(`${hoja}: la columna ${col} ya existe.`);
  const estilo = estiloDe(m[2], String.fromCharCode(col.charCodeAt(0) - 1), 1);
  const nueva = `${m[1]}${m[2]}${celda(col, 1, nombre, estilo)}${m[3]}`;
  entradaDe(ruta).contenido = Buffer.from(xml.replace(re, nueva), "utf8");
  console.log(`${hoja}: columna ${col} "${nombre}" agregada.`);
}

/** Agrega filas a una hoja (después de la última existente). */
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
    .replace(/<dimension ref="[^"]*"\s*\/>/, `<dimension ref="A1:${colLetra(maxCol)}${base + filas.length}"/>`);
  entradaDe(ruta).contenido = Buffer.from(nuevo, "utf8");
  return filas.length;
}

const colLetra = (n) => {
  let s = "";
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
};

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
// Columna nueva: al FINAL (N). El plan pedía "junto a Precio por unidad", pero insertar en
// el medio correría 8 columnas; la cabecera de Materiales es dinámica (header = schema), así
// que el comportamiento no cambia. La desviación queda anotada en el commit.
agregarColumna("Materiales", "N", "Precio total por tramo");

const TROQ = "Troquelado (corte con forma en papel)";
const RIFA10 = "Talonario de rifas 100 números 10x7 cm";
const RIFA15 = "Talonario de rifas 100 números 15x7 cm";
const SI = "sí";

const filasMaterial = [
  // Troquelado: MIXTO — el primer tramo es TOTAL (1-10 piezas = $10.000 enteros), los otros
  // tres multiplican por pieza como siempre. Es el caso que atrapa el error de marcar TODO
  // el material como total: 30 piezas tienen que dar $30.000, no $1.000.
  ...[[TROQ, "unidad", 1, 10, 10000, SI],
     [TROQ, "unidad", 11, 50, 1000, ""],
     [TROQ, "unidad", 51, 100, 800, ""],
     [TROQ, "unidad", 101, null, 600, ""]].map(([m, u, de, ha, pr, tot]) => ({
    celdas: [["A", m], ["B", u], ["C", de], ...(ha ? [["D", ha]] : []), ["E", pr], ...(tot ? [["N", tot]] : [])],
  })),
  // Rifas 10x7: escala en TALONARIOS (100 números cada uno), los 6 tramos TOTALES.
  ...[[1, 2, 7200], [3, 4, 9600], [5, 9, 12000], [10, 49, 18000], [50, 99, 50400], [100, null, 64800]]
    .map(([de, ha, pr]) => ({
      celdas: [["A", RIFA10], ["B", "talonario"], ["C", de], ...(ha ? [["D", ha]] : []), ["E", pr], ["L", "Talonario de rifas"], ["N", SI]],
    })),
  // Rifas 15x7: misma estructura.
  ...[[1, 2, 10800], [3, 4, 13200], [5, 9, 20400], [10, 49, 31200], [50, 99, 57600], [100, null, 68400]]
    .map(([de, ha, pr]) => ({
      celdas: [["A", RIFA15], ["B", "talonario"], ["C", de], ...(ha ? [["D", ha]] : []), ["E", pr], ["L", "Talonario de rifas"], ["N", SI]],
    })),
];

// ── 2) Productos ───────────────────────────────────────────────────────────────────────
const filasProducto = [
  {
    celdas: [
      ["A", "Encuadernación y terminaciones"],
      ["B", "Troquelado (corte con forma)"],
      ["C", "Corte con forma sobre un impreso ya listo. Se cobra según la cantidad de piezas; las primeras 10 piezas tienen un precio total fijo."],
      ["D", TROQ],
      ["G", "troquelado, corte con forma, troquelar, corte troquelado"],
    ],
  },
  {
    celdas: [
      ["A", "Papelería comercial"],
      ["B", RIFA10],
      ["C", "Talonarios de rifas numeradas correlativamente, 100 números por talonario, 10x7 cm. Se cobra por talonario."],
      ["D", RIFA10],
      ["G", "rifa, rifas, talonario de rifa, bono de rifa, rifa de 100"],
    ],
  },
  {
    celdas: [
      ["A", "Papelería comercial"],
      ["B", RIFA15],
      ["C", "Talonarios de rifas numeradas correlativamente, 100 números por talonario, 15x7 cm. Se cobra por talonario."],
      ["D", RIFA15],
      ["G", "rifa, rifas, talonario de rifa, bono de rifa, rifa de 100"],
    ],
  },
];

// ── 3) Casos de prueba ─────────────────────────────────────────────────────────────────
const casos = [];
const caso = (pedido, cantidad, material, precio) => casos.push({ celdas: [["A", pedido], ["B", cantidad], ["C", material], ["G", precio]] });

// Troquelado: bordes de los 4 tramos. Dentro del tramo total no escala (3 y 9 dan $10.000);
// el 30 es el que atrapa el error de marcar todo el material como total.
for (const n of [1, 3, 9, 10]) caso(`${n} ${n === 1 ? "troquelado" : "troquelados"}`, n, TROQ, 10000);
for (const n of [11, 50]) caso(`${n} troquelados`, n, TROQ, n * 1000);
for (const n of [51, 100]) caso(`${n} troquelados`, n, TROQ, n * 800);
for (const n of [101, 500]) caso(`${n} troquelados`, n, TROQ, n * 600);

// Rifas 10x7: borde inferior y superior de cada uno de los 6 tramos (escala en talonarios).
const RIFAS10 = [
  [1, 7200], [2, 7200], [3, 9600], [4, 9600], [5, 12000], [9, 12000],
  [10, 18000], [49, 18000], [50, 50400], [99, 50400], [100, 64800], [101, 64800],
];
for (const [n, pr] of RIFAS10) caso(`${n} ${n === 1 ? "talonario de rifas" : "talonarios de rifas"} (10x7)`, n, RIFA10, pr);

// Rifas 15x7: spot checks de la misma estructura.
for (const [n, pr] of [[1, 10800], [3, 13200], [100, 68400]]) {
  caso(`${n} ${n === 1 ? "talonario de rifas" : "talonarios de rifas"} (15x7)`, n, RIFA15, pr);
}

// ── 4) Pendientes ─────────────────────────────────────────────────────────────────────
const PENDIENTES_A_BORRAR = [3, 4, 5];

console.log(`catálogo: ${XLSX}`);
console.log(`Materiales: columna N + ${filasMaterial.length} filas (troquelado 4 tramos · rifas 2×6 tramos)`);
console.log(`Productos: +${filasProducto.length} filas`);
console.log(`Casos de prueba: +${casos.length} filas`);
console.log(`Pendientes: borrar filas ${PENDIENTES_A_BORRAR.join(", ")}`);

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}

// La columna N se agregó arriba (en memoria, antes del corte del dry-run). El resto de los
// cambios operan sobre las mismas entradas en memoria y se escriben con guardar().
agregarFilas("Materiales", filasMaterial);
agregarFilas("Productos", filasProducto);
agregarFilas("Casos de prueba", casos);
borrarFilas("Pendientes", PENDIENTES_A_BORRAR);

SS.aplicar();
guardar(entradas);
console.log(`\n✓ Escrito ${XLSX}.`);