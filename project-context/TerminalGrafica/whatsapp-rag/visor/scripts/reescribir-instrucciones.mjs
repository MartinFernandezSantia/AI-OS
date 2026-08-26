// Reescribe la hoja "Instrucciones" del catálogo.
//
// Por qué: la hoja original explicaba cómo COTIZAR (leer el archivo), pero no cómo CARGAR
// (escribirlo). Un Claude que reciba el archivo y tenga que agregar un producto con material
// nuevo en una colección nueva no tenía cómo saber el orden de los pasos, que la hoja _listas
// existe y está oculta, qué columnas son obligatorias según el modo, ni de dónde sale el
// número de "Piezas por pliego".
//
// Cómo: reescribe SOLO sheet1.xml (Instrucciones) + los sharedStrings que necesita, y
// reempaqueta el ZIP. El resto de las hojas queda byte-idéntico.
//
//   node scripts/reescribir-instrucciones.mjs           (dry run)
//   node scripts/reescribir-instrucciones.mjs --apply

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const XLSX = path.resolve(import.meta.dirname, "../../Catalogo-TG-v2.xlsx");
const APPLY = process.argv.includes("--apply");

// ── el contenido nuevo ─────────────────────────────────────────────────────────────────
// Cada entrada: [texto, estilo]. Estilos que YA existen en el archivo (ver styles.xml):
//   H = título principal (14pt negrita azul)   T = encabezado de sección (11pt negrita)
//   N = texto normal (Arial 10)                G = gris itálica (ejemplos y notas)
const H = "H", T = "T", N = "N", G = "G", V = null; // V = fila vacía

