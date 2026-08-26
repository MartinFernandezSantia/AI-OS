// Agrega a la hoja "Instrucciones" la sección que faltaba: qué hacer con una unidad de
// cobro distinta a las dos que existen hoy (pliego A3 y m2).
//
// Por qué: la hoja explicaba dos modos de cálculo y nada más. Peor, la sección de errores
// decía "solo valen pliego A3 y m2", que es FALSO — verificado corriendo el parser: una
// unidad nueva ("unidad", "metro lineal") produce un chunk perfectamente redactado
// ("Precio por metro lineal — Cinta: $1.200"). Lo que no existe es la FÓRMULA para cotizarla,
// así que el bot improvisa.
//
// Inserta la sección nueva antes de "ERRORES QUE ROMPEN EN SILENCIO" y corrige la línea
// incorrecta de esa sección.
//
//   node scripts/instrucciones-unidades.mjs           (dry run)
//   node scripts/instrucciones-unidades.mjs --apply

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const XLSX = path.resolve(import.meta.dirname, "../../Catalogo-TG-v2.xlsx");
const APPLY = process.argv.includes("--apply");

const T = "T", N = "N", G = "G", V = null;

/** La sección nueva, que se inserta ANTES de "ERRORES QUE ROMPEN EN SILENCIO". */
const SECCION = [
  ["UNA UNIDAD DE COBRO NUEVA (algo que no se cobra por pliego ni por m2)", T],
  ["Hoy existen dos: 'pliego A3' y 'm2'. Cada una tiene su fórmula en la PARTE 1.", N],
  ["Se puede agregar otra (por unidad, por metro lineal, por hora), y el archivo la acepta:", N],
  ["el precio se muestra bien solo. Lo que NO existe es la fórmula para cotizarla.", N],
  [V],
  ["Si agregás una unidad nueva, hay que escribir su regla de cálculo acá abajo, en la PARTE 1.", N],
  ["Sin eso el bot no sabe cómo pasar de lo que pide el cliente al total, y va a improvisar.", N],
  [V],
  ["   Ejemplo — cobrar por unidad suelta:", G],
  ["   1. Agregar el material con Unidad: unidad (ej. Imán suelto, $900, Desde 1, Hasta vacío).", G],
  ["   2. Agregar acá una sección MODO \"unidad\": Total = cantidad pedida × precio del tramo.", G],
  ["   3. El producto NO lleva 'Piezas por pliego' ni el material 'Mínimo facturable'.", G],
  [V],
  ["CUIDADO CON LOS NOMBRES PARECIDOS", T],
  ["El modo se decide por cómo EMPIEZA la unidad, no por el nombre completo:", N],
  ["   'pliego A3', 'pliego A4', 'pliego doble' → todas caen en modo pliego.", N],
  ["   'm2', 'M2', 'm2 con laminado'            → todas caen en modo m2.", N],
  ["Si tu unidad nueva se cobra distinto, NO la llames empezando con 'pliego' ni con 'm2':", N],
  ["se va a calcular con la fórmula equivocada y sin ningún aviso.", N],
  [V],
  ["   'metro cuadrado' NO es lo mismo que 'm2': no empieza igual, así que no entra en modo m2", G],
  ["   y queda sin fórmula. Para metros cuadrados escribí siempre 'm2'.", G],
  [V],
];

/** Reemplazos puntuales sobre líneas existentes: [texto viejo, texto nuevo]. */
const CORRECCIONES = [
  [
    '- Poner "por pliego" o "metro cuadrado" en Unidad: solo valen "pliego A3" y "m2".',
    '- Escribir "metro cuadrado" en vez de "m2": no entra en modo m2 y el material queda sin fórmula.',
  ],
  [
    "- Dejar 'Piezas por pliego' vacío en un producto de modo pliego: no se puede cotizar.",
    "- Producto de modo pliego sin 'Piezas por pliego': el chunk sale con precio pero SIN el rinde,",
  ],
];

/** Líneas extra a insertar justo después de una línea existente. */
const INSERTAR_DESPUES = [
  [
    "- Producto de modo pliego sin 'Piezas por pliego': el chunk sale con precio pero SIN el rinde,",
    ["  así que parece completo y no lo está. El bot no puede dividir y va a inventar el número.", N],
  ],
];

const ANCLA = "ERRORES QUE ROMPEN EN SILENCIO";

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

// ── leer la hoja actual: [texto, estilo] por fila ──────────────────────────────────────
const dec = (s) =>
  s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const ssEntry = get("xl/sharedStrings.xml");
const ssXml = ssEntry.contenido.toString("utf8");
const existentes = [];
for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
  let t = "";
  for (const tm of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += dec(tm[1]);
  existentes.push(t);
}

const sheet1 = get("xl/worksheets/sheet1.xml").contenido.toString("utf8");

