// Aplica el lote de limpieza del catálogo v4 sobre CATALOGO=. Datos en datos-catalogo-v4.mjs
// (leelos primero — este archivo es el escritor, no decide nada por su cuenta).
// Plan completo: plans/limpieza-catalogo-v4.md.
//
// Orden de las operaciones (cada una sobre el resultado de la anterior, todo en memoria
// hasta el --apply final):
//   1. Renombrar celdas (Materiales, por fila+columna) — §5
//   2. Borrar filas de Materiales/Productos (Pendientes) — §6, y anotar en la hoja Pendientes
//   3. Borrar filas de presentaciones-como-tramos, agregar los materiales separados — §7
//   4. Reapuntar el Material de 4 productos existentes a la nueva presentación — §7
//   5. Agregar productos nuevos (presentaciones + coberturas + microperforado) — §7/§9
//   6. Agregar la colección Merchandising — §8
//   7. Marcar Familia en los materiales que la necesitan (planos/plotter/microperforado) — §9
//
// Los BORRADOS van por NÚMERO DE FILA (no por nombre: varias filas comparten el nombre del
// material en sus tramos) — los números son del archivo del cliente tal cual llegó, y no
// se mueven mientras no se apliquen otros borrados ANTES en la misma corrida: por eso todo
// borrado de una hoja se calcula sobre las filas originales y se aplica de una sola pasada
// (nunca se re-lee la hoja entre un borrado y el siguiente de la misma hoja).
//
// NO ES IDEMPOTENTE: si se corre --apply dos veces sobre el mismo archivo, la segunda
// aborta ("no encontré la fila N para borrar") porque esos números ya no existen. Si hay
// que retocar algo después de aplicar, hacerlo con un script chico y focalizado sobre el
// resultado (ver actualizar-casos-prueba-v4.mjs, que SÍ es idempotente, para el paso de
// Casos de prueba — ese va aparte justamente por esto).
//
//   CATALOGO=../Catalogo-TG-v4-wip.xlsx node visor/scripts/cargar-catalogo-v4.mjs           (dry run)
//   CATALOGO=../Catalogo-TG-v4-wip.xlsx node visor/scripts/cargar-catalogo-v4.mjs --apply

import { XLSX, chequearLock, abrir, cadenasDe, dec, indiceCadenas, relsDe, valorCelda, guardar } from "./lib-xlsx.mjs";
import {
  RENOMBRES_MATERIAL,
  A_PENDIENTES,
  MATERIALES_A_BORRAR,
  PRODUCTOS_A_BORRAR,
  PRESENTACIONES_A_BORRAR,
  PRESENTACIONES_NUEVAS,
  PRODUCTOS_A_REAPUNTAR,
  PRODUCTOS_NUEVOS,
  COLECCION_NUEVA,
  FAMILIAS_A_CARGAR,
} from "./datos-catalogo-v4.mjs";

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

const LETRA = (i) => String.fromCharCode(65 + i);

// xml en memoria por hoja, para encadenar operaciones sin reempaquetar entre pasos.
const xmlPorHoja = new Map();
const xmlDe = (hoja) => xmlPorHoja.get(hoja) ?? leer(rutaDe(hoja));
const setXml = (hoja, xml) => xmlPorHoja.set(hoja, xml);

const resumen = [];

// ── helpers de lectura ──────────────────────────────────────────────────────────────────

