// Cruza la "Lista de precios" del Excel del cliente contra lo YA CARGADO en el v3, para
// ver qué falta. Solo lee; el reporte va a stdout.
//
//   node visor/scripts/pendientes-cliente.mjs
import { readFileSync } from "node:fs";
import zlib from "node:zlib";

const RAIZ = new URL("../../", import.meta.url).pathname;
const CLIENTE = RAIZ + "Catalogo-cliente-PENDIENTES.xlsx";
const V3 = RAIZ + "Catalogo-TG-v3.xlsx";

// ── Lectura cruda del .xlsx (sin librería: no hay unzip disponible) ──────────────────
function entradasDe(ruta) {
  const buf = readFileSync(ruta);
  const out = new Map();
  // Se recorre el DIRECTORIO CENTRAL: sus offsets son los confiables (el local header
  // miente sobre los tamaños cuando hay data descriptor).
  let fin = buf.length - 22;
  while (fin >= 0 && buf.readUInt32LE(fin) !== 0x06054b50) fin--;
  let p = buf.readUInt32LE(fin + 16);
  const n = buf.readUInt16LE(fin + 10);
  for (let i = 0; i < n; i++) {
    const metodo = buf.readUInt16LE(p + 10);
    const compLen = buf.readUInt32LE(p + 20);
    const nomLen = buf.readUInt16LE(p + 28);
    const extLen = buf.readUInt16LE(p + 30);
    const comLen = buf.readUInt16LE(p + 32);
    const offLocal = buf.readUInt32LE(p + 42);
    const nombre = buf.toString("utf8", p + 46, p + 46 + nomLen);
    // El local header tiene SUS PROPIAS longitudes de nombre/extra: hay que releerlas.
    const lNom = buf.readUInt16LE(offLocal + 26);
    const lExt = buf.readUInt16LE(offLocal + 28);
    const ini = offLocal + 30 + lNom + lExt;
    const datos = buf.subarray(ini, ini + compLen);
    out.set(nombre, metodo === 8 ? zlib.inflateRawSync(datos) : datos);
    p += 46 + nomLen + extLen + comLen;
  }
  return out;
}

const dec = (s) =>
  String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

