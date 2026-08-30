// Vuelca una hoja entera como texto, fila por fila. Solo lee.
//   HOJA="Lista de precios" CATALOGO=... node visor/scripts/volcar-hoja.mjs
import { abrir, cadenasDe, dec } from "./lib-xlsx.mjs";

const HOJA = process.env.HOJA ?? "Lista de precios";

const { entradas } = abrir();
const g = (n) => entradas.find((e) => e.nombre === n)?.contenido.toString("utf8") ?? "";
const CAD = cadenasDe(g("xl/sharedStrings.xml"));
const HOJAS = [...g("xl/workbook.xml").matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"[^>]*\/?>/g)].map((m) => ({
  nombre: dec(m[1]),
  rid: m[2],
}));
const RID = Object.fromEntries(
  [...g("xl/_rels/workbook.xml.rels").matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]),
);
const h = HOJAS.find((x) => x.nombre === HOJA);
if (!h) throw new Error(`no hay hoja "${HOJA}". Hay: ${HOJAS.map((x) => x.nombre).join(" · ")}`);
const xml = g("xl/" + RID[h.rid].replace(/^\//, ""));

for (const f of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
  const celdas = [...f[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
    .map((c) => {
      const v = (c[3] || "").match(/<v>([\s\S]*?)<\/v>/);
      if (!v) return null;
      return `${c[1]}=${/t="s"/.test(c[2]) ? String(CAD[Number(v[1])] ?? "") : v[1]}`;
    })
    .filter(Boolean);
  if (!celdas.length) continue;
  console.log(`${String(f[1]).padStart(3)} | ${celdas.join(" | ")}`);
}
