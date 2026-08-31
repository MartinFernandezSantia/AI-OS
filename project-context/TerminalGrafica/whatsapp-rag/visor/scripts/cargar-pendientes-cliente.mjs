// Carga en el Excel los pendientes que Martin confirmó el 2026-08-31. Los datos y el
// criterio de cada uno están en datos-pendientes-cliente.mjs; acá solo se escribe.
//
// Calca a cargar-productos-nuevos.mjs, con dos diferencias que ese no necesitaba:
// `Mínimo facturable` (los tres materiales de m2 lo llevan) y medidas en Productos.
//
// Idempotente: lo que ya está cargado (por nombre exacto) se saltea.
//
//   node visor/scripts/cargar-pendientes-cliente.mjs          → dry run
//   CATALOGO=Catalogo-TG-v3.xlsx node … --apply
import { XLSX, chequearLock, abrir, cadenasDe, dec, indiceCadenas, guardar } from "./lib-xlsx.mjs";
import { MATERIALES, PRODUCTOS, CASOS } from "./datos-pendientes-cliente.mjs";

const APLICAR = process.argv.includes("--apply");

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
const rutaDe = (hoja) => {
  const h = HOJAS.find((x) => x.nombre === hoja);
  if (!h) throw new Error(`el Excel no tiene la hoja "${hoja}"`);
  return "xl/" + RID[h.rid].replace(/^\//, "");
};

const SS = indiceCadenas(entradaDe("xl/sharedStrings.xml"));
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));
const LETRA = (i) => String.fromCharCode(65 + i);

function inspeccionar(hoja) {
  const xml = leer(rutaDe(hoja));
  let ultima = 0;
  const encabezado = [];
  const primeraCol = new Set();
  const estilos = {};
  for (const f of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const n = Number(f[1]);
    ultima = Math.max(ultima, n);
    for (const c of f[2].matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = (c[4] || "").match(/<v>([\s\S]*?)<\/v>/);
      const texto = v ? (/t="s"/.test(c[3]) ? CADENAS[Number(v[1])] : v[1]) : null;
      if (n === 1) encabezado[c[1].charCodeAt(0) - 65] = texto;
      else {
        if (c[1] === "A" && texto !== null) primeraCol.add(String(texto).trim());
        if (n === 2) {
          const s = c[3].match(/s="(\d+)"/);
          if (s) estilos[c[1]] = s[1];
        }
      }
    }
  }
  return { xml, encabezado, primeraCol, ultima, estilos };
}

function celda(letra, fila, valor, estilos) {
  if (valor === null || valor === undefined || valor === "") return "";
  const s = estilos[letra] ? ` s="${estilos[letra]}"` : "";
  if (typeof valor === "number") return `<c r="${letra}${fila}"${s} t="n"><v>${valor}</v></c>`;
  return `<c r="${letra}${fila}"${s} t="s"><v>${SS.idDe(String(valor))}</v></c>`;
}

function agregar(hoja, filas) {
  const { xml, ultima, estilos } = inspeccionar(hoja);
  if (!filas.length) return { xml, agregadas: 0 };
  const nuevas = filas
    .map((valores, i) => {
      const n = ultima + 1 + i;
      return `<row r="${n}">${valores.map((v, j) => celda(LETRA(j), n, v, estilos)).join("")}</row>`;
    })
    .join("");
  return { xml: xml.replace(/<\/sheetData>/, `${nuevas}</sheetData>`), agregadas: filas.length };
}

const resumen = [];
const escrituras = [];

// ── Materiales: una fila POR TRAMO ────────────────────────────────────────────────────
{
  const { primeraCol, encabezado } = inspeccionar("Materiales");
  const iMin = encabezado.indexOf("Mínimo facturable");
  if (iMin < 0) throw new Error('falta la columna "Mínimo facturable" en Materiales');

  const filas = [];
  const nuevos = [];
  for (const m of MATERIALES) {
    if (primeraCol.has(m.material)) continue;
    nuevos.push(m.material);
    for (const [desde, hasta, precio] of m.tramos) {
      const fila = [m.material, m.unidad, desde, hasta ?? "", precio];
      // El mínimo facturable es del MATERIAL, no del tramo: va solo en la primera fila,
      // igual que la geometría. Es lo que lee `escalaMeta` para el auditor.
      if (m.minimoFacturable && filas.every((f) => f[0] !== m.material)) fila[iMin] = m.minimoFacturable;
      filas.push(fila);
    }
  }
  const { xml, agregadas } = agregar("Materiales", filas);
  resumen.push({
    hoja: "Materiales",
    agregadas,
    saltados: MATERIALES.length - nuevos.length,
    detalle: `${nuevos.length} materiales → ${filas.length} filas de tramo`,
    muestra: nuevos,
  });
  if (agregadas) escrituras.push({ ruta: rutaDe("Materiales"), xml });
}

