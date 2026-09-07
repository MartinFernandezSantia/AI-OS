// Valida la CALIDAD DE LOS DATOS de un catálogo .xlsx antes de que llegue al bot.
//
// Por qué existe: el cliente carga productos con su propio Claude, y los errores de este
// catálogo rompen EN SILENCIO — un material tipeado con una tilde distinta deja al producto
// sin precio, una unidad que no arranca con el prefijo correcto se cotiza con la fórmula
// equivocada, y la ejecución sale verde igual. Excel no marca nada de eso.
//
// Qué NO hace: no audita decisiones comerciales. Si TG sube un precio o retira un producto,
// es su negocio. Acá solo se miran inconsistencias, faltantes y duplicados.
//
// Las reglas son un PORT de visor/lib/parse.ts (modoDe, escalaDe, geometriaDe) y de la
// fórmula de encaje de lib-xlsx.mjs. Los scripts no importan TS, así que se duplica — el
// mismo precedente que ya sentó `rinde()`. Si cambia parse.ts, cambia esto.
//
//   CATALOGO=Catalogo-TG-cliente.xlsx node scripts/validar-catalogo.mjs
//
// Sale con código 1 si hay errores (para poder usarlo como gate), 0 si solo hay avisos.

import { XLSX, abrir, cadenasDe, relsDe, rinde, valorCelda } from "./lib-xlsx.mjs";

const { get, getOpcional } = abrir();
const leer = (n) => get(n).contenido.toString("utf8");
// sharedStrings.xml puede no existir: un .xlsx guardado por openpyxl reescribe todas las
// cadenas inline (t="inlineStr") y borra la entrada entera. Ausencia ≠ error.
const leerOpcional = (n) => getOpcional(n)?.contenido.toString("utf8") ?? "";

// ── lectura de hojas ───────────────────────────────────────────────────────────────────
const wb = leer("xl/workbook.xml");
const RID = relsDe(leer("xl/_rels/workbook.xml.rels"));
const HOJAS = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"[^>]*\/?>/g)].map((m) => ({
  nombre: m[1],
  ruta: "xl/" + (RID[m[2]] ?? ""),
}));

// Ausente en un .xlsx guardado por openpyxl (ver comentario de leerOpcional): CADENAS queda
// vacía y las celdas t="s" simplemente no aparecen en ese formato (openpyxl las deja
// t="inlineStr", resuelto en valorCelda).
const CADENAS = cadenasDe(leerOpcional("xl/sharedStrings.xml"));

