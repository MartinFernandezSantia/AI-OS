// Paso 8 del lote v4 (plans/limpieza-catalogo-v4.md, Fase 3): actualiza los casos de
// prueba que quedaron con el nombre VIEJO de un material renombrado, y retira el que
// referencia un material apartado a Pendientes. Datos en datos-catalogo-v4.mjs.
//
// Separado de cargar-catalogo-v4.mjs porque ESE script no es idempotente (los pasos 1-7
// operan por número de fila fijo del archivo del cliente tal cual llegó, y una vez
// aplicados esos números ya no existen — re-correrlo entero sobre un wip ya procesado
// falla en seco). Este paso, en cambio, sí se puede re-ejecutar solo, en cualquier momento
// después del paso 7 y antes de correr el build.
//
//   CATALOGO=../Catalogo-TG-v4-wip.xlsx node visor/scripts/actualizar-casos-prueba-v4.mjs           (dry run)
//   CATALOGO=../Catalogo-TG-v4-wip.xlsx node visor/scripts/actualizar-casos-prueba-v4.mjs --apply

import { XLSX, chequearLock, abrir, cadenasDe, dec, indiceCadenas, relsDe, valorCelda, guardar } from "./lib-xlsx.mjs";
import { CASOS_A_RENOMBRAR, CASOS_A_BORRAR } from "./datos-catalogo-v4.mjs";

const APLICAR = process.argv.includes("--apply");

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

const ruta = rutaDe("Casos de prueba");
let xml = leer(ruta);

// ── renombrar (con chequeo del valor viejo, ya idempotente por diseño: si el valor actual
//    ya es el nuevo, no hace nada y no tira error) ──────────────────────────────────────
let renombradas = 0;
for (const { fila, columna, de, a } of CASOS_A_RENOMBRAR) {
  const celdaRe = new RegExp(`<c r="${columna}${fila}"([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`);
  const m = xml.match(celdaRe);
  if (!m) throw new Error(`"Casos de prueba": no encontré ${columna}${fila}`);
  const actual = valorCelda(m[1], m[2] ?? "", CADENAS);
  if (actual === a) {
    console.log(`${columna}${fila}: ya está en "${a}" — nada que hacer.`);
    continue;
  }
  if (actual !== de) {
    throw new Error(`"Casos de prueba" ${columna}${fila}: esperaba "${de}" o "${a}", encontré "${actual}"`);
  }
  const attrs = m[1].replace(/\s*t="[^"]*"/, "");
  xml = xml.replace(celdaRe, `<c r="${columna}${fila}"${attrs} t="s"><v>${SS.idDe(a)}</v></c>`);
  console.log(`${columna}${fila}: "${de}" → "${a}"`);
  renombradas++;
}

// ── borrar (idempotente: si la fila ya no está, no hace nada) ─────────────────────────
let borradas = 0;
for (const n of CASOS_A_BORRAR) {
  const filaRe = new RegExp(`<row[^>]*\\br="${n}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/row>)`);
  if (!filaRe.test(xml)) {
    console.log(`fila ${n}: ya no está — nada que hacer.`);
    continue;
  }
  xml = xml.replace(filaRe, "");
  console.log(`fila ${n}: retirada.`);
  borradas++;
}

console.log(`\n${renombradas} renombre(s) · ${borradas} caso(s) retirado(s) · ${SS.nuevas()} cadena(s) nueva(s).`);

if (!APLICAR) {
  console.log("DRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}
if (!renombradas && !borradas) {
  console.log("Nada que aplicar.");
  process.exit(0);
}

SS.aplicar();
entradaDe(ruta).contenido = Buffer.from(xml, "utf8");
guardar(entradas);
console.log(`Escrito ${XLSX}.`);
