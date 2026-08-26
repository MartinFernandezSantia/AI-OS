// Vacía la columna "Piezas por unidad de cobro" en los productos de modo pliego: el rinde
// pasa a CALCULARSE desde la geometría del material (correr geometria-materiales.mjs antes).
// La columna y su header QUEDAN — es la vía de carga para unidades no geométricas futuras
// (una bobina, una plancha: dato del taller).
//
// VALIDA ANTES DE DESTRUIR: calcula el rinde geométrico de cada producto y lo compara con
// el valor cargado. Si alguno difiere, se niega a aplicar — la validación vive acá adentro,
// no como paso manual olvidable.
//
//   node scripts/vaciar-rinde-pliego.mjs           (dry run)
//   node scripts/vaciar-rinde-pliego.mjs --apply

import { XLSX, abrir, chequearLock, guardar, indiceCadenas, rinde } from "./lib-xlsx.mjs";

const APPLY = process.argv.includes("--apply");

const { entradas, get } = abrir();
const { cadenas } = indiceCadenas(get("xl/sharedStrings.xml"));

// ── geometría por material, desde Materiales (H/I/J de la primera fila que las tenga) ──
const matXml = get("xl/worksheets/sheet4.xml").contenido.toString("utf8");
const geoDe = new Map();
for (const m of matXml.matchAll(/<row r="\d+"[^>]*>([\s\S]*?)<\/row>/g)) {
  const a = m[1].match(/<c r="A\d+"[^>]*t="s"[^>]*><v>(\d+)<\/v>/);
  const celda = (col) => {
    const c = m[1].match(new RegExp(`<c r="${col}\\d+"[^>]*><v>([\\d.]+)</v>`));
    return c ? Number(c[1]) : null;
  };
  if (!a) continue;
  const nombre = cadenas[Number(a[1])];
  const [ua, uh, sep] = [celda("H"), celda("I"), celda("J")];
  if (!geoDe.has(nombre) && ua !== null && uh !== null) {
    geoDe.set(nombre, { utilAncho: ua, utilAlto: uh, separacion: sep ?? 0 });
  }
}
if (!geoDe.size) {
  console.error("ABORTADO: Materiales no tiene columnas de geometría. Correr geometria-materiales.mjs primero.");
  process.exit(1);
}

// ── productos: comparar cargado vs calculado ───────────────────────────────────────────
const hoja = get("xl/worksheets/sheet3.xml"); // Productos
const xml = hoja.contenido.toString("utf8");

let difieren = 0;
const aVaciar = []; // nros de fila
console.log(`archivo: ${XLSX}`);
console.log("fila | producto | medida | cargado | calculado");
for (const m of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
  const r = Number(m[1]);
  if (r === 1) continue;
  const sid = (col) => {
    const c = m[2].match(new RegExp(`<c r="${col}\\d+"[^>]*t="s"[^>]*><v>(\\d+)</v>`));
    return c ? cadenas[Number(c[1])] : null;
  };
  const nro = (col) => {
    const c = m[2].match(new RegExp(`<c r="${col}\\d+"[^>]*t="n"[^>]*><v>([\\d.]+)</v>`));
    return c ? Number(c[1]) : null;
  };
  const cargado = nro("G");
  if (cargado === null) continue; // sin rinde cargado: nada que vaciar
  const producto = sid("B") ?? "(sin nombre)";
  const material = sid("D") ?? "";
  const geo = geoDe.get(material);
  const [an, al] = [nro("E"), nro("F")];
  const calculado = geo && an !== null && al !== null ? rinde(an, al, geo) : null;

  const ok = calculado === cargado;
  if (!ok) difieren++;
  else aVaciar.push(r);
  console.log(
    `${String(r).padStart(4)} | ${producto} | ${an}x${al} | ${cargado} | ${calculado ?? "—"}${ok ? "" : "  ← DIFIERE"}`,
  );
}

if (difieren) {
  console.error(`\nABORTADO: ${difieren} producto(s) difieren del cálculo. Revisar la geometría o el dato antes de vaciar.`);
  process.exit(1);
}
if (!aVaciar.length) {
  console.log("\nNada que vaciar: ningún producto tiene rinde cargado.");
  process.exit(0);
}

console.log(`\n${aVaciar.length} productos coinciden 100% con el cálculo — la columna se puede vaciar.`);
if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}

// ── vaciar: se elimina la celda G de esas filas (una celda ausente = columna vacía) ────
let nuevo = xml;
for (const r of aVaciar) {
  nuevo = nuevo.replace(new RegExp(`<c r="G${r}"[^>]*>(?:<v>[^<]*</v>)?</c>`), "");
}
hoja.contenido = Buffer.from(nuevo, "utf8");

chequearLock();
guardar(entradas);
console.log(`\n✓ Rinde vaciado en ${aVaciar.length} productos de modo pliego.`);