const LINEAS = [
  ["CÓMO USAR ESTE ARCHIVO", H],
  [V],
  ["Este archivo NO tiene precios cerrados por cantidad. Tiene el framework para calcular cualquier cantidad.", N],
  ["Cada producto dice de qué material se hace y cuánto rinde ese material. El precio sale de ahí.", N],
  [V],
  ["La primera parte explica cómo COTIZAR (leer). La segunda, cómo CARGAR cosas nuevas (escribir).", N],
  [V],
  [V],
  ["═══ PARTE 1: CÓMO COTIZAR ═══", H],
  [V],
  ['MODO "pliego" (stickers y etiquetas en papel autoadhesivo u OPP)', T],
  ['1. Piezas por pliego: la columna "Piezas por pliego" del producto ya trae el número.', N],
  ["2. Pliegos necesarios = cantidad pedida ÷ piezas por pliego, redondeando HACIA ARRIBA.", N],
  ["3. Buscar en Materiales el tramo que contiene esa cantidad de PLIEGOS (no de piezas).", N],
  ["4. Total = pliegos × el precio de ese tramo.", N],
  [V],
  ["   Ejemplo: 250 stickers 3x3. Entran 104 por pliego. 250 ÷ 104 = 2,4 → 3 pliegos.", G],
  ["   3 pliegos cae en el tramo 2-10 → $2.200. Total = 3 × 2.200 = $6.600.", G],
  [V],
  ["   OJO: el tramo se busca por PLIEGOS. Con 3 pliegos el tramo es 2-10, no el de 101+.", G],
  [V],
  ['MODO "m2" (vinilos, lonas, carteles)', T],
  ["1. m2 de una pieza = (ancho × alto) ÷ 10.000. Las medidas están en centímetros.", N],
  ["2. m2 totales = m2 de una pieza × cantidad pedida.", N],
  ["3. Si el resultado es menor al mínimo facturable del material, se cobra el mínimo.", N],
  ["4. Total = m2 facturados × el precio por m2 del material.", N],
  [V],
  ["   Ejemplo: 100 stickers en vinilo UV de 5x5. Una pieza = 25 ÷ 10.000 = 0,0025 m2.", G],
  ["   100 piezas = 0,25 m2. Es menos que el mínimo de 0,5 → se cobran 0,5 m2.", G],
  ["   Total = 0,5 × 28.000 = $14.000.", G],
  [V],
  ["¿CUÁL DE LOS DOS MODOS?", T],
  ['Lo decide la columna "Unidad" del MATERIAL, no el producto. Si empieza con "pliego" → modo', N],
  ['pliego. Si es "m2" → modo m2. El producto no dice el modo en ningún lado.', N],
  [V],
  ["AL FINAL, SIEMPRE", T],
  ["- Aplicar el mínimo por trabajo de la hoja Parámetros.", N],
  ["- Redondear al múltiplo indicado en Parámetros.", N],
  [V],
  ["MEDIDAS QUE NO ESTÁN", T],
  ["Si piden una medida que no figura en Productos, no inventar el rinde: derivar a consulta por mail.", N],
  [V],
  [V],
  ["═══ PARTE 2: CÓMO CARGAR COSAS NUEVAS ═══", H],
  [V],
  ["LAS HOJAS Y PARA QUÉ SIRVEN", T],
  ["Colecciones — las familias de productos. Su descripción encabeza el bloque que lee el bot.", N],
  ["Productos   — lo que se ofrece. La cantidad NO va acá: la pide el cliente.", N],
  ["Materiales  — precios y tramos. Un material sin escala por volumen = un solo tramo.", N],
  ["Parámetros  — mínimo por trabajo, redondeo, moneda.", N],
  ["Casos de prueba — NO se usa para cotizar. Verifica que el bot calcula bien.", N],
  ["_listas     — hoja OCULTA. Alimenta los desplegables. Ver abajo, hay que tocarla.", N],
  [V],
  ["EL ORDEN IMPORTA: colección → material → producto", T],
  ["Las columnas Colección y Material de la hoja Productos son DESPLEGABLES. Solo ofrecen valores", N],
  ["que ya existen. Si cargás el producto primero, el desplegable no va a tener qué ofrecerte.", N],
  [V],
  ["EJEMPLO COMPLETO: producto nuevo, material nuevo, colección nueva", T],
  ['Pedido: "agregar imanes de heladera 8x5 cm, se hacen en imán flexible, $18.000 el m2, mínimo 0,3 m2".', G],
  [V],
  ["PASO 1 — Colección nueva. En la hoja Colecciones, primera fila libre:", N],
  ["   Colección:   Imanes", G],
  ["   Descripción: Imanes flexibles impresos full color, cortados con forma. Para heladera,", G],
  ["                pizarras y superficies metálicas. Se cotizan por metro cuadrado.", G],
  ["   La descripción es lo que lee el bot: que se entienda sola, sin nombrar otras colecciones.", N],
  [V],
  ["PASO 2 — Material nuevo. En la hoja Materiales, primera fila libre:", N],
  ["   Material: Imán flexible | Unidad: m2 | Desde: 1 | Hasta: (vacío)", G],
  ["   Precio por unidad: 18000 | Mínimo facturable: 0,3 | Nota: confirmado el 26/08/2026", G],
  [V],
  ["PASO 3 — Registrar los dos en _listas (la hoja oculta). SIN ESTE PASO LOS DESPLEGABLES NO", N],
  ["   LOS OFRECEN. Mostrar la hoja (clic derecho en las pestañas → Mostrar) y agregar:", N],
  ["   columna A → el material nuevo   ·   columna B → la colección nueva", G],
  ["   Van en la primera fila libre de cada columna, sin dejar huecos en el medio.", G],
  [V],
  ["PASO 4 — Producto. En la hoja Productos, primera fila libre:", N],
  ["   Colección: Imanes (ya aparece en el desplegable) | Producto: Imán 8x5 cm", G],
  ["   Descripción: Imán flexible impreso full color, cortado con forma.", G],
  ["   Material: Imán flexible | Ancho: 8 | Alto: 5 | Piezas por pliego: (vacío, es modo m2)", G],
  [V],
  ["QUÉ COLUMNAS SON OBLIGATORIAS", T],
  ["Depende del modo del material, y es al revés en cada uno:", N],
  ["   Modo pliego → el PRODUCTO necesita 'Piezas por pliego'. El material NO lleva mínimo facturable.", N],
  ["   Modo m2     → el MATERIAL necesita 'Mínimo facturable'. El producto deja 'Piezas por pliego' vacío.", N],
  ["Una columna vacía no es un error: es lo que hace que el bot no vea datos que no corresponden.", N],
  [V],
  ["CÓMO SE ESCRIBE UNA ESCALA DE PRECIOS", T],
  ["Un material = una o más filas en Materiales, todas con el MISMO nombre en la columna Material.", N],
  ["   Precio fijo, sin descuento por volumen → UNA fila: Desde 1, Hasta vacío.", N],
  ["   Con descuento por volumen → una fila por tramo. Desde/Hasta sin huecos ni superposiciones.", N],
  ["   El último tramo va con Hasta VACÍO: significa 'de acá en adelante'.", N],
  [V],
  ["   Ejemplo de escala: 1 a 1 → 2500 · 2 a 10 → 2200 · 11 a 50 → 2000 · 101 a (vacío) → 1710", G],
  [V],
  ['DE DÓNDE SALE "PIEZAS POR PLIEGO"', T],
  ["Es geometría, no un dato que se inventa. Sobre el pliego A3, con estas áreas útiles:", N],
  ["   Troquelado o medio corte: 28 x 44 cm, con 0,3 cm de separación entre piezas.", N],
  ["   Solo impresión:           31 x 46 cm, sin separación.", N],
  ["Fórmula: (columnas que entran a lo ancho) × (filas que entran a lo alto), redondeando cada", N],
  ["división HACIA ABAJO. Se prueban las DOS orientaciones y se toma la que rinde más.", N],
  [V],
  ["   Ejemplo: pieza de 12x8 troquelada.", G],
  ["   Acostada (12 de ancho): 28,3÷12,3 = 2 columnas × 44,3÷8,3 = 5 filas = 10 piezas.", G],
  ["   Parada   (8 de ancho):  28,3÷8,3 = 3 columnas × 44,3÷12,3 = 3 filas = 9 piezas.", G],
  ["   Se toma 10. (Se suma la separación al área y a la pieza antes de dividir.)", G],
  [V],
  ["LÍMITES DE CRECIMIENTO", T],
  ["Los desplegables y la validación cubren un rango fijo. Hoy hay lugar para:", N],
  ["   Productos: hasta la fila 72 · Materiales en _listas: hasta A42 · Colecciones: hasta B35", N],
  ["Pasado eso el desplegable deja de funcionar SIN AVISAR. Si se llega al tope, hay que extender", N],
  ["el rango (Datos → Validación) y el nombre definido, o avisar para que lo hagamos nosotros.", N],
  [V],
  ["ERRORES QUE ROMPEN EN SILENCIO", T],
  ["- Escribir el material a mano con una letra distinta a la de Materiales: el producto queda sin precio.", N],
  ['- Poner "por pliego" o "metro cuadrado" en Unidad: solo valen "pliego A3" y "m2".', N],
  ["- Dejar 'Piezas por pliego' vacío en un producto de modo pliego: no se puede cotizar.", N],
  ["- Tramos superpuestos (1-10 y 5-20): se aplica el primero que coincide, y puede no ser el que querías.", N],
  ["- Cargar un producto en una colección que no existe en la hoja Colecciones: queda sin descripción.", N],
  [V],
  ["DESPUÉS DE EDITAR", T],
  ["Guardar el archivo y volver a cargarlo en el visor de chunks para ver qué va a leer el bot.", N],
  ["Los cambios NO llegan al bot hasta que se ingesta desde ahí.", N],
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

// ── estilos: reusar los que la hoja ya usaba ───────────────────────────────────────────
// Se toman del sheet1 ACTUAL, no se inventan, así la hoja mantiene el mismo look:
//   fila 1  = "CÓMO SE COTIZA…"   → título principal (14pt negrita azul)
//   fila 27 = "AL FINAL, SIEMPRE" → encabezado de sección (11pt negrita)
//   fila 3  = texto corrido       → normal (Arial 10)
//   fila 12 = "   Ejemplo: …"     → gris itálica
const sheet1 = get("xl/worksheets/sheet1.xml").contenido.toString("utf8");
const estilosUsados = [...sheet1.matchAll(/<c r="A(\d+)"(?:[^>]*\bs="(\d+)")?[^>]*>/g)]
  .map((m) => ({ fila: Number(m[1]), s: m[2] ?? "0" }));
const sDe = (fila, fallback) => estilosUsados.find((e) => e.fila === fila)?.s ?? fallback;
const S_H = sDe(1, "0");
const S_NORMAL = sDe(3, "0");
const S_T = sDe(27, S_NORMAL);
const S_GRIS = sDe(12, S_NORMAL);
const EST = { [H]: S_H, [T]: S_T, [N]: S_NORMAL, [G]: S_GRIS };

// ── sharedStrings: agregar los textos nuevos ───────────────────────────────────────────
const ssEntry = get("xl/sharedStrings.xml");
const ssXml = ssEntry.contenido.toString("utf8");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const existentes = [];
for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
  let t = "";
  for (const tm of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += dec(tm[1]);
  existentes.push(t);
}
const indice = new Map(existentes.map((t, i) => [t, i]));
const nuevos = [];
const idDe = (texto) => {
  if (indice.has(texto)) return indice.get(texto);
  const id = existentes.length + nuevos.length;
  nuevos.push(texto);
  indice.set(texto, id);
  return id;
};

const filas = LINEAS.map(([texto, estilo], i) => {
  const r = i + 1;
  if (texto === V) return `<row r="${r}"/>`;
  const sid = idDe(texto);
  const s = EST[estilo] ?? "0";
  return `<row r="${r}"><c r="A${r}" s="${s}" t="s"><v>${sid}</v></c></row>`;
}).join("");

const siNuevos = nuevos
  .map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`)
  .join("");
const totalSi = existentes.length + nuevos.length;
ssEntry.contenido = Buffer.from(
  ssXml
    .replace(/<sst([^>]*)>/, (m0, attrs) =>
      `<sst${attrs.replace(/count="\d+"/, `count="${totalSi}"`).replace(/uniqueCount="\d+"/, `uniqueCount="${totalSi}"`)}>`)
    .replace("</sst>", siNuevos + "</sst>"),
  "utf8",
);

// ── sheet1: reemplazar sheetData, conservando cols/sheetViews ──────────────────────────
const s1 = get("xl/worksheets/sheet1.xml");
s1.contenido = Buffer.from(
  sheet1.replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${filas}</sheetData>`),
  "utf8",
);

console.log(`archivo: ${XLSX}`);
console.log(`filas nuevas en Instrucciones: ${LINEAS.length} (antes 41)`);
console.log(`sharedStrings: ${existentes.length} → ${totalSi} (+${nuevos.length})`);
console.log(`estilos reusados: H=s${S_H} seccion=s${S_T} normal=s${S_NORMAL} gris=s${S_GRIS}`);

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}

// ── reempaquetar ───────────────────────────────────────────────────────────────────────
const crc32 = (() => {
  const T2 = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    T2[i] = c;
  }
  return (b) => {
    let c = -1;
    for (let i = 0; i < b.length; i++) c = T2[(c ^ b[i]) & 0xff] ^ (c >>> 8);
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
console.log(`\n✓ Instrucciones reescrita: ${LINEAS.length} filas.`);
