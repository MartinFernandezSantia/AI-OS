// Etapa 5 del plan flexibilidad-motor-cotizacion.md: alternativas cuando el paquete no da
// exacto. cotizar() devuelve, junto al motivo, las cantidades de paquete más cercanas con su
// total real (misma presentación); el auditor suma las de las otras presentaciones de la
// familia (eso se prueba en n8n/test-auditor.mjs, que sí alimenta `variantes`).
//
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/etapa5-alternativas.mjs          (dry run)
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/etapa5-alternativas.mjs --apply
//
// Casos (columna G = "Alternativas: c=$t · c=$t", el gate las compara contra cotizar()):
//   · "150 sobres impresos" (Sobres x100, familia única) → inferior y superior: 100=25000,
//     200=50000.
//   · "150 tarjetas 9x5 simple faz" (Tarjetas x100, la MISMA presentación) → 100=13200,
//     200=26400. La expansión por familia (500/1000) la cubre test-auditor con variantes.
//   · "150 perforados" (Perforado x500, familia única) → SOLO la superior: 500=4000 (el caso
//     donde la alternativa más barata tiene MÁS unidades que las pedidas).

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
  { pedido: "150 sobres impresos", cantidad: 150, material: "Sobres impresos x100", precio: "Alternativas: 100=25000, 200=50000" },
  { pedido: "150 tarjetas 9x5 simple faz", cantidad: 150, material: "Tarjetas 9x5 simple faz x100", precio: "Alternativas: 100=13200, 200=26400" },
  { pedido: "150 perforados", cantidad: 150, material: "Perforado x500", precio: "Alternativas: 500=4000" },
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
console.log(`Casos de prueba: +${filas.length} filas (alternativas de paquete)`);

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}

entradaDe(ruta).contenido = Buffer.from(nuevo, "utf8");
SS.aplicar();
guardar(entradas);
console.log(`\n✓ Escrito ${XLSX}.`);