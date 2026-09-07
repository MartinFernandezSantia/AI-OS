// Reescribe la hoja "Instrucciones" ENTERA. Decisión de Martin (2026-09-07): esta hoja es
// para el cliente y su asistente de IA, que solo necesitan entender cómo CARGAR el
// catálogo — no la especificación matemática del cálculo (eso vive únicamente en
// build-flow.mjs, y ya no tiene ningún espejo acá ni gate que lo valide, ver
// armar-prompt.mjs). Se elimina la PARTE 1 entera y se corrige/completa la carga:
//
//   - Ejemplo de PASO 4: sacada "Piezas por unidad de cobro" (columna eliminada, etapa 1).
//   - "QUÉ COLUMNAS SON OBLIGATORIAS": ampliado a los 4 modos reales (antes solo
//     pliego/m2), sumando Modo de cálculo y Piezas por paquete.
//   - Sección nueva "PIEZAS POR PAQUETE": no existía ninguna mención de esta columna.
//   - "ERRORES QUE ROMPEN EN SILENCIO": sacada la línea de "rinde cargado a mano" (esa
//     columna ya no existe, ese chequeo ya no aplica) y sumado el caso del paquete "pack"
//     sin número.
//
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/reescribir-instrucciones-carga.mjs          (dry run)
//   CATALOGO=Catalogo-TG-v4.xlsx node visor/scripts/reescribir-instrucciones-carga.mjs --apply
//
// A diferencia de etapa7-instrucciones-modo.mjs (que reemplaza UN bloque sin mover el
// resto), acá se reescribe la hoja completa: al sacar la Parte 1, todo lo de abajo corre.
// armar-prompt.mjs YA NO lee ni valida esta hoja (se sacó ese gate en el mismo cambio).

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
const ruta = "xl/" + RID[HOJAS.find((h) => h.nombre === "Instrucciones").rid];

const SS = indiceCadenas(entradaDe("xl/sharedStrings.xml"));
const CADENAS = cadenasDe(leer("xl/sharedStrings.xml"));