// OJO: las filas vacías NO existen como <row> — el XML salta de r="1" a r="3". Hay que
// reconstruir los huecos a partir del atributo r, o al reescribir se aplastan todas las
// separaciones y la hoja queda un bloque ilegible. (LibreOffice normaliza así al guardar.)
const actual = []; // [{texto, s}]  · texto null = fila vacía
let esperada = 1;
for (const m of sheet1.matchAll(/<row r="(\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/row>)/g)) {
  const r = Number(m[1]);
  while (esperada < r) { actual.push({ texto: null, s: null }); esperada++; }
  const c = (m[2] ?? "").match(/<c r="A\d+"(?:[^>]*\bs="(\d+)")?[^>]*>(?:<v>(\d+)<\/v>)?/);
  actual.push(
    c ? { texto: c[2] !== undefined ? existentes[Number(c[2])] : null, s: c[1] ?? "0" }
      : { texto: null, s: null },
  );
  esperada = r + 1;
}

// Estilos, tomados de la hoja misma (no se inventan).
const porTexto = (t) => actual.find((f) => f.texto === t)?.s;
const S_T = porTexto(ANCLA) ?? "0";
const S_N = porTexto("- Cargar un producto en una colección que no existe en la hoja Colecciones: queda sin descripción.") ?? "0";
const S_G = porTexto("   Ejemplo: pieza de 12x8 troquelada.") ?? S_N;
const EST = { [T]: S_T, [N]: S_N, [G]: S_G };

// ── construir la hoja nueva ────────────────────────────────────────────────────────────
const idx = actual.findIndex((f) => f.texto === ANCLA);
if (idx < 0) throw new Error(`No se encontró la línea ancla "${ANCLA}" en la hoja.`);

// 1) correcciones sobre líneas existentes
let corregidas = 0;
for (const [viejo, nuevo] of CORRECCIONES) {
  const f = actual.find((x) => x.texto === viejo);
  if (f) { f.texto = nuevo; corregidas++; }
  else console.warn(`  ! no se encontró para corregir: "${viejo.slice(0, 50)}…"`);
}

// 2) inserciones puntuales después de una línea
let insertadas = 0;
for (const [ancla, [texto, estilo]] of INSERTAR_DESPUES) {
  const i = actual.findIndex((x) => x.texto === ancla);
  if (i >= 0) { actual.splice(i + 1, 0, { texto, s: EST[estilo] }); insertadas++; }
  else console.warn(`  ! no se encontró el ancla de inserción: "${ancla.slice(0, 50)}…"`);
}

// 3) la sección nueva, antes del ancla (recalculado tras los splices)
const idx2 = actual.findIndex((f) => f.texto === ANCLA);
const nuevasFilas = SECCION.map(([texto, estilo]) =>
  texto === V ? { texto: null, s: null } : { texto, s: EST[estilo] },
);
actual.splice(idx2, 0, ...nuevasFilas);

// ── sharedStrings: agregar lo que falte ────────────────────────────────────────────────
const indice = new Map(existentes.map((t, i) => [t, i]));
const nuevos = [];
const idDe = (texto) => {
  if (indice.has(texto)) return indice.get(texto);
  const id = existentes.length + nuevos.length;
  nuevos.push(texto);
  indice.set(texto, id);
  return id;
};

// Atributos de fila que usa el archivo (altura, etc.), para no perder el formato.
const ATTRS = (sheet1.match(/<row r="\d+"([^>]*?)(?:\/>|>)/) ?? [, ""])[1]
  .replace(/\s*ht="[\d.]+"/, ""); // la altura se deja al default: los textos varían

const filasXml = actual
  .map((f, i) => {
    const r = i + 1;
    if (f.texto === null) return `<row r="${r}"${ATTRS}/>`;
    return `<row r="${r}"${ATTRS}><c r="A${r}" s="${f.s}" t="s"><v>${idDe(f.texto)}</v></c></row>`;
  })
  .join("");

const totalSi = existentes.length + nuevos.length;
ssEntry.contenido = Buffer.from(
  ssXml
    .replace(/<sst([^>]*)>/, (m0, attrs) =>
      `<sst${attrs.replace(/count="\d+"/, `count="${totalSi}"`).replace(/uniqueCount="\d+"/, `uniqueCount="${totalSi}"`)}>`)
    .replace("</sst>", nuevos.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join("") + "</sst>"),
  "utf8",
);
get("xl/worksheets/sheet1.xml").contenido = Buffer.from(
  sheet1
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${filasXml}</sheetData>`)
    // El rango declarado tiene que cubrir las filas nuevas.
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:A${actual.length}"/>`),
  "utf8",
);

console.log(`archivo: ${XLSX}`);
console.log(`filas: ${actual.length - nuevasFilas.length - insertadas} → ${actual.length}`);
console.log(`sección nueva: ${SECCION.length} filas · correcciones: ${corregidas} · inserciones: ${insertadas}`);
console.log(`sharedStrings: ${existentes.length} → ${totalSi} (+${nuevos.length})`);
console.log(`estilos: seccion=s${S_T} normal=s${S_N} gris=s${S_G}`);

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
console.log(`\n✓ Hoja actualizada: ${actual.length} filas.`);
