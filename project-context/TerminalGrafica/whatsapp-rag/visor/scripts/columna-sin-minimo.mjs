// Agrega la columna "Sin mínimo por trabajo" a la hoja Colecciones y la marca en las
// colecciones cuyos productos son TERMINACIONES (extras sobre otro trabajo), no trabajos.
//
// Por qué: el mínimo por trabajo de $4.000 tiene sentido para lo que se produce — 10
// stickers son $2.500 de material pero hay que armar el archivo, montar la plancha y
// cortar. No tiene ningún sentido para un laminado de $330 o un ojalillo de $1.000, que
// son un agregado sobre un trabajo que ya se cobró. Sin esta excepción el bot cotizaría
// $4.000 por laminar una hoja.
//
// Vacío = se aplica el mínimo (lo de siempre). "sí" = no se aplica.
//
//   node visor/scripts/columna-sin-minimo.mjs          → dry run
//   node visor/scripts/columna-sin-minimo.mjs --apply
//   CATALOGO=../Catalogo-TG-v3.xlsx node …             → sobre otra copia
import { XLSX, chequearLock, abrir, cadenasDe, dec, indiceCadenas, guardar } from "./lib-xlsx.mjs";

const APLICAR = process.argv.includes("--apply");
const COLUMNA = "Sin mínimo por trabajo";

// Las colecciones a marcar. Se comparan por nombre exacto. Las que todavía no existen se
// avisan y se saltean: la columna se crea igual, y volver a correr el script marca las que
// se hayan cargado desde entonces (es idempotente).
const MARCAR = ["Encuadernación y terminaciones"];

chequearLock();

const { entradas } = abrir();
const entradaDe = (n) => entradas.find((e) => e.nombre === n);
const leer = (n) => entradaDe(n).contenido.toString("utf8");

// ── ubicar la hoja ────────────────────────────────────────────────────────────────────
const HOJAS = [...leer("xl/workbook.xml").matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"[^>]*\/?>/g)].map((m) => ({
  nombre: dec(m[1]),
  rid: m[2],
}));
const RID = Object.fromEntries(
  [...leer("xl/_rels/workbook.xml.rels").matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [
    m[1],
    m[2],
  ]),
);
const hoja = HOJAS.find((h) => h.nombre === "Colecciones");
if (!hoja) throw new Error("no existe la hoja Colecciones");
const RUTA = "xl/" + RID[hoja.rid].replace(/^\//, "");

const SS = indiceCadenas(entradaDe("xl/sharedStrings.xml"));
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));

// ── leer la hoja: qué colecciones hay, en qué fila, y hasta qué columna llega ──────────
let xml = leer(RUTA);
const filaDe = {}; // nombre de colección -> número de fila
let ultimaCol = "A";
for (const f of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
  const n = Number(f[1]);
  for (const c of f[2].matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    if (c[1].length > ultimaCol.length || (c[1].length === ultimaCol.length && c[1] > ultimaCol)) ultimaCol = c[1];
    if (c[1] !== "A" || n === 1) continue;
    const v = (c[4] || "").match(/<v>([\s\S]*?)<\/v>/);
    if (v && /t="s"/.test(c[3])) filaDe[CADENAS[Number(v[1])]] = n;
  }
}
if (ultimaCol.length > 1) throw new Error("la hoja pasó de la columna Z: este script no lo contempla");
const DESTINO = String.fromCharCode(ultimaCol.charCodeAt(0) + 1);

const presentes = MARCAR.filter((m) => filaDe[m]);
const faltan = MARCAR.filter((m) => !filaDe[m]);

console.log(`hoja Colecciones · última columna ${ultimaCol} → la nueva va en ${DESTINO}`);
console.log(`colecciones: ${Object.keys(filaDe).join(" · ")}`);
console.log(`\nse marca "${COLUMNA}" = sí en: ${presentes.length ? presentes.join(" · ") : "(ninguna todavía)"}`);
if (faltan.length) {
  console.log(`todavía NO están en la hoja (se marcan cuando se carguen): ${faltan.join(" · ")}`);
}
console.log();

// ── insertar las celdas ───────────────────────────────────────────────────────────────
// El estilo se copia de la celda de al lado en la MISMA fila, para que el encabezado siga
// pareciendo encabezado y las filas de datos, datos.
function estiloDe(cuerpo, col) {
  const m = cuerpo.match(new RegExp(`<c r="${col}\\d+"([^>]*?)(?:/>|>)`));
  const s = m && m[1].match(/s="(\d+)"/);
  return s ? ` s="${s[1]}"` : "";
}

let insertadas = 0;
xml = xml.replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (todo, nStr, attrs, cuerpo) => {
  const n = Number(nStr);
  const esEncabezado = n === 1;
  const nombre = Object.keys(filaDe).find((k) => filaDe[k] === n);
  if (!esEncabezado && !presentes.includes(nombre)) return todo;

  if (cuerpo.includes(`<c r="${DESTINO}${n}"`)) {
    console.log(`  = ${DESTINO}${n}: ya existe, no la toco`);
    return todo;
  }
  const texto = esEncabezado ? COLUMNA : "sí";
  const s = estiloDe(cuerpo, ultimaCol);
  insertadas++;
  console.log(`  + ${DESTINO}${n}: "${texto}"${esEncabezado ? "" : `  (${nombre})`}`);
  // `spans` queda desactualizado; Excel y LibreOffice lo recalculan solos.
  return `<row r="${nStr}"${attrs}>${cuerpo}<c r="${DESTINO}${n}"${s} t="s"><v>${SS.idDe(texto)}</v></c></row>`;
});

console.log(`\n${insertadas} celda(s) a insertar · ${SS.nuevas()} cadena(s) nueva(s).`);
if (!APLICAR) {
  console.log("DRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}

SS.aplicar();
entradaDe(RUTA).contenido = Buffer.from(xml, "utf8");
guardar(entradas);
console.log(`Escrito ${XLSX}.`);
