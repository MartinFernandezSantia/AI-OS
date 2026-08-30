// Vacía una celda de una hoja, buscándola por la clave de su primera columna.
// Se usó para sacar el "Piezas por paquete = 4" del "Pack 4 libros de medicina": ese 4 es
// parte del NOMBRE del producto, no un empaque de 4 piezas, y hacía que el bot derivara
// cuando el cliente pedía un pack (1 no es múltiplo de 4).
//
//   node visor/scripts/borrar-celda.mjs                 → dry run
//   CATALOGO=../Catalogo-TG-v3.xlsx node … --apply
import { XLSX, chequearLock, abrir, cadenasDe, dec, guardar } from "./lib-xlsx.mjs";

const APLICAR = process.argv.includes("--apply");

const A_BORRAR = [{ hoja: "Materiales", columna: "Piezas por paquete", fila: "Pack 4 libros de medicina" }];

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
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));

let borradas = 0;
const escrituras = new Map();

for (const { hoja, columna, fila } of A_BORRAR) {
  const h = HOJAS.find((x) => x.nombre === hoja);
  if (!h) throw new Error(`el Excel no tiene la hoja "${hoja}"`);
  const ruta = "xl/" + RID[h.rid].replace(/^\//, "");
  let xml = escrituras.get(ruta) ?? leer(ruta);

  // Qué letra es la columna, y en qué número de fila está la clave.
  let col = null;
  let nFila = null;
  for (const f of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const n = Number(f[1]);
    for (const c of f[2].matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = (c[4] || "").match(/<v>([\s\S]*?)<\/v>/);
      if (!v || !/t="s"/.test(c[3])) continue;
      const texto = String(CADENAS[Number(v[1])] ?? "").trim();
      if (n === 1 && texto === columna) col = c[1];
      else if (n > 1 && c[1] === "A" && texto === fila) nFila = n;
    }
  }
  if (!col) throw new Error(`"${hoja}" no tiene la columna "${columna}"`);
  if (!nFila) throw new Error(`"${hoja}" no tiene la fila "${fila}"`);

  const celda = new RegExp(`<c r="${col}${nFila}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
  if (!celda.test(xml)) {
    console.log(`${hoja} · ${col}${nFila} (${fila}) ya está vacía.`);
    continue;
  }
  console.log(`${hoja} · ${col}${nFila} (${fila}) → borrar "${columna}"`);
  xml = xml.replace(celda, "");
  borradas++;
  escrituras.set(ruta, xml);
}

console.log(`\n${borradas} celda(s) a borrar.`);
if (!APLICAR) {
  console.log("DRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}
if (!borradas) process.exit(0);

for (const [ruta, xml] of escrituras) entradaDe(ruta).contenido = Buffer.from(xml, "utf8");
guardar(entradas);
console.log(`Escrito ${XLSX}.`);
