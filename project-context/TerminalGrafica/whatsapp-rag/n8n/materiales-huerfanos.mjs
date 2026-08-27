// ¿Qué materiales tienen precio cargado pero ningún producto que los use? Esos materiales
// NO generan chunk (el chunk es colección+material y sale de los productos), así que el bot
// no puede cotizarlos por más que estén en la lista de precios.
//
//   node n8n/materiales-huerfanos.mjs
import path from "node:path";
import { abrir, cadenasDe, dec } from "../visor/scripts/lib-xlsx.mjs";

const { entradas } = abrir();
const leer = (n) => entradas.find((e) => e.nombre === n).contenido.toString("utf8");
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));
const wbXml = leer("xl/workbook.xml");
const HOJAS = [...wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"[^>]*\/?>/g)].map((m) => ({
  nombre: m[1],
  rid: m[2],
}));
const RID_TARGET = Object.fromEntries(
  [...leer("xl/_rels/workbook.xml.rels").matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]),
);

function matriz(nombreHoja) {
  const h = HOJAS.find((x) => x.nombre === nombreHoja);
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
      celdas[i - 1] = /t="s"/.test(c[1]) ? CADENAS[Number(v[1])] : dec(v[1]);
    }
    out[Number(fila[1]) - 1] = celdas;
  }
  return out.filter(Boolean);
}

function objetos(rows) {
  const H = (rows[0] || []).map((h) => String(h ?? "").trim());
  return rows.slice(1)
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

const materiales = objetos(matriz("Materiales"));
const productos = objetos(matriz("Productos"));
const casos = objetos(matriz("Casos de prueba"));

const conPrecio = [...new Set(materiales.map((m) => m["Material"]).filter(Boolean))];
const usados = new Set(productos.map((p) => p["Material"]).filter(Boolean));
const enCasos = new Set(casos.map((c) => c["Material"]).filter(Boolean));

console.log(`materiales con precio: ${conPrecio.length} · usados por algún producto: ${usados.size}\n`);
for (const m of conPrecio) {
  const marcas = [usados.has(m) ? "producto" : "HUÉRFANO", enCasos.has(m) ? "en casos" : ""].filter(Boolean);
  console.log(`  ${usados.has(m) ? "✓" : "✗"} ${m}  [${marcas.join(" · ")}]`);
}

const huerfanosEnCasos = conPrecio.filter((m) => !usados.has(m) && enCasos.has(m));
if (huerfanosEnCasos.length) {
  console.log(`\n⚠ materiales SIN chunk pero CON caso de prueba (el bot no puede acertarlos):`);
  for (const m of huerfanosEnCasos) {
    const suyos = casos.filter((c) => c["Material"] === m).map((c) => c["Pedido"]);
    console.log(`  - ${m}\n      ${suyos.join("\n      ")}`);
  }
}
