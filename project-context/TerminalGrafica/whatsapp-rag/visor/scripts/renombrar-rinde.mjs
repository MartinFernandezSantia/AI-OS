// Renombra la columna "Piezas por pliego" → "Piezas por unidad de cobro" y actualiza las
// menciones en la hoja Instrucciones.
//
// Por qué: la columna no es exclusiva del pliego. Es el factor de conversión entre lo que
// pide el cliente y lo que se cobra — sirve igual para plancha, bobina o chapa. El texto del
// chunk YA era genérico ("entran N por <unidad del material>"); solo el header quedó atado.
//
// El código acepta los dos nombres, así que este cambio no es urgente ni rompe nada.
//
//   node scripts/renombrar-rinde.mjs           (dry run)
//   node scripts/renombrar-rinde.mjs --apply

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const XLSX = path.resolve(import.meta.dirname, "../../Catalogo-TG-v2.xlsx");
const APPLY = process.argv.includes("--apply");

const VIEJO = "Piezas por pliego";
const NUEVO = "Piezas por unidad de cobro";

/** Reemplazos de texto completo (celdas exactas). */
const EXACTOS = new Map([[VIEJO, NUEVO]]);

/** Reemplazos DENTRO de una línea de las instrucciones: [regex, reemplazo]. */
const PARCIALES = [
  [
    /^1\. Piezas por pliego: la columna "Piezas por pliego" del producto ya trae el número\.$/,
    '1. Rinde: la columna "Piezas por unidad de cobro" del producto ya trae el número.',
  ],
  [
    /^ {3}Modo pliego → el PRODUCTO necesita 'Piezas por pliego'\. El material NO lleva mínimo facturable\.$/,
    "   Modo pliego → el PRODUCTO necesita 'Piezas por unidad de cobro'. El material NO lleva mínimo facturable.",
  ],
  [
    /^ {3}Modo m2 {5}→ el MATERIAL necesita 'Mínimo facturable'\. El producto deja 'Piezas por pliego' vacío\.$/,
    "   Modo m2     → el MATERIAL necesita 'Mínimo facturable'. El producto deja el rinde vacío.",
  ],
  [
    /^ {3}Material: Imán flexible \| Ancho: 8 \| Alto: 5 \| Piezas por pliego: \(vacío, es modo m2\)$/,
    "   Material: Imán flexible | Ancho: 8 | Alto: 5 | Piezas por unidad de cobro: (vacío, es modo m2)",
  ],
  [
    /^- Producto de modo pliego sin 'Piezas por pliego': el chunk sale con precio pero SIN el rinde,$/,
    "- Producto de modo pliego sin rinde: el chunk sale con precio pero SIN cuántas piezas entran,",
  ],
  [
    /^ {3}3\. El producto NO lleva 'Piezas por pliego' ni el material 'Mínimo facturable'\.$/,
    "   3. El producto NO lleva rinde ni el material 'Mínimo facturable'.",
  ],
  [
    /^DE DÓNDE SALE "PIEZAS POR PLIEGO"$/,
    'DE DÓNDE SALE EL RINDE ("Piezas por unidad de cobro")',
  ],
  [
    /^Es geometría, no un dato que se inventa\. Sobre el pliego A3, con estas áreas útiles:$/,
    "Cuántas piezas salen de UNA unidad de cobro. Si la unidad es el pliego A3, es geometría:",
  ],
];

/** Líneas a insertar después de un ancla, para explicar el concepto general. */
const INSERTAR_DESPUES = [
  [
    "Cuántas piezas salen de UNA unidad de cobro. Si la unidad es el pliego A3, es geometría:",
    ["(Para otras unidades — una bobina, una plancha — es cuántas piezas rinde: dato del taller.)", "N"],
  ],
];

