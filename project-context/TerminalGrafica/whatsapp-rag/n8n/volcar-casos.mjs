// Vuelca la hoja `Casos de prueba` a JSON para poder correrla contra el bot en vivo
// (Fase 4). No calcula nada: solo traduce la hoja. El veredicto lo pone el auditor del
// flow y la comparación contra "Precio correcto" la hace quien lee las ejecuciones.
//
//   node n8n/volcar-casos.mjs   → n8n/casos.json
import { writeFileSync } from "node:fs";
import path from "node:path";
import { abrir, cadenasDe, dec } from "../visor/scripts/lib-xlsx.mjs";

const AQUI = import.meta.dirname;
const SALIDA = path.join(AQUI, "casos.json");

// Mismo camino de lectura que build-flow.mjs (ver ahí los gotchas del ZIP y del XML).
// `abrir()` no toma ruta: el .xlsx está fijado en lib-xlsx.mjs.
const { entradas } = abrir();
const leer = (n) => entradas.find((e) => e.nombre === n).contenido.toString("utf8");
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));

const wbXml = leer("xl/workbook.xml");
const HOJAS = [...wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"[^>]*\/?>/g)].map((m) => ({
  nombre: m[1],
  rid: m[2],
}));
const RID_TARGET = Object.fromEntries(
  [...leer("xl/_rels/workbook.xml.rels").matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [
    m[1],
    m[2],
  ]),
);

function matriz(nombreHoja) {
  const h = HOJAS.find((x) => x.nombre === nombreHoja);
  if (!h) throw new Error(`el Excel no tiene la hoja "${nombreHoja}"`);
  const xml = leer("xl/" + RID_TARGET[h.rid].replace(/^\//, ""));
  const out = [];
  for (const fila of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas = [];
    for (const c of fila[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (c[1].match(/r="([A-Z]+\d+)"/) || [])[1];
      const v = (c[2] || "").match(/<v>([\s\S]*?)<\/v>/);
      if (!ref || !v) continue;
      const col = ref.match(/^[A-Z]+/)[0];
      let i = 0;
      for (const ch of col) i = i * 26 + (ch.charCodeAt(0) - 64);
      const esCadena = /t="s"/.test(c[1]);
      celdas[i - 1] = esCadena ? CADENAS[Number(v[1])] : dec(v[1]);
    }
    out[Number(fila[1]) - 1] = celdas;
  }
  return out.filter(Boolean);
}

function objetos(rows) {
  const H = (rows[0] || []).map((h) => String(h ?? "").trim());
  return rows
    .slice(1)
    .filter((r) => r && r.some((c) => String(c ?? "").trim()))
    .map((r) => {
      const o = {};
      H.forEach((h, i) => {
        const v = String(r[i] ?? "").trim();
        if (h && v) o[h] = v;
      });
      return o;
    });
}

const casos = objetos(matriz("Casos de prueba"));
writeFileSync(SALIDA, JSON.stringify(casos, null, 2));
console.log(`${casos.length} casos → ${path.relative(process.cwd(), SALIDA)}`);
console.log(`columnas: ${Object.keys(casos[0] ?? {}).join(" · ")}`);
