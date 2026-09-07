// Etapa 4 del plan flexibilidad-motor-cotizacion.md: entrada DIRECTA en la unidad de
// cobro (el cliente pide "3 m² de vinilo" y la cantidad ES la unidad, sin medida).
//
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/etapa4-m2-directo.mjs          (dry run)
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/etapa4-m2-directo.mjs --apply
//
// Casos (la lógica ya cambió en el motor; acá se fijan los números):
//   · "3 m² de lona" (directo) = $48.000, el MISMO total que el caso pieza "Banner de lona
//     3x1 m" existente — los dos caminos convergen.
//   · "0,3 m² de lona" (directo) = $8.000: dispara el mínimo facturable 0,5 m².
//   · "3 m² de vinilo" (directo) = $66.000 (3 × $22.000).
//   · "escaneo de 2 metros de planos" = $16.000: confirmación del camino de metro lineal.

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

const casos = [
  { pedido: "3 m² de lona", cantidad: 3, material: "Lona", precio: 48000 },
  { pedido: "0,3 m² de lona (mínimo por el camino directo)", cantidad: 0.3, material: "Lona", precio: 8000 },
  { pedido: "3 m² de vinilo", cantidad: 3, material: "Vinilo y lona UV", precio: 66000 },
  { pedido: "escaneo de 2 metros de planos", cantidad: 2, material: "Escaneo de planos", precio: 16000 },
];

const filas = casos.map((c) => ({
  celdas: [
    ["A", c.pedido],
    ["B", c.cantidad],
    ["C", c.material],
    ["G", c.precio],
  ],
}));

const ruta = rutaDe("Casos de prueba");
const xml = leer(ruta);
const base = ultimaFila(xml);
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
  .replace(/<dimension ref="[^"]*"\s*\/>/, `<dimension ref="A1:G${base + filas.length}"/>`);

console.log(`catálogo: ${XLSX}`);
console.log(`Casos de prueba: +${filas.length} filas (2 caminos m2 + mínimo directo + metro lineal)`);

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}

entradaDe(ruta).contenido = Buffer.from(nuevo, "utf8");
SS.aplicar();
guardar(entradas);
console.log(`\n✓ Escrito ${XLSX}.`);