// Saca el precio LITERAL de la descripción del producto "Escaneo de planos".
//
// Decía: "Se cobra por metro lineal escaneado: 3 metros son $24.000."
// El chunk que lee el bot incluye la descripción, así que ese número le queda delante a un
// modelo al que el prompt le prohíbe escribir precios. Si lo copia, el Responder lo detecta
// como precio tipeado a mano y DERIVA todo el turno a consulta — el guardrail lo ataja, sí,
// pero por accidente: el precio correcto igual no llega al cliente.
//
// El precio del escaneo vive donde corresponde: la escala del material en la hoja
// Materiales ($8.000 el metro lineal). La descripción solo tiene que decir CÓMO se cobra.
//
//   node visor/scripts/quitar-precio-descripcion.mjs          → dry run
//   node visor/scripts/quitar-precio-descripcion.mjs --apply
import { XLSX, chequearLock, abrir, cadenasDe, dec, indiceCadenas, guardar } from "./lib-xlsx.mjs";

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

// Producto → descripción nueva. La vieja se busca por coincidencia EXACTA: si el cliente ya
// la editó, mejor romper que pisarle el texto.
const CAMBIOS = [
  {
    producto: "Escaneo de planos",
    antes:
      "Escaneo y digitalización de planos en gran formato. Se cobra por metro lineal escaneado: 3 metros son $24.000. También escaneamos A3.",
    despues:
      "Escaneo y digitalización de planos en gran formato. Se cobra por metro lineal escaneado. También escaneamos A3.",
  },
];

const RUTA = rutaDe("Productos");
let xml = leer(RUTA);

// Ubicar las columnas Producto y Descripción por el encabezado.
const encabezado = [];
for (const f of xml.matchAll(/<row r="1"[^>]*>([\s\S]*?)<\/row>/g)) {
  for (const c of f[1].matchAll(/<c r="([A-Z]+)1"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const v = (c[3] || "").match(/<v>([\s\S]*?)<\/v>/);
    if (v) encabezado[c[1].charCodeAt(0) - 65] = /t="s"/.test(c[2]) ? CADENAS[Number(v[1])] : v[1];
  }
}
const iProd = encabezado.indexOf("Producto");
const iDesc = encabezado.indexOf("Descripción");
if (iProd < 0 || iDesc < 0) throw new Error("no encontré las columnas Producto/Descripción");
const L = (i) => String.fromCharCode(65 + i);

const hechos = [];
for (const cambio of CAMBIOS) {
  // Buscar la fila cuyo Producto coincide.
  let fila = null;
  for (const f of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const n = Number(f[1]);
    if (n === 1) continue;
    const c = f[2].match(new RegExp(`<c r="${L(iProd)}${n}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`));
    const v = c && c[2] && c[2].match(/<v>([\s\S]*?)<\/v>/);
    const texto = v ? (/t="s"/.test(c[1]) ? CADENAS[Number(v[1])] : v[1]) : null;
    if (texto && String(texto).trim() === cambio.producto) { fila = n; break; }
  }
  if (!fila) throw new Error(`no encontré el producto "${cambio.producto}"`);

  const re = new RegExp(`<c r="${L(iDesc)}${fila}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
  const m = xml.match(re);
  if (!m) throw new Error(`no encontré la celda de descripción de "${cambio.producto}"`);
  const v = m[2] && m[2].match(/<v>([\s\S]*?)<\/v>/);
  const actual = v ? (/t="s"/.test(m[1]) ? CADENAS[Number(v[1])] : v[1]) : null;

  if (String(actual).trim() === cambio.despues.trim()) {
    hechos.push({ ...cambio, fila, estado: "ya estaba" });
    continue;
  }
  if (String(actual).trim() !== cambio.antes.trim()) {
    throw new Error(
      `la descripción de "${cambio.producto}" no es la que esperaba.\n` +
        `  esperaba: ${cambio.antes}\n` +
        `  encontré: ${actual}`,
    );
  }
  const attrs = m[1].replace(/\st="[^"]*"/g, "");
  xml = xml.replace(re, `<c r="${L(iDesc)}${fila}"${attrs} t="s"><v>${SS.idDe(cambio.despues)}</v></c>`);
  hechos.push({ ...cambio, fila, estado: "cambiada" });
}

for (const h of hechos) {
  console.log(`${h.producto} (fila ${h.fila}) — ${h.estado}`);
  if (h.estado === "cambiada") {
    console.log(`  antes:   ${h.antes}`);
    console.log(`  después: ${h.despues}`);
  }
}
console.log(`\n${SS.nuevas()} cadena(s) nueva(s) a sharedStrings.`);

if (!APLICAR) {
  console.log("\nDRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}
if (!hechos.some((h) => h.estado === "cambiada")) {
  console.log("Nada que cambiar.");
  process.exit(0);
}

SS.aplicar();
entradaDe(RUTA).contenido = Buffer.from(xml, "utf8");
guardar(entradas);
console.log(`\nEscrito ${XLSX}.`);
