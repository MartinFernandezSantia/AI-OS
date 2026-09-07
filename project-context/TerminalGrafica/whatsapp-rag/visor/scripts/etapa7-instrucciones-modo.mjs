// Etapa 7 del plan flexibilidad-motor-cotizacion.md: regenera la sección
// "UNA UNIDAD DE COBRO NUEVA" de la hoja Instrucciones. La vieja decía "Hoy existen dos:
// 'pliego A3' y 'm2'" — falso desde que existe `item`, y ahora además hay una columna
// "Modo de cálculo" que lo declara explícito.
//
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/etapa7-instrucciones-modo.mjs          (dry run)
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/etapa7-instrucciones-modo.mjs --apply
//
// Reemplaza el bloque entre "UNA UNIDAD DE COBRO NUEVA" y "ERRORES QUE ROMPEN EN SILENCIO"
// (sin tocar el ancla). OJO: `armar-prompt.mjs:62-75` valida 4 regex de la PARTE 1 y tira si
// desaparecen — esta sección está DESPUÉS de la PARTE 1, así que no las toca.

import { XLSX, abrir, cadenasDe, chequearLock, dec, esc, indiceCadenas, relsDe, guardar } from "./lib-xlsx.mjs";

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
const ruta = "xl/" + RID[HOJAS.find((h) => h.nombre === "Instrucciones").rid];

const SS = indiceCadenas(entradaDe("xl/sharedStrings.xml"));
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));

const ANCLA_INI = "UNA UNIDAD DE COBRO NUEVA";
const ANCLA_FIN = "ERRORES QUE ROMPEN EN SILENCIO";

// ── 1) Leer la hoja como [{texto, s}] respetando los huecos (filas vacías no existen) ──
const xml = leer(ruta);
const actual = [];
let esperada = 1;
for (const m of xml.matchAll(/<row r="(\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/row>)/g)) {
  const r = Number(m[1]);
  while (esperada < r) { actual.push({ texto: null, s: null }); esperada++; }
  const c = (m[2] ?? "").match(/<c r="A\d+"(?:[^>]*\bs="(\d+)")?[^>]*>(?:<v>(\d+)<\/v>)?/);
  actual.push(
    c ? { texto: c[2] !== undefined ? CADENAS[Number(c[2])] ?? null : null, s: c[1] ?? "0" }
      : { texto: null, s: null },
  );
  esperada = r + 1;
}

const ini = actual.findIndex((f) => f.texto?.includes(ANCLA_INI));
const fin = actual.findIndex((f) => f.texto?.includes(ANCLA_FIN));
if (ini < 0 || fin < 0 || fin <= ini) {
  throw new Error(`no encontré el bloque "${ANCLA_INI}" … "${ANCLA_FIN}" en Instrucciones`);
}

// Estilos: los que usaba el bloque viejo (título / normal / gris de ejemplo).
const S_T = actual[ini].s;
const S_N = actual.find((f) => f.texto === "Se puede agregar otra (por unidad, por metro lineal, por hora), y el archivo la acepta:")?.s
  ?? actual.find((f) => f.texto === "Sin eso el bot no sabe cómo pasar de lo que pide el cliente al total, y va a improvisar.")?.s ?? "0";
const S_G = actual.find((f) => f.texto?.startsWith("   Ejemplo —"))?.s ?? S_N;
const EST = { T: S_T, N: S_N, G: S_G };
const T = "T", N = "N", G = "G";

// ── 2) La sección nueva (mismo número de filas, con los mismos huecos de separación) ──
const V = null;
const SECCION = [
  ["UNA UNIDAD DE COBRO NUEVA (o un modo de cálculo distinto)", T],
  ["Hoy hay DOS formas de decir cómo se cobra un material, y conviene usar la columna", N],
  ["'Modo de cálculo' (Materiales), que lo dice EXPLÍCITO. Valores:", N],
  [V],
  ["   proporcional → cantidad × precio (por ítem o por pliego, según la Unidad).", G],
  ["   superficie   → m².", G],
  ["   fijo         → monto único por trabajo (no depende de la cantidad).", G],
  [V],
  ["   tramo total  → el precio del tramo ES el total (p. ej. troquelado 1-10 = $10.000).", G],
  ["Si la columna está VACÍA, el modo se deduce de cómo EMPIEZA la Unidad:", N],
  ["   'pliego ...' → proporcional por pliego (se divide la cantidad por el rinde).", G],
  [V],
  ["   'm2' / 'm²'  → superficie.", G],
  ["   'modelo ...' → fijo (monto único) · unidad, hoja, paquete, pack, item, ítem, metro lineal,", G],
  ["   talonario → proporcional por ítem.", G],
  ["CUIDADO CON LOS NOMBRES PARECIDOS", T],
  ["'pliego A3', 'pliego A4' y 'pliego' caen en modo pliego; 'm2', 'M2' y 'm2 con", N],
  ["laminado' caen en modo m2. Si tu forma de cobro es distinta, NO la llames", N],
  ["empezando con 'pliego' ni con 'm2': se va a calcular con la fórmula equivocada.", N],
  ["'metro cuadrado' NO es 'm2' (no empieza igual): queda sin fórmula. Escribí 'm2'.", N],
  ["Un valor de 'Modo de cálculo' que no esté en la lista rompe el build a propósito: mejor que falle", N],
  ["a que cotice en silencio con un modo que no se entiende.", N],
];

// El bloque viejo (ini..fin-1) se reemplaza por SECCION, rellenando con filas vacías hasta
// respetar la misma cantidad de filas (así los anclas no se mueven de posición).
const reemplazo = [];
for (const [texto, estilo] of SECCION) {
  reemplazo.push(texto === V ? { texto: null, s: null } : { texto, s: EST[estilo] });
}
while (reemplazo.length < fin - ini) reemplazo.push({ texto: null, s: null });
if (reemplazo.length > fin - ini) {
  throw new Error(`la sección nueva (${reemplazo.length} filas) no entra en el bloque (${fin - ini} filas)`);
}
const nuevo = [...actual.slice(0, ini), ...reemplazo, ...actual.slice(fin)];

console.log(`catálogo: ${XLSX}`);
console.log(`Instrucciones: filas ${ini + 1}-${fin} (${fin - ini}) → sección nueva (${reemplazo.filter((f) => f.texto).length} con texto)`);

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}

// ── 3) Reconstruir sheetData + sharedStrings ───────────────────────────────────────────
const SSXml = leer("xl/sharedStrings.xml");
const ATTRS = (xml.match(/<row r="\d+"([^>]*?)(?:\/>|>)/) ?? [, ""])[1]
  .replace(/\s*ht="[\d.]+"/, "");
const filasXml = nuevo
  .map((f, i) => {
    const r = i + 1;
    if (f.texto === null) return `<row r="${r}"${ATTRS}/>`;
    return `<row r="${r}"${ATTRS}><c r="A${r}" s="${f.s}" t="s"><v>${SS.idDe(f.texto)}</v></c></row>`;
  })
  .join("");
entradaDe(ruta).contenido = Buffer.from(
  xml
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${filasXml}</sheetData>`)
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:A${nuevo.length}"/>`),
  "utf8",
);
SS.aplicar();
guardar(entradas);
console.log(`\n✓ Escrito ${XLSX}.`);