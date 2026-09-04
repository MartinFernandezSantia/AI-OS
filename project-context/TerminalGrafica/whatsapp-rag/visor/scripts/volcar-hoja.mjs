// Vuelca una hoja entera como texto, fila por fila. Solo lee.
//   HOJA="Lista de precios" CATALOGO=... node visor/scripts/volcar-hoja.mjs
import { abrir, cadenasDe, dec, relsDe, valorCelda } from "./lib-xlsx.mjs";

const HOJA = process.env.HOJA ?? "Lista de precios";

const { get, getOpcional } = abrir();
const g = (n) => get(n).contenido.toString("utf8");
const gOpcional = (n) => getOpcional(n)?.contenido.toString("utf8") ?? "";
// sharedStrings.xml puede no existir (t="inlineStr", ver relsDe/valorCelda en lib-xlsx.mjs).
const CAD = cadenasDe(gOpcional("xl/sharedStrings.xml"));
const HOJAS = [...g("xl/workbook.xml").matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"[^>]*\/?>/g)].map((m) => ({
  nombre: dec(m[1]),
  rid: m[2],
}));
// relsDe tolera el orden de atributos que usa openpyxl (Target antes que Id) — un regex
// que asuma el orden de LibreOffice deja el mapa vacío en silencio contra esos archivos.
const RID = relsDe(g("xl/_rels/workbook.xml.rels"));
const h = HOJAS.find((x) => x.nombre === HOJA);
if (!h) throw new Error(`no hay hoja "${HOJA}". Hay: ${HOJAS.map((x) => x.nombre).join(" · ")}`);
const xml = g("xl/" + (RID[h.rid] ?? ""));

for (const f of xml.matchAll(/<row[^>]*\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
  if (!f[2]) continue;
  const celdas = [...f[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
    .map((c) => {
      const val = valorCelda(c[2], c[3] ?? "", CAD);
      return val === undefined || val === "" ? null : `${c[1]}=${val}`;
    })
    .filter(Boolean);
  if (!celdas.length) continue;
  console.log(`${String(f[1]).padStart(3)} | ${celdas.join(" | ")}`);
}