function libro(ruta) {
  const E = entradasDe(ruta);
  const txt = (n) => (E.get(n) ?? Buffer.alloc(0)).toString("utf8");
  // Cadenas compartidas: un <si> puede traer VARIOS <t> (texto con formato mezclado).
  const cadenas = [...txt("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
  const hojas = [...txt("xl/workbook.xml").matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"[^>]*\/?>/g)].map((m) => ({
    nombre: dec(m[1]),
    rid: m[2],
  }));
  const rid = Object.fromEntries(
    [...txt("xl/_rels/workbook.xml.rels").matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );
  return {
    filas(nombreHoja) {
      const h = hojas.find((x) => x.nombre === nombreHoja);
      if (!h) throw new Error(`no hay hoja "${nombreHoja}" en ${ruta}`);
      const xml = txt("xl/" + rid[h.rid].replace(/^\//, ""));
      const out = [];
      for (const f of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
        const o = { __r: Number(f[1]) };
        for (const c of f[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const v = (c[3] || "").match(/<v>([\s\S]*?)<\/v>/);
          if (!v) continue;
          o[c[1]] = /t="s"/.test(c[2]) ? String(cadenas[Number(v[1])] ?? "") : v[1];
        }
        out.push(o);
      }
      return out;
    },
  };
}

// ── Lo que YA está cargado en el v3 ──────────────────────────────────────────────────
const v3 = libro(V3);
const filasV3 = v3.filas("Productos");
const encV3 = filasV3[0];
const colV3 = (n) => Object.keys(encV3).find((k) => encV3[k] === n);
const cProd = colV3("Producto"), cCol = colV3("Colección"), cMat = colV3("Material");

const cargados = filasV3.slice(1).filter((f) => f[cProd]).map((f) => ({
  producto: f[cProd],
  coleccion: f[cCol] ?? "",
  material: f[cMat] ?? "",
}));

// ── Lo que trae el cliente ───────────────────────────────────────────────────────────
const cli = libro(CLIENTE);
const filasCli = cli.filas("Lista de precios");
// El encabezado real está en la fila 16, no en la 1: arriba hay tarifas y notas.
const enc = filasCli.find((f) => f.A === "Colección" && f.C === "Producto");
if (!enc) throw new Error('no encontré el encabezado ("Colección … Producto") en Lista de precios');
const col = (n) => Object.keys(enc).find((k) => enc[k] === n);

const C = {
  coleccion: col("Colección"),
  tamano: col("Tamaño"),
  producto: col("Producto"),
  precio: col("PRECIO"),
  descripcion: col("Descripción para el catálogo"),
  linea: col("Línea de precio"),
  modo: col("Modo"),
  ancho: col("Ancho (cm)"),
  alto: col("Alto (cm)"),
  cant: col("Cant."),
  sinonimos: col("Sinónimos (cómo lo pide el cliente)"),
  preguntar: col("Preguntar antes de cotizar"),
  minimo: col("Mínimo"),
  multiplo: col("Múltiplo"),
  plazo: col("Plazo"),
  archivo: col("Archivo que manda el cliente"),
  respuesta: col("Respuesta corta para WhatsApp"),
  noConfundir: col("No confundir con"),
};

const desde = enc.__r + 1;
const delCliente = filasCli
  .filter((f) => f.__r >= desde && f[C.producto])
  .map((f) => ({
    fila: f.__r,
    coleccion: f[C.coleccion] ?? "",
    tamano: f[C.tamano] ?? "",
    producto: f[C.producto],
    precio: f[C.precio] ?? "",
    descripcion: f[C.descripcion] ?? "",
    linea: f[C.linea] ?? "",
    modo: f[C.modo] ?? "",
    ancho: f[C.ancho] ?? "",
    alto: f[C.alto] ?? "",
    cant: f[C.cant] ?? "",
    sinonimos: f[C.sinonimos] ?? "",
    preguntar: f[C.preguntar] ?? "",
    minimo: f[C.minimo] ?? "",
    multiplo: f[C.multiplo] ?? "",
    plazo: f[C.plazo] ?? "",
    archivo: f[C.archivo] ?? "",
    respuesta: f[C.respuesta] ?? "",
    noConfundir: f[C.noConfundir] ?? "",
  }));

// ── El cruce ─────────────────────────────────────────────────────────────────────────
// OJO con qué significa "ya está cargado". Nuestro catálogo NO guarda productos cerrados:
// guarda MATERIALES con su escala, y el bot calcula cualquier medida. Así que las 20 filas
// de stickers del cliente ("250 stickers 3x3", "100 stickers 5x5"…) son UNA sola línea
// nuestra — el material "Papel autoadhesivo troquelado" — y ya cotizan todas.
//
// Por eso el cruce va por LÍNEA DE PRECIO (la columna que el propio cliente usa para
// agrupar), no por nombre de producto: comparar nombres daría 123 "faltantes" que en
// realidad ya cotizan.
const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Las líneas de precio que ya tenemos: los MATERIALES del v3.
const filasMat = v3.filas("Materiales");
const encMat = filasMat[0];
const colMat = Object.keys(encMat).find((k) => encMat[k] === "Material");
const materialesV3 = [...new Set(filasMat.slice(1).map((f) => f[colMat]).filter(Boolean))];
const materialesNorm = new Set(materialesV3.map(norm));

// Y los productos, para el cruce directo por nombre (cubre lo que sí cargamos 1 a 1).
const productosNorm = new Set(cargados.map((c) => norm(c.producto)));

// Tercer cruce, por PALABRAS. Hace falta porque el cliente etiqueta muchas líneas como
// "Precio de lista del sistema" — genérico, no matchea ningún material — y porque los
// nombres nunca coinciden literal ("Sobres impresos" vs "Sobres impresos x100",
// "Volantes A6" vs "Volantes A6 x500"). Si todas las palabras significativas del cliente
// están en un producto o material nuestro, es la misma cosa.
const VACIAS = new Set([
  "de", "del", "la", "el", "los", "las", "en", "con", "y", "o", "a", "por", "para", "un", "una",
  "cm", "mm", "gr", "g", "impresa", "impreso", "impresas", "impresos", "personalizado", "personalizados",
]);
const palabras = (s) =>
  new Set(norm(s).split(" ").filter((p) => p && !VACIAS.has(p) && p.length > 2 && !/^\d+$/.test(p)));

const nuestros = [
  ...cargados.map((c) => ({ nombre: c.producto, pal: palabras(`${c.producto} ${c.material}`) })),
  ...materialesV3.map((m) => ({ nombre: m, pal: palabras(m) })),
];

function porPalabras(item) {
  const pal = palabras(item.producto);
  if (pal.size < 2) return null; // con una sola palabra el match es casualidad
  for (const x of nuestros) {
    let todas = true;
    for (const p of pal) if (!x.pal.has(p)) { todas = false; break; }
    if (todas) return x.nombre;
  }
  return null;
}

// `Modo` del cliente: "no" = no lo hace · "consultar" = no tiene precio cerrado.
// Ninguno de los dos es un pendiente de carga.
const NO_APLICA = new Set(["no", "consultar"]);

// Equivalencias que ningún cruce automático puede adivinar: el cliente los nombra de una
// manera y nosotros de otra, sin palabras en común suficientes. Verificadas UNA POR UNA
// contra la hoja Productos del v3 (la fila del v3 va en el comentario).
const EQUIVALE = {
  71: "Sobres impresos x100 — fila 52 del v3",
  73: "Talonarios x10 — fila 53 del v3 (el sinónimo ya dice 'notas de pedido, comandas')",
  80: "Impresión color A3 — fila 63 del v3",
  91: "Volantes A6 x500 — fila 81 del v3",
  97: "Encuadernación fresada — fila 70 del v3",
  108: "Porta banner tipo X — fila 88 del v3 (cargado 90x190, la medida que se trabaja)",
  143: "Perforado x500 — fila 80 del v3",
  176: "Plastificado carnet — fila 75 del v3",
  189: "Libros de medicina — fila 82 del v3 (los 4 títulos, mismo precio)",
  190: "Libros de medicina — fila 82 del v3",
  191: "Libros de medicina — fila 82 del v3",
  192: "Libros de medicina — fila 82 del v3",
  85: "Impresión b/n A4 doble faz + Anillado plástico — filas 62 y 68 del v3 (el precio SALE de sumar los dos, no es un producto propio)",
  116: "Stickers 5x5 cm — fila 4 del v3 (papel autoadhesivo troquelado, cualquier medida)",
  119: "Etiquetas para frascos 6x3 — el material ya cotiza cualquier medida",
};

const grupos = { yaEstan: [], noHace: [], sinPrecio: [], faltan: [] };

for (const item of delCliente) {
  const modo = norm(item.modo);

  if (modo === "no") { grupos.noHace.push(item); continue; }
  if (modo === "consultar") { grupos.sinPrecio.push(item); continue; }

  if (EQUIVALE[item.fila]) {
    grupos.yaEstan.push({ ...item, como: EQUIVALE[item.fila] });
    continue;
  }

  // ¿Su línea de precio ya es un material nuestro?
  if (item.linea && materialesNorm.has(norm(item.linea))) {
    grupos.yaEstan.push({ ...item, como: `línea "${item.linea}"` });
    continue;
  }
  // ¿O el producto está cargado tal cual?
  if (productosNorm.has(norm(item.producto))) {
    grupos.yaEstan.push({ ...item, como: "producto cargado" });
    continue;
  }
  // ¿O con otro nombre pero las mismas palabras?
  const porPal = porPalabras(item);
  if (porPal) {
    grupos.yaEstan.push({ ...item, como: `= "${porPal}"` });
    continue;
  }
  grupos.faltan.push(item);
}

const money = (v) => (v === "" || v == null ? "" : "$" + Number(v).toLocaleString("es-AR"));

// El reporte solo cuando se corre directo. `podar-pendientes.mjs` importa `decidir()` y
// no quiere 200 líneas de por medio.
const DIRECTO = process.argv[1] && process.argv[1].endsWith("pendientes-cliente.mjs");
const log = (...a) => { if (DIRECTO) console.log(...a); };

log("═".repeat(78));
log("QUÉ FALTA CARGAR — hoja \"Lista de precios\" del Excel del cliente");
log("═".repeat(78));
log(`
${delCliente.length} líneas con producto. Se reparten así:

  ${String(grupos.yaEstan.length).padStart(3)}  ya cotizan          su línea de precio ya es un material del v3
  ${String(grupos.faltan.length).padStart(3)}  FALTAN              tienen precio y no están
  ${String(grupos.sinPrecio.length).padStart(3)}  sin precio cerrado  el cliente puso Modo="consultar"
  ${String(grupos.noHace.length).padStart(3)}  no lo hace          el cliente puso Modo="no"

Ojo con "ya cotizan": nuestro catálogo guarda MATERIALES con su escala, no productos
cerrados. Las 20 filas de stickers del cliente son un solo material nuestro y el bot
las cotiza todas, más cualquier otra medida que le pidan.
`);

const listar = (titulo, items, detalle) => {
  log("\n" + "─".repeat(78));
  log(titulo);
  log("─".repeat(78));
  if (!items.length) { log("  (ninguna)"); return; }
  let col = null;
  for (const f of items) {
    if (f.coleccion !== col) { col = f.coleccion; log(`\n  [${col || "(sin colección)"}]`); }
    log(`   fila ${String(f.fila).padStart(3)}  ${f.producto}`);
    const l = detalle(f);
    if (l) log(`             ${l}`);
  }
};

listar(
  `FALTAN CARGAR (${grupos.faltan.length}) — tienen precio y no están en el v3`,
  grupos.faltan,
  (f) => [f.tamano && `tamaño: ${f.tamano}`, money(f.precio), f.modo && `modo: ${f.modo}`,
          f.linea && `línea: ${f.linea}`].filter(Boolean).join("   ·   "),
);

listar(
  `SIN PRECIO CERRADO (${grupos.sinPrecio.length}) — el cliente marcó "consultar"`,
  grupos.sinPrecio,
  (f) => [f.tamano && `tamaño: ${f.tamano}`, money(f.precio)].filter(Boolean).join("   ·   "),
);

listar(
  `NO LO HACE (${grupos.noHace.length}) — el cliente marcó "no"`,
  grupos.noHace,
  () => "",
);

listar(
  `YA COTIZAN (${grupos.yaEstan.length}) — para chequear que el cruce no miente`,
  grupos.yaEstan,
  (f) => f.como,
);

// Lo que `podar-pendientes.mjs` necesita para dejar en el Excel solo lo pendiente. Vive
// acá para que el criterio esté en UN solo lugar: el que decide es el que reporta.
export function decidir() {
  return {
    // Se van las que ya cotizan y las que el negocio no hace. Quedan las 12 que faltan
    // y las 31 sin precio cerrado: las dos cosas son decisiones abiertas.
    aBorrar: [...grupos.yaEstan, ...grupos.noHace].map((f) => f.fila),
    resumen:
      `${delCliente.length} líneas · ${grupos.yaEstan.length} ya cotizan · ` +
      `${grupos.noHace.length} no las hace · quedan ${grupos.faltan.length} pendientes ` +
      `+ ${grupos.sinPrecio.length} sin precio cerrado`,
  };
}