/** Devuelve las filas de una hoja como objetos {encabezado: valor}, más su número de fila. */
function filasDe(hoja) {
  const h = HOJAS.find((x) => x.nombre === hoja);
  if (!h) return null;
  const xml = leer(h.ruta);
  const filas = [];
  // Los <row> pueden ser self-closing (filas vacías) y las columnas saltearse: se indexa
  // por la referencia de cada celda, nunca por posición.
  for (const m of xml.matchAll(/<row[^>]*\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const n = Number(m[1]);
    const celdas = {};
    // OJO con las celdas self-closing (<c r="G2" s="11"/>): si el patrón deja que `[^>]*`
    // consuma el "/" antes de la alternancia, la rama `>…</c>` matchea de más y se come las
    // celdas siguientes hasta el próximo cierre. Por eso el "/" se mira ANTES: si está, la
    // celda está vacía y no hay cuerpo que leer.
    for (const c of (m[2] ?? "").matchAll(/<c\b((?:[^>"]|"[^"]*")*?)(\/)?>/g)) {
      const attrs = c[1];
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      if (!ref || c[2]) continue; // sin referencia, o self-closing = celda vacía
      const resto = m[2].slice(c.index + c[0].length);
      const cuerpo = resto.slice(0, resto.indexOf("</c>"));
      // valorCelda resuelve los tres formatos: t="s" (shared string), t="inlineStr" (texto
      // inline, formato que deja openpyxl al guardar) y el resto (<v> crudo).
      const val = valorCelda(attrs, cuerpo, CADENAS);
      if (val === undefined) continue;
      celdas[ref] = val;
    }
    filas.push({ n, celdas });
  }
  if (!filas.length) return { encabezado: [], filas: [] };
  const cab = filas[0].celdas;
  const encabezado = Object.fromEntries(Object.entries(cab).map(([col, txt]) => [col, txt.trim()]));
  const objetos = filas.slice(1)
    .map((f) => {
      const o = { _fila: f.n };
      for (const [col, val] of Object.entries(f.celdas)) {
        const clave = encabezado[col];
        if (clave) o[clave] = String(val).trim();
      }
      return o;
    })
    // Una fila sin ningún valor no es un error: es espacio en blanco del final de la hoja.
    .filter((o) => Object.keys(o).length > 1);
  return { encabezado: Object.values(encabezado), filas: objetos };
}

// ── reglas portadas de parse.ts ────────────────────────────────────────────────────────
const num = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const limpio = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
};

/** El modo se decide por PREFIJO, o por la columna "Modo de cálculo" cuando está cargada
 *  (etapa 7: la columna manda; el prefijo es el fallback para lo que no la tiene). La lista
 *  de `item` es explícita a propósito: si fuera el default, una unidad mal escrita
 *  ("pliegos A3" en plural) cotizaría como ítem en silencio en vez de fallar. `otro` es el
 *  bucket de error. `fijo` es un monto único por trabajo. */
const modoDe = (unidad, modoCol) => {
  const m = String(modoCol ?? "").trim().toLowerCase();
  if (m) {
    if (m.startsWith("superficie")) return "m2";
    if (m === "fijo") return "fijo";
    if (m === "tramo total") return "item";
    if (m.startsWith("proporcional")) {
      // "proporcional" cubre pliego e item: el prefijo de la unidad decide cuál.
    } else {
      return "otro";
    }
  }
  const u = String(unidad ?? "").trim().toLowerCase();
  if (u.startsWith("pliego")) return "pliego";
  if (u.startsWith("m2") || u.startsWith("m²")) return "m2";
  if (u.startsWith("modelo")) return "fijo";
  if (/^(unidad|hoja|paquete|pack|item|ítem|metro lineal|talonario)\b/.test(u)) return "item";
  return "otro";
};

// ── los datos ──────────────────────────────────────────────────────────────────────────
const errores = [], avisos = [];
const err = (hoja, fila, msg) => errores.push({ hoja, fila, msg });
const avi = (hoja, fila, msg) => avisos.push({ hoja, fila, msg });

const HOJAS_REQUERIDAS = ["Colecciones", "Materiales", "Productos"];
const faltantes = HOJAS_REQUERIDAS.filter((h) => !HOJAS.some((x) => x.nombre === h));
if (faltantes.length) {
  console.error(`✗ faltan hojas: ${faltantes.join(", ")}`);
  console.error(`  hojas encontradas: ${HOJAS.map((h) => h.nombre).join(", ")}`);
  process.exit(1);
}

const colecciones = filasDe("Colecciones");
const materiales = filasDe("Materiales");
const productos = filasDe("Productos");

// ── los desplegables siguen vivos ──────────────────────────────────────────────────────
// La hoja _listas alimenta los desplegables de Colección/Material con fórmulas que leen los
// únicos de Materiales y Colecciones. Si alguien abre el archivo con openpyxl y
// `data_only=True`, esas fórmulas se BORRAN y quedan los últimos valores congelados como
// texto: los desplegables siguen mostrando la lista vieja, así que el daño no se ve —
// simplemente nada de lo que se cargue de ahí en más vuelve a aparecer en ellos.
// Verificado empíricamente, es la razón por la que este chequeo existe.
{
  const hojaListas = HOJAS.find((h) => h.nombre === "_listas");
  if (hojaListas) {
    const xml = leer(hojaListas.ruta);
    const formulas = (xml.match(/<f\b[^>]*t="array"/g) || []).length;
    if (formulas === 0) {
      err("_listas", 1,
        "la hoja _listas perdió sus fórmulas: los desplegables quedaron CONGELADOS con la lista vieja. " +
        "Pasa al abrir el archivo con data_only=True. Todo lo que se cargue desde ahora no va a aparecer " +
        "en los desplegables. Hay que regenerar la copia y volver a cargar sobre una limpia.");
    } else if (formulas < 100) {
      avi("_listas", 1, `la hoja _listas tiene ${formulas} fórmulas (se esperaban ~598). Puede haberse recortado el rango.`);
    }
  }
}

const nombresColeccion = new Set(colecciones.filas.map((c) => c["Colección"]).filter(Boolean));
const nombresMaterial = new Set(materiales.filas.map((m) => m["Material"]).filter(Boolean));

// ── Materiales ─────────────────────────────────────────────────────────────────────────
// Un material son N filas (una por tramo de la escala), todas con el mismo nombre.
const porMaterial = new Map();
for (const m of materiales.filas) {
  const nombre = m["Material"];
  if (!nombre) { avi("Materiales", m._fila, "fila sin nombre de material"); continue; }
  if (!porMaterial.has(nombre)) porMaterial.set(nombre, []);
  porMaterial.get(nombre).push(m);
}

for (const [nombre, tramos] of porMaterial) {
  const unidad = tramos.find((t) => t["Unidad"])?.["Unidad"] ?? "";
  const modoCol = tramos.find((t) => t["Modo de cálculo"])?.["Modo de cálculo"] ?? "";
  const modo = modoDe(unidad, modoCol);
  const f0 = tramos[0]._fila;

  if (!unidad) {
    err("Materiales", f0, `"${nombre}": sin Unidad. Sin unidad no hay forma de cobrarlo.`);
  } else if (modo === "otro") {
    err("Materiales", f0,
      `"${nombre}": la unidad "${unidad}"${modoCol ? ` y el modo "${modoCol}"` : ""} no corresponden a ninguna forma de cobro conocida. ` +
      `La unidad tiene que empezar con "pliego", "m2" o "modelo", o ser una de: unidad, hoja, paquete, pack, item, metro lineal, talonario. ` +
      `Si usás la columna "Modo de cálculo", tiene que ser: proporcional, superficie, fijo o tramo total. ` +
      `Ojo: "metro cuadrado" NO es "m2" (no empieza igual) y queda sin fórmula.`);
  }

  // Etapa 7: la columna "Modo de cálculo" y la unidad se contradicen. Aviso, no error — la
  // carga la valida TG y la puede corregir; el objetivo es que el desacuerdo se vea.
  if (modoCol && modo !== "otro") {
    const modoPrefijo = modoDe(unidad);
    if (modoPrefijo !== modo) {
      avi("Materiales", f0,
        `"${nombre}": el "Modo de cálculo" cargado ("${modoCol}") da "${modo}", pero la unidad "${unidad}" se lee como "${modoPrefijo}". ` +
        `Si el cambio es deliberado, ok; si no, una de las dos está mal.`);
    }
  }

  // Escala: tramos ordenados, sin huecos ni superposiciones, y el último abierto.
  const escala = tramos
    .map((t) => ({ desde: num(t["Desde"]) ?? 1, hasta: num(t["Hasta"]), precio: num(t["Precio por unidad"]), fila: t._fila }))
    .sort((a, b) => a.desde - b.desde);

  for (const t of escala) {
    if (t.precio === null || t.precio <= 0) {
      err("Materiales", t.fila, `"${nombre}": tramo desde ${t.desde} sin precio (o precio 0).`);
    }
  }
  for (let i = 0; i < escala.length - 1; i++) {
    const a = escala[i], b = escala[i + 1];
    if (a.hasta === null) {
      err("Materiales", a.fila, `"${nombre}": el tramo desde ${a.desde} tiene "Hasta" vacío pero no es el último. Solo el último puede quedar abierto.`);
    } else if (a.hasta >= b.desde) {
      err("Materiales", b.fila, `"${nombre}": los tramos ${a.desde}-${a.hasta} y ${b.desde}-${b.hasta ?? ""} se superponen. Se aplica el primero que coincide, que puede no ser el que querías.`);
    } else if (b.desde > a.hasta + 1) {
      err("Materiales", b.fila, `"${nombre}": hay un hueco entre ${a.hasta} y ${b.desde}. Una cantidad ahí no matchea ningún tramo y no se puede cotizar.`);
    }
  }
  if (escala.length && escala[escala.length - 1].hasta !== null) {
    const ultimo = escala[escala.length - 1];
    // Si la fila trae Nota, quien cargó el dato ya decidió a propósito no dar tarifa más
    // allá de ese tope (p. ej. "el PDF no da tramo para más de N unidades, no inventar") —
    // el consejo genérico de "dejá Hasta vacío" sería EQUIVOCADO ahí: derivar a consulta es
    // el comportamiento correcto, no un olvido a corregir.
    const filaOrig = tramos.find((t) => t._fila === ultimo.fila);
    if (filaOrig?.["Nota"]) {
      avi("Materiales", ultimo.fila,
        `"${nombre}": el último tramo termina en ${ultimo.hasta}; por encima el bot deriva a consulta. ` +
        `Parece deliberado (hay una nota en esta fila) — si es así, está bien así.`);
    } else {
      avi("Materiales", ultimo.fila,
        `"${nombre}": el último tramo termina en ${ultimo.hasta}. Una cantidad mayor no matchea ningún tramo — dejá "Hasta" vacío para que signifique "de acá en adelante".`);
    }
  }

  // Geometría: obligatoria en pliego (de ahí sale el rinde), inútil en m2 por ahora.
  const geoFila = tramos.find((t) => t["Área útil ancho (cm)"] && t["Área útil alto (cm)"]);
  if (modo === "pliego" && !geoFila) {
    err("Materiales", f0, `"${nombre}": es modo pliego pero no tiene 'Área útil ancho/alto (cm)'. Sin geometría no hay de dónde calcular cuántas piezas entran.`);
  }
  if (modo === "m2" && !tramos.some((t) => num(t["Mínimo facturable"]) !== null)) {
    avi("Materiales", f0, `"${nombre}": modo m2 sin 'Mínimo facturable'. Se va a cobrar la superficie exacta, sin piso.`);
  }
  if (modo === "m2" && geoFila) {
    avi("Materiales", geoFila._fila,
      `"${nombre}": modo m2 con geometría cargada. Hoy el cálculo por m2 IGNORA el área útil y la separación, ` +
      `así que esas celdas no hacen nada (es el caso de los troquelados por m2, todavía sin resolver).`);
  }
}

// ── Colecciones ────────────────────────────────────────────────────────────────────────
const vistasCol = new Set();
for (const c of colecciones.filas) {
  const nombre = c["Colección"];
  if (!nombre) { avi("Colecciones", c._fila, "fila sin nombre de colección"); continue; }
  if (vistasCol.has(nombre)) err("Colecciones", c._fila, `colección duplicada: "${nombre}".`);
  vistasCol.add(nombre);
  if (!String(c["Descripción"] ?? "").trim()) {
    avi("Colecciones", c._fila, `"${nombre}": sin descripción. Es el texto que encabeza lo que lee el bot.`);
  }
  const base = c["Material base"];
  if (base && !nombresMaterial.has(base)) {
    err("Colecciones", c._fila, `"${nombre}": el material base "${base}" no existe en la hoja Materiales. Revisá que esté escrito igual (tildes incluidas).`);
  }
}

// ── Productos ──────────────────────────────────────────────────────────────────────────
const vistosProd = new Set();
for (const p of productos.filas) {
  const nombre = p["Producto"];
  const col = p["Colección"];
  const mat = p["Material"];
  if (!nombre) { avi("Productos", p._fila, "fila sin nombre de producto"); continue; }

  const clave = `${col} ${nombre}`;
  if (vistosProd.has(clave)) {
    err("Productos", p._fila, `producto duplicado: "${nombre}" en la colección "${col}". Con dos filas iguales, el precio depende de cuál encuentre el bot primero.`);
  }
  vistosProd.add(clave);

  if (!col) {
    err("Productos", p._fila, `"${nombre}": sin colección.`);
  } else if (!nombresColeccion.has(col)) {
    err("Productos", p._fila, `"${nombre}": la colección "${col}" no existe en la hoja Colecciones. El producto queda sin descripción.`);
  }

  if (!mat) {
    err("Productos", p._fila, `"${nombre}": sin material. Sin material no hay precio.`);
    continue;
  }
  if (!nombresMaterial.has(mat)) {
    err("Productos", p._fila,
      `"${nombre}": el material "${mat}" no existe en la hoja Materiales. El producto queda SIN PRECIO y el bot no lo puede cotizar. ` +
      `Suele ser una letra o una tilde de diferencia — elegilo del desplegable en vez de escribirlo.`);
    continue;
  }

  // Rinde: en pliego la pieza tiene que entrar en el área útil.
  const tramos = porMaterial.get(mat) ?? [];
  const unidad = tramos.find((t) => t["Unidad"])?.["Unidad"] ?? "";
  if (modoDe(unidad) === "pliego") {
    const geoFila = tramos.find((t) => t["Área útil ancho (cm)"] && t["Área útil alto (cm)"]);
    const a = num(p["Ancho (cm)"]) ?? num(p["Ancho"]);
    const b = num(p["Alto (cm)"]) ?? num(p["Alto"]);
    if (geoFila && a && b) {
      const geo = {
        utilAncho: num(geoFila["Área útil ancho (cm)"]),
        utilAlto: num(geoFila["Área útil alto (cm)"]),
        separacion: num(geoFila["Separación (cm)"]) ?? 0,
      };
      if (rinde(a, b, geo) === 0) {
        err("Productos", p._fila,
          `"${nombre}": la pieza de ${a}x${b} cm no entra en el área útil de "${mat}" (${geo.utilAncho}x${geo.utilAlto} cm) en ninguna orientación. No se puede cotizar.`);
      }
    }
  }
}

// ── crecimiento ────────────────────────────────────────────────────────────────────────
const topes = [
  ["Productos", productos.filas.at(-1)?._fila ?? 0, 600],
  ["Materiales", materiales.filas.at(-1)?._fila ?? 0, 600],
  ["Colecciones", colecciones.filas.at(-1)?._fila ?? 0, 600],
];
for (const [hoja, ultima, tope] of topes) {
  if (ultima > tope * 0.8) {
    avi(hoja, ultima, `la hoja va por la fila ${ultima} de ${tope}. Cerca del tope los desplegables dejan de funcionar sin avisar — conviene extender el rango.`);
  }
}

// ── salida ─────────────────────────────────────────────────────────────────────────────
console.log(`catálogo: ${XLSX}`);
console.log(`${colecciones.filas.length} colecciones · ${porMaterial.size} materiales (${materiales.filas.length} tramos) · ${productos.filas.length} productos\n`);

const imprimir = (lista, titulo, marca) => {
  if (!lista.length) return;
  console.log(`${marca} ${titulo} (${lista.length})`);
  for (const x of lista) console.log(`   ${x.hoja} fila ${x.fila}: ${x.msg}`);
  console.log("");
};

imprimir(errores, "ERRORES — hay que corregirlos antes de integrar", "✗");
imprimir(avisos, "avisos — conviene mirarlos", "⚠");

if (!errores.length && !avisos.length) console.log("✓ sin problemas.");
else if (!errores.length) console.log("✓ sin errores.");

process.exit(errores.length ? 1 : 0);
