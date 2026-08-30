// Agrega una columna al final de una hoja, y opcionalmente la marca en ciertas filas.
// Idempotente: si la columna ya existe no la duplica, y solo escribe las marcas que falten.
//
//   node visor/scripts/agregar-columna.mjs                 → dry run de TODAS las de abajo
//   node visor/scripts/agregar-columna.mjs --apply
//   CATALOGO=../Catalogo-TG-v3.xlsx node …                 → sobre otra copia
//
// Las columnas a agregar se declaran en COLUMNAS. Cada una:
//   hoja    – dónde va
//   nombre  – el encabezado
//   marcar  – (opcional) { valor, filas: [claves de la 1ª columna] }
import { XLSX, chequearLock, abrir, cadenasDe, dec, indiceCadenas, guardar } from "./lib-xlsx.mjs";

const APLICAR = process.argv.includes("--apply");

const COLUMNAS = [
  {
    // El mínimo por trabajo de $4.000 cubre el armado y el montaje de una producción. No
    // tiene sentido para un laminado de $330 o un ojalillo de $1.000, que son un agregado
    // sobre un trabajo ya cobrado: sin esto el bot cotizaría $4.000 por laminar una hoja.
    // Vacío = se aplica el mínimo (lo de siempre). "sí" = no se aplica.
    hoja: "Colecciones",
    nombre: "Sin mínimo por trabajo",
    marcar: { valor: "sí", filas: ["Encuadernación y terminaciones"] },
  },
  {
    // La misma exención, pero por LÍNEA DE PRECIO. Hace falta además de la de Colecciones
    // porque casi todas mezclan: "Papelería comercial" tiene sobres a $250 la unidad (que
    // sin exención cotizarían $4.000) junto a talonarios de $54.000, que sí llevan piso.
    // Alcanza con que esté marcada acá O en la colección.
    hoja: "Materiales",
    nombre: "Sin mínimo por trabajo",
  },
  {
    // Cómo pide el cliente el producto ("calcos", "pegatinas"). chunk.ts ya emite las
    // columnas desconocidas de Productos como extras, así que entra al chunk sin tocar
    // código. Se carga desde datos-productos-nuevos.mjs.
    hoja: "Productos",
    nombre: "Sinónimos",
  },
  {
    // El tamaño en las palabras del cliente: "A4", "A5 o A6", "oficio". Va donde el
    // producto NO se cotiza por superficie: ahí el tamaño es una característica, no un
    // dato de entrada, y el cliente pregunta y responde en A5, no en 14,8x21 cm.
    hoja: "Productos",
    nombre: "Formato",
  },
  {
    // Agrupa líneas de precio que son el mismo producto en distinta presentación: las
    // tarjetas de 100/500/1000, los 5 formatos de plastificado. Sin esto, cada precio
    // genera su chunk y en tarjetas eso daba 14 casi idénticos compitiendo entre sí.
    // Vacío = un chunk por material, como siempre.
    hoja: "Materiales",
    nombre: "Familia",
  },
];

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

const SS = indiceCadenas(entradaDe("xl/sharedStrings.xml"));
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));

let insertadas = 0;
const escrituras = new Map();

for (const { hoja, nombre, marcar } of COLUMNAS) {
  const h = HOJAS.find((x) => x.nombre === hoja);
  if (!h) throw new Error(`el Excel no tiene la hoja "${hoja}"`);
  const ruta = "xl/" + RID[h.rid].replace(/^\//, "");
  let xml = escrituras.get(ruta) ?? leer(ruta);

  // Recorrer: encabezado actual, qué fila es cada clave, y hasta qué columna llega la hoja.
  const filaDe = {};
  let ultimaCol = "A";
  let yaExiste = null;
  for (const f of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const n = Number(f[1]);
    for (const c of f[2].matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (c[1].length > ultimaCol.length || (c[1].length === ultimaCol.length && c[1] > ultimaCol)) ultimaCol = c[1];
      const v = (c[4] || "").match(/<v>([\s\S]*?)<\/v>/);
      if (!v || !/t="s"/.test(c[3])) continue;
      const texto = String(CADENAS[Number(v[1])] ?? "").trim();
      if (n === 1 && texto === nombre) yaExiste = c[1];
      else if (n > 1 && c[1] === "A") filaDe[texto] = n;
    }
  }
  if (ultimaCol.length > 1) throw new Error(`"${hoja}" pasó de la columna Z: este script no lo contempla`);

  const destino = yaExiste ?? String.fromCharCode(ultimaCol.charCodeAt(0) + 1);
  console.log(`${hoja} · "${nombre}" → columna ${destino}${yaExiste ? " (ya existía)" : ""}`);

  const presentes = marcar ? marcar.filas.filter((k) => filaDe[k]) : [];
  const faltan = marcar ? marcar.filas.filter((k) => !filaDe[k]) : [];
  if (marcar) {
    console.log(`  marca "${marcar.valor}" en: ${presentes.length ? presentes.join(" · ") : "(ninguna todavía)"}`);
    if (faltan.length) console.log(`  todavía no están en la hoja: ${faltan.join(" · ")}`);
  }

  // El estilo se copia de la celda de al lado en la MISMA fila, para que el encabezado siga
  // pareciendo encabezado y las filas de datos, datos.
  const estiloDe = (cuerpo, col) => {
    const m = cuerpo.match(new RegExp(`<c r="${col}\\d+"([^>]*?)(?:/>|>)`));
    const s = m && m[1].match(/s="(\d+)"/);
    return s ? ` s="${s[1]}"` : "";
  };

  xml = xml.replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (todo, nStr, attrs, cuerpo) => {
    const n = Number(nStr);
    const clave = Object.keys(filaDe).find((k) => filaDe[k] === n);
    const texto = n === 1 ? nombre : presentes.includes(clave) ? marcar.valor : null;
    if (texto === null) return todo;
    if (cuerpo.includes(`<c r="${destino}${n}"`)) return todo; // ya cargada
    insertadas++;
    console.log(`  + ${destino}${n}: "${texto}"${n > 1 ? `  (${clave})` : ""}`);
    // `spans` queda desactualizado; Excel y LibreOffice lo recalculan solos.
    return `<row r="${nStr}"${attrs}>${cuerpo}<c r="${destino}${n}"${estiloDe(cuerpo, ultimaCol)} t="s"><v>${SS.idDe(texto)}</v></c></row>`;
  });

  escrituras.set(ruta, xml);
}

console.log(`\n${insertadas} celda(s) a insertar · ${SS.nuevas()} cadena(s) nueva(s).`);
if (!APLICAR) {
  console.log("DRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}
if (!insertadas) {
  console.log("No hay nada que agregar.");
  process.exit(0);
}

SS.aplicar();
for (const [ruta, xml] of escrituras) entradaDe(ruta).contenido = Buffer.from(xml, "utf8");
guardar(entradas);
console.log(`Escrito ${XLSX}.`);