// ── Productos ─────────────────────────────────────────────────────────────────────────
{
  const { encabezado } = inspeccionar("Productos");
  const iProd = encabezado.indexOf("Producto");
  const iSin = encabezado.indexOf("Sinónimos");
  const iFmt = encabezado.indexOf("Formato");
  if (iFmt < 0) throw new Error('falta la columna "Formato" en Productos');

  // La primera columna de Productos es Colección, no el nombre: para la idempotencia hay
  // que mirar la columna Producto.
  const xmlP = leer(rutaDe("Productos"));
  const existentes = new Set();
  for (const f of xmlP.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    if (Number(f[1]) === 1) continue;
    const c = f[2].match(new RegExp(`<c r="${LETRA(iProd)}\\d+"([^>]*?)>([\\s\\S]*?)</c>`));
    const v = c && c[2].match(/<v>([\s\S]*?)<\/v>/);
    if (v) existentes.add(String(/t="s"/.test(c[1]) ? CADENAS[Number(v[1])] : v[1]).trim());
  }

  const nuevos = PRODUCTOS.filter((p) => !existentes.has(p.producto));
  const filas = nuevos.map((p) => {
    // Ancho/Alto y Formato son excluyentes: donde el precio no sale de la superficie, los
    // cm son un dato que nadie usa y que invita al bot a tratarlos como cotizables.
    const fila = [p.coleccion, p.producto, p.descripcion ?? "", p.material, p.ancho ?? "", p.alto ?? "", ""];
    if (iSin >= 0 && p.sinonimos) fila[iSin] = p.sinonimos;
    if (p.formato) fila[iFmt] = p.formato;
    return fila;
  });
  const { xml, agregadas } = agregar("Productos", filas);
  resumen.push({
    hoja: "Productos",
    agregadas,
    saltados: PRODUCTOS.length - nuevos.length,
    muestra: nuevos.map((p) => p.producto),
  });
  if (agregadas) escrituras.push({ ruta: rutaDe("Productos"), xml });
}

// ── Casos de prueba ───────────────────────────────────────────────────────────────────
// Pedido | Cantidad | Material | Ancho | Alto | Piezas por unidad | Precio
{
  const { primeraCol } = inspeccionar("Casos de prueba");
  const nuevos = CASOS.filter((c) => !primeraCol.has(c.pedido));
  const filas = nuevos.map((c) => [c.pedido, c.cantidad, c.material, c.ancho ?? "", c.alto ?? "", "", c.total]);
  const { xml, agregadas } = agregar("Casos de prueba", filas);
  resumen.push({
    hoja: "Casos de prueba",
    agregadas,
    saltados: CASOS.length - nuevos.length,
    muestra: nuevos.slice(0, 3).map((c) => c.pedido),
  });
  if (agregadas) escrituras.push({ ruta: rutaDe("Casos de prueba"), xml });
}

// ── informe ───────────────────────────────────────────────────────────────────────────
for (const r of resumen) {
  console.log(
    `${r.hoja.padEnd(18)} +${String(r.agregadas).padStart(3)} filas` +
      `${r.saltados ? `  (${r.saltados} ya estaban)` : ""}${r.detalle ? `  — ${r.detalle}` : ""}`,
  );
  for (const m of r.muestra ?? []) console.log(`    · ${m}`);
}
console.log(`\n${SS.nuevas()} cadena(s) nueva(s) a sharedStrings.`);

if (!APLICAR) {
  console.log("DRY RUN — nada escrito. Pasá --apply para escribir.");
  process.exit(0);
}
if (!escrituras.length) {
  console.log("No hay nada que agregar.");
  process.exit(0);
}

SS.aplicar();
for (const { ruta, xml } of escrituras) entradaDe(ruta).contenido = Buffer.from(xml, "utf8");
guardar(entradas);
console.log(`Escrito ${XLSX}.`);
