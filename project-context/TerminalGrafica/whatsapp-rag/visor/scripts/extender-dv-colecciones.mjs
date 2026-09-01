// Arreglo 1: la Data Validation de "Material base" en la hoja Colecciones quedó limitada
// a sqref="C2:C35" (creada por material-base-colecciones.mjs). Con 13 colecciones hoy,
// pasar de 34 filas apaga el desplegable SIN AVISAR a partir de la fila 36.
//
// Mismo bug que ya se arregló en Productos (A2:A72→A2:A500, D2:D72→D2:D500): acá se
// extiende C2:C35 a C2:C300. Solo toca el atributo sqref de esa hoja; nada más.
//
//   CATALOGO=Catalogo-TG-v3-wip.xlsx node scripts/extender-dv-colecciones.mjs           (dry run)
//   CATALOGO=Catalogo-TG-v3-wip.xlsx node scripts/extender-dv-colecciones.mjs --apply

import { XLSX, abrir, chequearLock, guardar } from "./lib-xlsx.mjs";

const APPLY = process.argv.includes("--apply");
const DESDE = 'sqref="C2:C35"';
const HASTA = 'sqref="C2:C300"';

chequearLock();

const { entradas, get } = abrir();
const hoja = get("xl/worksheets/sheet2.xml"); // Colecciones
const xml = hoja.contenido.toString("utf8");

const ocurrencias = xml.split(DESDE).length - 1;
if (ocurrencias !== 1) {
  console.error(`ABORTADO: esperaba exactamente 1 ocurrencia de ${DESDE}, encontré ${ocurrencias}.`);
  process.exit(1);
}

const nuevoXml = xml.replace(DESDE, HASTA);

console.log(`archivo: ${XLSX}`);
console.log(`cambio: ${DESDE} -> ${HASTA}`);

if (!APPLY) {
  console.log("(dry run — correr con --apply para escribir)");
  process.exit(0);
}

hoja.contenido = Buffer.from(nuevoXml, "utf8");
guardar(entradas);
console.log("guardado.");