// ── leer el ZIP ────────────────────────────────────────────────────────────────────────
const buf = fs.readFileSync(XLSX);
let eocd = -1;
for (let i = buf.length - 22; i >= 0; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
const nEnt = buf.readUInt16LE(eocd + 10);
let off = buf.readUInt32LE(eocd + 16);
const entradas = [];
for (let e = 0; e < nEnt; e++) {
  const metodo = buf.readUInt16LE(off + 10);
  const csize = buf.readUInt32LE(off + 20);
  const nl = buf.readUInt16LE(off + 28);
  const xl = buf.readUInt16LE(off + 30);
  const cl = buf.readUInt16LE(off + 32);
  const lo = buf.readUInt32LE(off + 42);
  const nombre = buf.toString("utf8", off + 46, off + 46 + nl);
  off += 46 + nl + xl + cl;
  const lnl = buf.readUInt16LE(lo + 26);
  const lxl = buf.readUInt16LE(lo + 28);
  const ini = lo + 30 + lnl + lxl;
  const d = buf.subarray(ini, ini + csize);
  entradas.push({ nombre, contenido: metodo === 0 ? d : zlib.inflateRawSync(d) });
}
const get = (n) => entradas.find((e) => e.nombre === n);

const dec = (s) =>
  s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── sharedStrings ──────────────────────────────────────────────────────────────────────
const ssEntry = get("xl/sharedStrings.xml");
const ssXml = ssEntry.contenido.toString("utf8");
const cadenas = [];
for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
  let t = "";
  for (const tm of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += dec(tm[1]);
  cadenas.push(t);
}

let nExactos = 0, nParciales = 0;
const nuevas = cadenas.map((t) => {
  if (EXACTOS.has(t)) { nExactos++; return EXACTOS.get(t); }
  for (const [re, rep] of PARCIALES) {
    if (re.test(t)) { nParciales++; return rep; }
  }
  return t;
});

// ── insertar líneas nuevas en Instrucciones ────────────────────────────────────────────
const sheet1 = get("xl/worksheets/sheet1.xml").contenido.toString("utf8");
const filas = []; // {texto, s} · texto null = vacía
let esperada = 1;
for (const m of sheet1.matchAll(/<row r="(\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/row>)/g)) {
  const r = Number(m[1]);
  while (esperada < r) { filas.push({ texto: null, s: null }); esperada++; }
  const c = (m[2] ?? "").match(/<c r="A\d+"(?:[^>]*\bs="(\d+)")?[^>]*>(?:<v>(\d+)<\/v>)?/);
  filas.push(
    c ? { texto: c[2] !== undefined ? nuevas[Number(c[2])] : null, s: c[1] ?? "0" }
      : { texto: null, s: null },
  );
  esperada = r + 1;
}

const S_N = filas.find((f) => f.texto === "Los desplegables y la validación cubren un rango fijo. Hoy hay lugar para:")?.s ?? "0";
let nInsert = 0;
for (const [ancla, [texto]] of INSERTAR_DESPUES) {
  const i = filas.findIndex((f) => f.texto === ancla);
  if (i >= 0) { filas.splice(i + 1, 0, { texto, s: S_N }); nInsert++; }
  else console.warn(`  ! ancla no encontrada: "${ancla.slice(0, 45)}…"`);
}

console.log(`archivo: ${XLSX}`);
console.log(`header renombrado: ${nExactos} · líneas de instrucciones actualizadas: ${nParciales} · insertadas: ${nInsert}`);
if (nExactos === 0) console.warn(`  ! no se encontró la celda exacta "${VIEJO}"`);

// ── reconstruir sharedStrings + sheet1 ─────────────────────────────────────────────────
const indice = new Map();
nuevas.forEach((t, i) => { if (!indice.has(t)) indice.set(t, i); });
const extra = [];
const idDe = (t) => {
  if (indice.has(t)) return indice.get(t);
  const id = nuevas.length + extra.length;
  extra.push(t);
  indice.set(t, id);
  return id;
};

const ATTRS = (sheet1.match(/<row r="\d+"([^>]*?)(?:\/>|>)/) ?? [, ""])[1].replace(/\s*ht="[\d.]+"/, "");
const filasXml = filas
  .map((f, i) => {
    const r = i + 1;
    return f.texto === null
      ? `<row r="${r}"${ATTRS}/>`
      : `<row r="${r}"${ATTRS}><c r="A${r}" s="${f.s}" t="s"><v>${idDe(f.texto)}</v></c></row>`;
  })
  .join("");

const total = nuevas.length + extra.length;
const siXml = [...nuevas, ...extra].map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join("");
ssEntry.contenido = Buffer.from(
  ssXml
    .replace(/<sst([^>]*)>/, (m0, a) =>
      `<sst${a.replace(/count="\d+"/, `count="${total}"`).replace(/uniqueCount="\d+"/, `uniqueCount="${total}"`)}>`)
    .replace(/<si>[\s\S]*<\/si>/, siXml),
  "utf8",
);
get("xl/worksheets/sheet1.xml").contenido = Buffer.from(
  sheet1
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${filasXml}</sheetData>`)
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:A${filas.length}"/>`),
  "utf8",
);

console.log(`sharedStrings: ${cadenas.length} → ${total}`);
console.log(`Instrucciones: ${filas.length} filas`);

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}

// ── reempaquetar ───────────────────────────────────────────────────────────────────────
const crc32 = (() => {
  const TB = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TB[i] = c;
  }
  return (b) => {
    let c = -1;
    for (let i = 0; i < b.length; i++) c = TB[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

const locales = [], central = [];
let cursor = 0;
for (const en of entradas) {
  const nombre = Buffer.from(en.nombre, "utf8");
  const comp = zlib.deflateRawSync(en.contenido, { level: 9 });
  const crc = crc32(en.contenido);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(en.contenido.length, 22); lh.writeUInt16LE(nombre.length, 26);
  locales.push(lh, nombre, comp);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(en.contenido.length, 24); ch.writeUInt16LE(nombre.length, 28);
  ch.writeUInt32LE(cursor, 42);
  central.push(ch, nombre);
  cursor += lh.length + nombre.length + comp.length;
}
const cuerpo = Buffer.concat(locales), dir = Buffer.concat(central);
const eo = Buffer.alloc(22);
eo.writeUInt32LE(0x06054b50, 0);
eo.writeUInt16LE(entradas.length, 8); eo.writeUInt16LE(entradas.length, 10);
eo.writeUInt32LE(dir.length, 12); eo.writeUInt32LE(cuerpo.length, 16);
fs.writeFileSync(XLSX, Buffer.concat([cuerpo, dir, eo]));
console.log(`\n✓ Columna renombrada a "${NUEVO}".`);
