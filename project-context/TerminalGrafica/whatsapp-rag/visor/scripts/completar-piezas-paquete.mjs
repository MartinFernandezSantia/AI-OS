// Completa la columna M "Piezas por paquete" (Materiales) en todas las filas que hoy la
// tienen vacía y corresponden a una venta por paquete/caja/resma/juego/blister/set, con el
// MISMO número que ya extrae el fallback de paqueteDe() (chunk.ts) del texto de la Unidad
// ("paquete de 500 tarjetas" → 500). La columna nueva es el estándar (mismo argumento que
// la etapa 7 con "Modo de cálculo"): dejar de depender de texto libre en Unidad.
//
// Dos filas NO tienen número en la Unidad ("pack" a secas) y por diseño el fallback no
// adivina ahí — hoy se cotizan como si el paquete fuera de 1 unidad. Se cargan a mano con
// el número real del nombre del producto:
//   fila 101 — "Pack 4 libros de medicina"                       → 4
//   fila 216 — "Promoción cartelería corrugado 6 carteles 1x0.65m" → 6
//
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/completar-piezas-paquete.mjs          (dry run)
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/completar-piezas-paquete.mjs --apply
//
// Ningún precio se mueve para los 32 casos con número en la Unidad (el cargado == lo que
// ya calculaba el fallback). Los 2 casos "pack" SÍ cambian de comportamiento: hoy se
// cotizan como 1 unidad, con la columna cargada pasan a cotizarse como paquete cerrado —
// es la corrección real, no un no-op.

import { XLSX, abrir, cadenasDe, chequearLock, dec, indiceCadenas, relsDe, guardar } from "./lib-xlsx.mjs";

const APPLY = process.argv.includes("--apply");

chequearLock();

const { entradas } = abrir();
const entradaDe = (n) => entradas.find((e) => e.nombre === n);
const leer = (n) => entradaDe(n).contenido.toString("utf8");

const HOJAS = [...leer("xl/workbook.xml").matchAll(/<sheet\b[^>]*\/>/g)].map((m) => ({
  nombre: dec(m[0].match(/\bname="([^"]*)"/)?.[1] ?? ""),
  rid: m[0].match(/\br:id="([^"]*)"/)?.[1],
}));
const RID = relsDe(leer("xl/_rels/workbook.xml.rels"));
const rutaDe = (hoja) => {
  const h = HOJAS.find((x) => x.nombre === hoja);
  if (!h) throw new Error(`el Excel no tiene la hoja "${hoja}"`);
  return "xl/" + RID[h.rid];
};

const SS = indiceCadenas(entradaDe("xl/sharedStrings.xml"));
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));

function valorCeldaDe(attrs, cuerpo) {
  if (/ t="inlineStr"/.test(attrs)) {
    if (!cuerpo) return undefined;
    let t = "";
    for (const tm of cuerpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += dec(tm[1]);
    return t;
  }
  const v = cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (v === undefined) return undefined;
  return / t="s"/.test(attrs) ? (CADENAS[Number(v)] ?? "") : dec(v);
}

// Los "pack" a secas ("Pack 4 libros de medicina", "Promoción cartelería... 6 carteles")
// quedan FUERA de esta pasada a propósito: cargar su número cambiaría el precio real que
// hoy cotiza el bot (pasan de cotizarse como 1 unidad a paquete cerrado), y eso se decide
// aparte, no junto con un completado que no debía mover nada.

/** Misma regla que paqueteDe() (chunk.ts): prefijo paquete/caja/resma/juego/blister/set,
 *  primer número que aparece después del sustantivo. */
function piezasDe(material, unidad) {
  const u = String(unidad ?? "").trim().toLowerCase();
  if (!/^(paquete|caja|resma|juego|blister|set)\b/.test(u)) return null;
  const m = u.match(/(\d[\d.,]*)/);
  const n = m ? Number(m[1].replace(/[.,]/g, "")) : null;
  return n && n > 1 ? n : null;
}

const rutaMat = rutaDe("Materiales");
let xmlMat = leer(rutaMat);

if (!xmlMat.includes('r="M1"')) {
  throw new Error('la columna M "Piezas por paquete" no existe.');
}

const reFila = /(<row r="(\d+)"[^>]*>)([\s\S]*?)(<\/row>)/g;
let cambios = 0;
const detalle = [];

xmlMat = xmlMat.replace(reFila, (filaCompleta, aperturaFila, n, cuerpo, cierre) => {
  if (n === "1") return filaCompleta; // cabecera
  if (/<c r="M\d+"/.test(cuerpo)) return filaCompleta; // ya cargada

  const a = cuerpo.match(/<c r="A\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/);
  const b = cuerpo.match(/<c r="B\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/);
  const material = a ? valorCeldaDe(a[1], a[2] ?? "") : undefined;
  const unidad = b ? valorCeldaDe(b[1], b[2] ?? "") : undefined;
  if (unidad === undefined) return filaCompleta;

  const piezas = piezasDe(material, unidad);
  if (piezas === null) return filaCompleta;

  // Celda numérica: sin t="s" (no es texto), <v> lleva el número crudo.
  const estilo = cuerpo.match(/<c r="L\d+"([^>]*?)(?:\/>|>)/)?.[1]?.match(/\bs="(\d+)"/);
  const nuevaCelda = `<c r="M${n}"${estilo ? ` s="${estilo[1]}"` : ""}><v>${piezas}</v></c>`;
  cambios++;
  detalle.push(`  fila ${n}: "${material}" (${unidad}) → ${piezas}`);
  return `${aperturaFila}${cuerpo}${nuevaCelda}${cierre}`;
});

console.log(`catálogo: ${XLSX}`);
console.log(`filas completadas: ${cambios}`);
for (const d of detalle) console.log(d);

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}

entradaDe(rutaMat).contenido = Buffer.from(xmlMat, "utf8");
SS.aplicar();
guardar(entradas);
console.log(`\n✓ Escrito ${XLSX}.`);
