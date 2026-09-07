// Completa la columna O "Modo de cálculo" (Materiales) en TODAS las filas que hoy la
// tienen vacía, derivando el valor del prefijo de la Unidad — la MISMA regla de fallback
// que ya usa modoDe() en build-flow.mjs / parse.ts. Ningún precio se mueve: el valor
// cargado da, por construcción, el mismo modo que ya calcula el fallback hoy.
//
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/completar-modo-calculo.mjs          (dry run)
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/completar-modo-calculo.mjs --apply
//
// Regla (mapea al modo que ya usa el fallback, no a "pliego/m2/item" — esos no son
// valores de la columna, son lo que la columna+prefijo terminan resolviendo):
//   pliego...                                  → proporcional
//   m2 / m²...                                 → superficie
//   modelo...                                  → fijo (no debería quedar ninguno: ya cargado)
//   unidad/hoja/paquete/pack/metro lineal/talonario → proporcional
//   cualquier otra cosa                        → no se toca (que caiga en "otro" es visible)

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

/** Misma regla de fallback que modoDe() (build-flow.mjs / parse.ts), pero devolviendo el
 *  VALOR DE COLUMNA que reproduce ese modo, no el modo en sí. */
function valorColumnaDe(unidad) {
  const u = String(unidad ?? "").trim().toLowerCase();
  if (u.startsWith("pliego")) return "proporcional";
  if (u.startsWith("m2") || u.startsWith("m²")) return "superficie";
  if (u.startsWith("modelo")) return "fijo";
  if (/^(unidad|hoja|paquete|pack|item|ítem|metro lineal|talonario)\b/.test(u)) return "proporcional";
  return null; // "otro": no se toca, tiene que seguir siendo visible como error
}

const rutaMat = rutaDe("Materiales");
let xmlMat = leer(rutaMat);

if (!xmlMat.includes('r="O1"')) {
  throw new Error('la columna O "Modo de cálculo" no existe todavía — correr etapa7-modo-calculo.mjs primero.');
}

const reFila = /(<row r="(\d+)"[^>]*>)([\s\S]*?)(<\/row>)/g;
let cambios = 0;
let saltadas = 0;
let sinRegla = [];

xmlMat = xmlMat.replace(reFila, (filaCompleta, aperturaFila, n, cuerpo, cierre) => {
  if (n === "1") return filaCompleta; // cabecera
  if (/<c r="O\d+"/.test(cuerpo)) return filaCompleta; // ya cargada

  const a = cuerpo.match(/<c r="A\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/);
  const b = cuerpo.match(/<c r="B\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/);
  const material = a ? valorCeldaDe(a[1], a[2] ?? "") : undefined;
  const unidad = b ? valorCeldaDe(b[1], b[2] ?? "") : undefined;

  // Fila de continuación de escala (sin A ni B propios): no es "la primera fila del
  // material", pero la columna O es un atributo POR MATERIAL — solo hace falta en la
  // primera. Las filas de continuación no necesitan celda O.
  if (unidad === undefined) { saltadas++; return filaCompleta; }

  const valor = valorColumnaDe(unidad);
  if (valor === null) {
    sinRegla.push(`fila ${n}: "${material}" (unidad "${unidad}")`);
    return filaCompleta;
  }

  const estilo = cuerpo.match(/<c r="N\d+"([^>]*?)(?:\/>|>)/)?.[1]?.match(/\bs="(\d+)"/);
  const nuevaCelda = `<c r="O${n}"${estilo ? ` s="${estilo[1]}"` : ""} t="s"><v>${SS.idDe(valor)}</v></c>`;
  cambios++;
  return `${aperturaFila}${cuerpo}${nuevaCelda}${cierre}`;
});

console.log(`catálogo: ${XLSX}`);
console.log(`filas completadas: ${cambios} · filas de continuación (sin B, no tocadas): ${saltadas}`);
if (sinRegla.length) {
  console.log(`\n⚠ sin regla de fallback (no se tocaron, quedan vacías):`);
  for (const s of sinRegla) console.log(`  ${s}`);
}

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}

entradaDe(rutaMat).contenido = Buffer.from(xmlMat, "utf8");
SS.aplicar();
guardar(entradas);
console.log(`\n✓ Escrito ${XLSX}.`);