// ── 1) Leer la hoja actual solo para rescatar los estilos (título/normal/gris) ─────────
const xml = leer(ruta);
const actual = [];
for (const m of xml.matchAll(/<row r="(\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/row>)/g)) {
  const c = (m[2] ?? "").match(/<c r="A\d+"(?:[^>]*\bs="(\d+)")?[^>]*>(?:<v>(\d+)<\/v>)?/);
  actual.push(c ? { texto: c[2] !== undefined ? CADENAS[Number(c[2])] ?? null : null, s: c[1] ?? "0" } : { texto: null, s: null });
}
const S_T = actual.find((f) => f.texto === "CÓMO USAR ESTE ARCHIVO")?.s ?? "0";
const S_N = actual.find((f) => f.texto === "EL ORDEN IMPORTA: colección → material → producto")?.s ?? "0";
const S_G = actual.find((f) => f.texto?.startsWith("   Colección:"))?.s ?? S_N;
const EST = { T: S_T, N: S_N, G: S_G };

// ── 2) La hoja nueva, de punta a punta ──────────────────────────────────────────────────
const V = null; // fila vacía (separador)
const T = "T", N = "N", G = "G";
const HOJA_NUEVA = [
  ["CÓMO USAR ESTE ARCHIVO", T],
  ["Este archivo NO tiene precios cerrados por cantidad. Tiene el framework para calcular cualquier cantidad.", N],
  ["Cada producto dice de qué material se hace. Las medidas del catálogo son REFERENCIAS: se cotiza CUALQUIER medida que pida el cliente.", N],
  ["Esta hoja explica SOLO cómo CARGAR cosas nuevas. Cómo el bot calcula el precio a partir de", N],
  ["lo que cargues acá es responsabilidad nuestra (Terminal Gráfica / el sistema), no hace", N],
  ["falta entenderlo para editar el catálogo.", N],
  [V],
  ["LAS HOJAS Y PARA QUÉ SIRVEN", T],
  ["Colecciones — las familias de productos. Su descripción encabeza el bloque que lee el bot.", N],
  ["Productos   — lo que se ofrece. La cantidad NO va acá: la pide el cliente.", N],
  ["Materiales  — precios y tramos. Un material sin escala por volumen = un solo tramo.", N],
  [V],
  ["Parámetros  — mínimo por trabajo, redondeo, moneda.", N],
  [V],
  ["Casos de prueba — NO se usa para cotizar. Verifica que el bot calcula bien.", N],
  ["_listas     — hoja OCULTA. Alimenta los desplegables. Ver abajo, hay que tocarla.", N],
  ["EL ORDEN IMPORTA: colección → material → producto", T],
  ["Las columnas Colección y Material de la hoja Productos son DESPLEGABLES. Solo ofrecen valores", N],
  ["que ya existen. Si cargás el producto primero, el desplegable no va a tener qué ofrecerte.", N],
  ["EJEMPLO COMPLETO: producto nuevo, material nuevo, colección nueva", T],
  ["Pedido: \"agregar imanes de heladera 8x5 cm, se hacen en imán flexible, $18.000 el m2, mínimo 0,3 m2\".", N],
  [V],
  ["PASO 1 — Colección nueva. En la hoja Colecciones, primera fila libre:", N],
  ["   Colección:   Imanes", G],
  ["   Descripción: Imanes flexibles impresos full color, cortados con forma. Para heladera,", G],
  [V],
  ["                pizarras y superficies metálicas. Se cotizan por metro cuadrado.", G],
  ["   La descripción es lo que lee el bot: que se entienda sola, sin nombrar otras colecciones.", N],
  [V],
  ["PASO 2 — Material nuevo. En la hoja Materiales, primera fila libre:", N],
  ["   Material: Imán flexible | Unidad: m2 | Modo de cálculo: superficie | Desde: 1 | Hasta: (vacío)", G],
  ["   Precio por unidad: 18000 | Mínimo facturable: 0,3 | Nota: confirmado el 26/08/2026", G],
  ["   (Material que se cobra por PLIEGO: cargar también 'Área útil ancho/alto (cm)' y", G],
  ["   'Separación (cm)', una sola vez, en la primera fila del material.)", G],
  [V],
  ["PASO 3 — Registrar los dos en _listas (la hoja oculta). SIN ESTE PASO LOS DESPLEGABLES NO", N],
  ["   LOS OFRECEN. Mostrar la hoja (clic derecho en las pestañas → Mostrar) y agregar:", N],
  ["   columna A → el material nuevo   ·   columna B → la colección nueva", G],
  ["   Van en la primera fila libre de cada columna, sin dejar huecos en el medio.", N],
  [V],
  ["PASO 4 — Producto. En la hoja Productos, primera fila libre:", N],
  [V],
  ["   Colección: Imanes (ya aparece en el desplegable) | Producto: Imán 8x5 cm", G],
  ["   Descripción: Imán flexible impreso full color, cortado con forma.", G],
  ["   Material: Imán flexible | Ancho: 8 | Alto: 5", G],
  ["QUÉ COLUMNAS SON OBLIGATORIAS", T],
  ["Depende de la columna 'Modo de cálculo' del MATERIAL (o, si está vacía, de cómo empieza la", N],
  ["Unidad). Es al revés en cada modo — lo que hace falta en el MATERIAL, y lo que el PRODUCTO", N],
  ["deja vacío porque se calcula solo:", N],
  [V],
  ["   proporcional, por PLIEGO ('pliego A3'...) → el material necesita 'Área útil ancho/alto", G],
  ["   (cm)' y 'Separación (cm)'. El producto deja el rinde vacío: se calcula de la medida.", G],
  ["   proporcional, por ÍTEM ('unidad', 'hoja', 'paquete'...) → sin geometría. Si se vende por", G],
  ["   paquete cerrado, el material necesita 'Piezas por paquete' (ver sección abajo).", G],
  ["   superficie (m2) → el material necesita 'Mínimo facturable'. El producto deja el rinde", G],
  ["   vacío: los m2 salen de Ancho × Alto (o de la cantidad directa, si el cliente pide en m2).", G],
  ["   fijo → monto único por trabajo: no depende de la cantidad ni de la medida. Una sola fila", G],
  ["   de escala (Desde 1, Hasta vacío) alcanza.", G],
  ["   tramo total → el precio del tramo YA ES el total (no se multiplica por la cantidad).", G],
  ["   Se marca en la fila del TRAMO, no en el material entero — un material puede tener", G],
  ["   algunos tramos totales y otros no (ver 'Precio total por tramo' en Materiales).", G],
  [V],
  ["Una columna vacía no es un error: es lo que hace que el bot no vea datos que no corresponden.", N],
  ["CÓMO SE ESCRIBE UNA ESCALA DE PRECIOS", T],
  ["Un material = una o más filas en Materiales, todas con el MISMO nombre en la columna Material.", N],
  ["   Precio fijo, sin descuento por volumen → UNA fila: Desde 1, Hasta vacío.", G],
  ["   Con descuento por volumen → una fila por tramo. Desde/Hasta sin huecos ni superposiciones.", G],
  ["   El último tramo va con Hasta VACÍO: significa 'de acá en adelante'.", G],
  [V],
  ["   Ejemplo de escala: 1 a 1 → 2500 · 2 a 10 → 2200 · 11 a 50 → 2000 · 101 a (vacío) → 1710", G],
  ["DE DÓNDE SALE EL RINDE (materiales por pliego)", T],
  ["No se carga a mano: el rinde sale SIEMPRE de la geometría. La geometría se declara UNA vez", N],
  ["por material en la hoja Materiales ('Área útil ancho/alto (cm)' y 'Separación (cm)') y el", N],
  ["rinde se calcula solo, tanto para las medidas de referencia del catálogo como para", N],
  ["cualquier otra medida que pida el cliente.", N],
  [V],
  ["   Troquelado o medio corte: área útil 28 x 44 cm, separación 0,3 cm.", G],
  ["   Solo impresión:           área útil 31 x 46 cm, separación 0.", G],
  ["PIEZAS POR PAQUETE (materiales que se venden en conjunto cerrado)", T],
  ["Si el material se vende por paquete cerrado ('tarjetas x500', 'folletos x1000') y el cliente", N],
  ["pide en PIEZAS ('mil tarjetas'), el bot necesita saber cuántas piezas trae cada paquete para", N],
  ["convertir. Cargalo en la columna 'Piezas por paquete' (Materiales), en la primera fila del", N],
  ["material.", N],
  [V],
  ["Si la Unidad ya dice el número ('paquete de 500 tarjetas'), la columna es OPCIONAL: el bot lo", N],
  ["lee del texto igual. Pero es el estándar — cargala siempre que se pueda, no dependas del", N],
  ["texto de la Unidad.", N],
  [V],
  ["CASO QUE SÍ HAY QUE CARGAR SÍ O SÍ: una Unidad de conjunto SIN número, tipo 'pack' a secas", N],
  ["('Pack 4 libros', 'Promoción 6 carteles'). Ahí el bot NO tiene de dónde sacar el número: sin", N],
  ["la columna cargada, el pedido se cotiza como si el paquete fuera de 1 sola pieza.", N],
  ["LÍMITES DE CRECIMIENTO", T],
  ["Los desplegables y la validación cubren un rango fijo. Hoy hay lugar para:", N],
  ["   Productos: hasta la fila 72 · Materiales en _listas: hasta A42 · Colecciones: hasta B35", G],
  ["Pasado eso el desplegable deja de funcionar SIN AVISAR. Si se llega al tope, hay que extender", N],
  ["el rango (Datos → Validación) y el nombre definido, o avisar para que lo hagamos nosotros.", N],
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
  ["ERRORES QUE ROMPEN EN SILENCIO", T],
  ["- Escribir el material a mano con una letra distinta a la de Materiales: el producto queda sin precio.", N],
  ["- Escribir \"metro cuadrado\" en vez de \"m2\": no entra en modo m2 y el material queda sin fórmula.", N],
  [V],
  ["- Material de modo pliego sin geometría: no hay de dónde calcular el rinde. El visor lo", N],
  ["  avisa al cargar el archivo; hasta cargarla, el bot no puede cotizar ese material.", N],
  [V],
  ["- Paquete cerrado tipo 'pack' sin número Y sin 'Piezas por paquete' cargada: se cotiza como", N],
  ["  si el paquete fuera de 1 pieza (se cobra de menos).", N],
  ["- Pieza más grande que el área útil: rinde 0. Se deriva a consulta, nunca se inventa.", N],
  ["- Tramos superpuestos (1-10 y 5-20): se aplica el primero que coincide, y puede no ser el que querías.", N],
  ["- Cargar un producto en una colección que no existe en la hoja Colecciones: queda sin descripción.", N],
  ["DESPUÉS DE EDITAR", T],
  ["Guardar el archivo y volver a cargarlo en el visor de chunks para ver qué va a leer el bot.", N],
  ["Los cambios NO llegan al bot hasta que se ingesta desde ahí.", N],
];

console.log(`catálogo: ${XLSX}`);
console.log(`Instrucciones: ${actual.length} filas actuales → ${HOJA_NUEVA.length} filas nuevas`);

if (!APPLY) {
  console.log("\nDRY RUN — correr con --apply para escribir.");
  process.exit(0);
}

// ── 3) Reconstruir sheetData + sharedStrings ───────────────────────────────────────────
const ATTRS = (xml.match(/<row r="\d+"([^>]*?)(?:\/>|>)/) ?? [, ""])[1].replace(/\s*ht="[\d.]+"/, "");
const filasXml = HOJA_NUEVA
  .map(([texto, estilo], i) => {
    const r = i + 1;
    if (texto === V) return `<row r="${r}"${ATTRS}/>`;
    const s = EST[estilo];
    return `<row r="${r}"${ATTRS}><c r="A${r}" s="${s}" t="s"><v>${SS.idDe(texto)}</v></c></row>`;
  })
  .join("");
entradaDe(ruta).contenido = Buffer.from(
  xml
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${filasXml}</sheetData>`)
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:A${HOJA_NUEVA.length}"/>`),
  "utf8",
);
SS.aplicar();
guardar(entradas);
console.log(`\n✓ Escrito ${XLSX}.`);