function encabezadoDe(hoja) {
  const xml = xmlDe(hoja);
  const f1 = xml.match(/<row[^>]*\br="1"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/);
  const enc = [];
  if (f1?.[1]) {
    for (const c of f1[1].matchAll(/<c r="([A-Z]+)1"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = valorCelda(c[2], c[3] ?? "", CADENAS);
      enc[c[1].charCodeAt(0) - 65] = v;
    }
  }
  return enc;
}

function ultimaFilaDe(hoja) {
  const xml = xmlDe(hoja);
  let max = 1;
  for (const m of xml.matchAll(/<row[^>]*\br="(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max;
}

function estiloDatoDe(hoja, letra) {
  const xml = xmlDe(hoja);
  const m = xml.match(new RegExp(`<c r="${letra}2"\\s*s="(\\d+)"`));
  return m?.[1] ?? null;
}

// ── 1) renombrar celdas por fila+columna ───────────────────────────────────────────────

function renombrarCeldas(hoja, cambiosPorFila) {
  let xml = xmlDe(hoja);
  let tocadas = 0;
  for (const { fila, cambios } of cambiosPorFila) {
    const filaRe = new RegExp(`(<row[^>]*\\br="${fila}"[^>]*>)([\\s\\S]*?)(<\\/row>)`);
    const m = xml.match(filaRe);
    if (!m) throw new Error(`"${hoja}": no encontré la fila ${fila}`);
    let cuerpo = m[2];
    for (const [col, valor] of Object.entries(cambios)) {
      const celdaRe = new RegExp(`<c r="${col}${fila}"([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`);
      const cm = cuerpo.match(celdaRe);
      const attrs = cm ? cm[1].replace(/\s*t="[^"]*"/, "") : "";
      const nueva = `<c r="${col}${fila}"${attrs} t="s"><v>${SS.idDe(String(valor))}</v></c>`;
      cuerpo = cm ? cuerpo.replace(celdaRe, nueva) : cuerpo + nueva;
      tocadas++;
    }
    xml = xml.replace(filaRe, `$1${cuerpo}$3`);
  }
  setXml(hoja, xml);
  return tocadas;
}

// ── borrar filas por número (de una hoja, en una sola pasada) ─────────────────────────

function borrarFilas(hoja, numeros) {
  let xml = xmlDe(hoja);
  let borradas = 0;
  for (const n of numeros) {
    const filaRe = new RegExp(`<row[^>]*\\br="${n}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/row>)`);
    if (!filaRe.test(xml)) throw new Error(`"${hoja}": no encontré la fila ${n} para borrar`);
    xml = xml.replace(filaRe, "");
    borradas++;
  }
  setXml(hoja, xml);
  return borradas;
}

// ── agregar filas al final de una hoja ─────────────────────────────────────────────────

function celda(letra, fila, valor, estilos) {
  if (valor === null || valor === undefined || valor === "") return "";
  const s = estilos[letra] ? ` s="${estilos[letra]}"` : "";
  if (typeof valor === "number") return `<c r="${letra}${fila}"${s} t="n"><v>${valor}</v></c>`;
  return `<c r="${letra}${fila}"${s} t="s"><v>${SS.idDe(String(valor))}</v></c>`;
}

function agregarFilas(hoja, filasObj) {
  if (!filasObj.length) return 0;
  const encabezado = encabezadoDe(hoja);
  const estilos = {};
  for (let i = 0; i < encabezado.length; i++) {
    const l = LETRA(i);
    const s = estiloDatoDe(hoja, l);
    if (s) estilos[l] = s;
  }
  let ultima = ultimaFilaDe(hoja);
  const nuevas = filasObj
    .map((obj) => {
      ultima++;
      const celdas = Object.entries(obj)
        .map(([col, val]) => celda(col, ultima, val, estilos))
        .join("");
      return `<row r="${ultima}">${celdas}</row>`;
    })
    .join("");
  setXml(hoja, xmlDe(hoja).replace(/<\/sheetData>/, `${nuevas}</sheetData>`));
  return filasObj.length;
}

// ── reapuntar una celda (Material de un producto existente) con chequeo del valor viejo ──

function reapuntar(hoja, columna, cambios) {
  let xml = xmlDe(hoja);
  let tocadas = 0;
  for (const { fila, de, a } of cambios) {
    const celdaRe = new RegExp(`<c r="${columna}${fila}"([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`);
    const m = xml.match(celdaRe);
    if (!m) throw new Error(`"${hoja}": no encontré ${columna}${fila} para reapuntar`);
    const actual = valorCelda(m[1], m[2] ?? "", CADENAS);
    if (actual !== de) {
      throw new Error(`"${hoja}" ${columna}${fila}: esperaba "${de}", encontré "${actual}" — ¿cambió el orden de operaciones?`);
    }
    const attrs = m[1].replace(/\s*t="[^"]*"/, "");
    xml = xml.replace(celdaRe, `<c r="${columna}${fila}"${attrs} t="s"><v>${SS.idDe(a)}</v></c>`);
    tocadas++;
  }
  setXml(hoja, xml);
  return tocadas;
}

// ── 1) RENOMBRES_MATERIAL (§5) ─────────────────────────────────────────────────────────
{
  const n = renombrarCeldas(
    "Materiales",
    RENOMBRES_MATERIAL.map(({ fila, cambios }) => ({ fila, cambios })),
  );
  resumen.push({ paso: "1. Renombres de unidad", detalle: `${n} celda(s) en Materiales` });
}

// ── 2) A_PENDIENTES + borrar Materiales/Productos (§6) ─────────────────────────────────
{
  const nPend = agregarFilas(
    "Pendientes",
    A_PENDIENTES.map((p) => ({ A: p.Producto, B: p.Descripción, C: p["Cómo se cobra"], D: p.Notas })),
  );
  const nMat = borrarFilas("Materiales", MATERIALES_A_BORRAR);
  const nProd = borrarFilas("Productos", PRODUCTOS_A_BORRAR);
  resumen.push({
    paso: "2. Apartar a Pendientes",
    detalle: `+${nPend} fila(s) en Pendientes · -${nMat} en Materiales · -${nProd} en Productos`,
  });
}

// ── 3) Presentaciones: borrar tramos-mal-leídos, agregar materiales separados (§7) ─────
{
  const nBorradas = borrarFilas("Materiales", PRESENTACIONES_A_BORRAR);
  const nAgregadas = agregarFilas("Materiales", PRESENTACIONES_NUEVAS);
  resumen.push({
    paso: "3. Presentaciones → materiales separados",
    detalle: `-${nBorradas} filas de tramo · +${nAgregadas} materiales nuevos`,
  });
}

// ── 4) Reapuntar 4 productos existentes a la nueva presentación (§7) ──────────────────
{
  const n = reapuntar("Productos", "D", PRODUCTOS_A_REAPUNTAR);
  resumen.push({ paso: "4. Reapuntar productos existentes", detalle: `${n} celda(s) en Productos!D` });
}

// ── 5) Productos nuevos: presentaciones que faltan + coberturas + microperforado (§7/§9) ─
{
  const n = agregarFilas("Productos", PRODUCTOS_NUEVOS);
  resumen.push({ paso: "5. Productos nuevos", detalle: `+${n} filas en Productos` });
}

// ── 6) Colección Merchandising (§8) ─────────────────────────────────────────────────────
{
  const encabezado = encabezadoDe("Colecciones");
  const iSinMin = encabezado.indexOf("Sin mínimo por trabajo");
  if (iSinMin < 0) throw new Error('falta "Sin mínimo por trabajo" en Colecciones');
  const fila = [];
  fila[0] = COLECCION_NUEVA.A;
  fila[1] = COLECCION_NUEVA.B;
  fila[2] = COLECCION_NUEVA.C;
  const n = agregarFilas(
    "Colecciones",
    [Object.fromEntries(fila.map((v, i) => [LETRA(i), v]).filter(([, v]) => v !== undefined))],
  );
  resumen.push({ paso: "6. Colección Merchandising", detalle: `+${n} fila en Colecciones` });
}

// ── 7) Marcar Familia (§9) — por fila, columna L de Materiales ────────────────────────
{
  const n = renombrarCeldas(
    "Materiales",
    FAMILIAS_A_CARGAR.map(({ fila, familia }) => ({ fila, cambios: { L: familia } })),
  );
  resumen.push({ paso: "7. Familia (planos/plotter/microperforado)", detalle: `${n} celda(s) en Materiales!L` });
}

// El paso 8 (actualizar Casos de prueba) vive en actualizar-casos-prueba-v4.mjs, aparte:
// los pasos 1-7 de ARRIBA no son idempotentes (operan por número de fila fijo del archivo
// del cliente tal cual llegó) y no se pueden re-correr sobre un wip ya procesado. Casos de
// prueba sí es idempotente y se corre después, las veces que haga falta.

// ── informe ───────────────────────────────────────────────────────────────────────────
for (const r of resumen) console.log(`${r.paso.padEnd(45)} ${r.detalle}`);
console.log(`\n${SS.nuevas()} cadena(s) nueva(s) a sharedStrings.`);

if (!APLICAR) {
  console.log("\nDRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}

SS.aplicar();
for (const [hoja, xml] of xmlPorHoja) entradaDe(rutaDe(hoja)).contenido = Buffer.from(xml, "utf8");
guardar(entradas);
console.log(`\nEscrito ${XLSX}.`);
