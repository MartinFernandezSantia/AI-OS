// Armado del texto de los chunks. Función PURA, sin I/O — es lo que el visor inspecciona
// y lo que después va a importar el CLI de ingesta de la Fase 2.
//
// OJO, no confundir con el chunk del bot lite (whatsapp-rag-lite/lib/catalog/rag-chunk.ts):
// aquel modela producto-bot → variantes → refs [vN] → metadata.precios, porque ahí el LLM
// NO calculaba (elegía una opción y un nodo determinista inyectaba el monto en {Pn}).
// Acá el bot CALCULA: el chunk no lleva precios cerrados, lleva la ESCALA del material, la
// GEOMETRÍA de la unidad de cobro (para cotizar cualquier medida, no solo las de referencia)
// y el rinde calculado de cada medida de referencia. El modelo es otro; no hay nada que
// reusar de allá salvo la idea de que el chunk es una unidad semántica autocontenida.

import { rinde, type Geometria } from "./geometria";
import {
  escalaDe,
  geometriaDe,
  modoDe,
  num,
  unidadDe,
  type Datos,
  type Fila,
  type Tramo,
} from "./parse";

export type Estrategia = "coleccion-material" | "coleccion" | "producto";

export interface Chunk {
  titulo: string;
  /** El bloque de texto tal cual se embebe: esto es lo que ve el bot. */
  texto: string;
  /** Lo que la Fase 2 va a escribir en la columna `metadata`. Todavía no se usa. */
  meta: Record<string, unknown>;
}

/** Columnas de Productos que tienen lugar propio en la plantilla del chunk. Cualquier otra
 *  se emite genérica al final del ítem — así una columna nueva del cliente entra sin código. */
/** Cuántas piezas salen de UNA unidad de cobro (un pliego, una plancha, una bobina…).
 *  Para las unidades geométricas (pliego) YA NO se carga a mano: se calcula desde la
 *  geometría del material. La columna queda para unidades donde el rinde es dato del
 *  taller (una bobina, una plancha) — y si viene cargada, gana sobre el cálculo. */
export const COL_RINDE = "Piezas por unidad de cobro";

/** El material que se cotiza cuando el cliente no pide una opción especial. Vive en la
 *  hoja Colecciones (una por colección) porque la elección es del negocio, no del bot:
 *  el prompt le dice "cotizá la base y sugerí alternativas". */
export const COL_BASE = "Material base";

/** Colecciones cuyos productos son un AGREGADO sobre otro trabajo (laminado, ojalillos,
 *  anillado), no un trabajo en sí. El mínimo por trabajo no les aplica: cubre el armado
 *  y el montaje de una producción, y laminar una hoja no tiene nada de eso. Sin esto el
 *  bot cotizaría el mínimo entero por un laminado de $330. Vacío = se aplica, como siempre. */
export const COL_SIN_MINIMO = "Sin mínimo por trabajo";

/** Un "sí" del Excel, tolerante a como lo escriba el cliente (sí/si/x/1/true). */
const esSi = (v: unknown): boolean => /^(s[ií]|x|1|true|v)$/i.test(String(v ?? "").trim());

const CONOCIDAS = new Set([
  "Colección",
  "Producto",
  "Descripción",
  "Material",
  "Ancho (cm)",
  "Alto (cm)",
  COL_RINDE,
]);

/**
 * El rinde efectivo de un producto: la columna cargada (dato del taller) manda; si no
 * está y hay geometría + medidas, se calcula; si no hay nada, null. Un 0 calculado
 * significa "no entra en el área útil" — se devuelve tal cual para que `avisos` lo vea,
 * pero el chunk no lo emite (0 es falsy en los call sites).
 */
export function rindeEfectivo(p: Fila, geo: Geometria | null): number | null {
  const cargado = num(p[COL_RINDE]);
  if (cargado !== null) return cargado;
  const a = num(p["Ancho (cm)"]);
  const h = num(p["Alto (cm)"]);
  if (geo && a !== null && h !== null) return rinde(a, h, geo);
  return null;
}

const money = (n: number): string => "$" + n.toLocaleString("es-AR");

/** Formatea un número para texto en es-AR (0.5 → "0,5"). */
const numTexto = (n: number): string => n.toLocaleString("es-AR");

/**
 * Plural de una unidad de cobro para rotular tramos: "pliego A3" → "pliegos A3".
 * Se pluraliza SOLO la primera palabra (el sustantivo; lo que sigue es el calificador de
 * tamaño). "m2" queda igual porque no termina en letra — y así una unidad nueva del cliente
 * no se rompe: en el peor caso queda sin pluralizar, que se lee raro pero no miente.
 */
const pluralUnidad = (unidad: string): string =>
  unidad.replace(/^(\p{L}+)/u, (w) => (/[a-záéíóúñ]$/i.test(w) ? w + "s" : w));

/**
 * La escala como texto legible.
 * Un solo tramo (tarifa plana) → solo el monto, sin rango: no tiene sentido decir
 * "1 o más: $16.000" cuando no hay otro tramo con el que comparar.
 *
 * `unidad` rotula CADA tramo ("2 a 10 pliegos A3"), no solo el encabezado. Es redundante
 * para un humano y es justo lo que el LLM necesita: en el humo de Fase 3, con los tramos
 * sin rótulo, el modelo tomó las 250 PIEZAS pedidas y buscó el tramo "101 o más" en vez de
 * convertir a 3 pliegos primero (250 → $1.710 en vez de $2.200; total $5.100 vs $6.600).
 * Los números pelados no dicen de qué son, y el chunk viene de hablar de piezas ("entran
 * 104 por pliego"), así que la lectura equivocada es la natural. Cada fila se defiende sola.
 */
export function escalaTexto(tramos: Tramo[], unidad = ""): string {
  if (!tramos.length) return "";
  if (tramos.length === 1) return money(tramos[0].precio);
  const plural = pluralUnidad(unidad);
  const suf = plural ? " " + plural : "";
  return tramos
    .map((t) => {
      if (t.hasta === null) return `${t.desde}${suf} o más: ${money(t.precio)}`;
      if (t.desde === t.hasta) {
        // Un solo valor: va en singular ("1 pliego A3", no "1 pliegos A3").
        return `${t.desde}${unidad ? " " + unidad : ""}: ${money(t.precio)}`;
      }
      return `${t.desde} a ${t.hasta}${suf}: ${money(t.precio)}`;
    })
    .join(" · ");
}

/**
 * La línea de precio de un material. El MODO sale de la unidad del material
 * (no hay columna "Modo" en el Excel — se sacó a propósito para no tener dos fuentes).
 *
 * La unidad se imprime TAL CUAL viene del Excel: si el cliente escribe "pliego A3", el chunk
 * dice A3; si mañana escribe "pliego A4", dice A4. El tamaño del pliego es un dato del
 * cliente, no un literal del código.
 */
export function lineaPrecio(material: string, tramos: Tramo[]): string {
  if (!tramos.length) return "";
  const unidad = tramos[0].unidad;
  const min = tramos[0].minimo;
  // El mínimo facturable se expresa en la misma unidad de cobro (0,5 m2, 1 pliego…).
  const cola = min !== null ? `. Mínimo facturable ${numTexto(min)} ${unidad}` : "";
  // Con varios tramos el encabezado tiene que decir QUÉ indexa la escala. "Precio por
  // pliego A3" solo se lee como "cuánto cuesta un pliego" — cierto, pero deja abierto en
  // qué unidad se buscan los rangos, y el modelo los leyó en piezas (ver escalaTexto).
  const cabecera =
    tramos.length > 1
      ? `Precio según CANTIDAD DE ${pluralUnidad(unidad).toUpperCase()} (no de piezas) — ${material}`
      : `Precio por ${unidad} — ${material}`;
  return `${cabecera}: ${escalaTexto(tramos, unidad)}${cola}.`;
}

/** Cómo se nombra un tramo en prosa, para citarlo desde el ejemplo de la cadena. */
function nombreTramo(t: Tramo, unidad: string): string {
  const plural = pluralUnidad(unidad);
  if (t.hasta === null) return `${t.desde} ${plural} o más`;
  if (t.desde === t.hasta) return `${t.desde} ${unidad}`;
  return `${t.desde} a ${t.hasta} ${plural}`;
}

/** El tramo que contiene `n` unidades. El primero cubre todo lo que quede por debajo de su
 *  `desde`, igual que en el auditor del workflow (no existe tramo más barato que el primero). */
function tramoDe(tramos: Tramo[], n: number): Tramo | null {
  for (let i = 0; i < tramos.length; i++) {
    const desde = i === 0 ? -Infinity : tramos[i].desde;
    const hasta = tramos[i].hasta ?? Infinity;
    if (n >= desde && n <= hasta) return tramos[i];
  }
  return null;
}

/** Cantidades que un cliente pide de verdad. El ejemplo tiene que sonar a pedido real, no
 *  a un número construido para que la cuenta cierre. */
const CANTIDADES_TIPICAS = [50, 100, 200, 250, 500, 1000] as const;

/**
 * La línea de ejemplo que muestra la cadena piezas → unidades de cobro → tramo, con los
 * números de ESTA medida. El system prompt ya explica la regla en general; acá va resuelta
 * al lado del dato, que es donde el modelo la necesita.
 *
 * Se elige, entre cantidades redondas, la más chica donde leer la escala en PIEZAS daría un
 * tramo DISTINTO que leerla en unidades de cobro. Ese es exactamente el error del humo (250
 * stickers 3x3: el modelo tomó el tramo "101 o más" por las 250 piezas, cuando eran 3
 * pliegos y correspondía "2 a 10"). Un ejemplo donde ambas lecturas coinciden no enseña
 * nada: se ve bien y deja pasar el bug.
 */
function ejemploCadena(r: number, tramos: Tramo[], unidad: string): string | null {
  if (tramos.length < 2 || !(r > 0)) return null;

  const candidatas = CANTIDADES_TIPICAS.filter((q) => q > r); // que haya conversión que hacer
  if (!candidatas.length) return null;
  // La más chica que distingue las dos lecturas; si ninguna lo hace, la más chica a secas.
  const piezas =
    candidatas.find((q) => tramoDe(tramos, Math.ceil(q / r)) !== tramoDe(tramos, q)) ??
    candidatas[0];

  const unidades = Math.ceil(piezas / r);
  const objetivo = tramoDe(tramos, unidades);
  if (!objetivo) return null;

  // La cantidad de unidades manda el número gramatical: 1 pliego, 2 pliegos.
  const unidadesTexto = `${numTexto(unidades)} ${unidades === 1 ? unidad : pluralUnidad(unidad)}`;
  return (
    `  Ej.: ${numTexto(piezas)} piezas = ${unidadesTexto}` +
    ` (${numTexto(piezas)} ÷ ${numTexto(r)}, redondeando para arriba)` +
    ` → tramo "${nombreTramo(objetivo, unidad)}", ${money(objetivo.precio)} cada ${unidad}.`
  );
}

/** Las líneas de un producto dentro de la lista de medidas. `unidad` y `geo` vienen del
 *  material; `tramos` solo para el ejemplo de la cadena. */
function itemProducto(p: Fila, unidad: string, geo: Geometria | null, tramos: Tramo[] = []): string[] {
  const partes = [`- ${p["Producto"] ?? "(sin nombre)"}`];

  const a = p["Ancho (cm)"];
  const h = p["Alto (cm)"];
  if (a && h) partes.push(`${a}x${h} cm`);

  // El rinde solo aparece donde hace falta convertir piezas → unidades de cobro (modo pliego
  // y similares). En m2 no hay ni columna ni geometría y no entra. La unidad sale del material.
  const r = rindeEfectivo(p, geo);
  if (r) partes.push(`entran ${numTexto(r)} por ${unidad || "unidad"}`);

  const lineas = [partes.join(" · ") + "."];
  if (p["Descripción"]) lineas.push(`  ${p["Descripción"]}`);
  if (r) {
    const ej = ejemploCadena(r, tramos, unidad);
    if (ej) lineas.push(ej);
  }

  // Columnas que el cliente agregó y no conocemos: se emiten igual, sin tocar código.
  const extras = Object.keys(p).filter((k) => !CONOCIDAS.has(k));
  for (const k of extras) lineas.push(`  ${k}: ${p[k]}`);

  return lineas;
}

/**
 * Las líneas que habilitan la medida libre. El chunk lleva los DATOS que la fórmula de
 * encaje consume (área útil, separación, unidad); la fórmula general vive en la hoja
 * Instrucciones → el system prompt del bot, para no repetirla (y desalinearla) por chunk.
 */
function lineasMotor(modo: string, unidad: string, geo: Geometria | null): string[] {
  if (modo === "pliego" && geo) {
    const sep = geo.separacion
      ? `separación entre piezas: ${numTexto(geo.separacion)} cm`
      : "sin separación entre piezas";
    return [
      "Se cotiza CUALQUIER medida en cm; las de abajo son referencias de tamaños populares.",
      `Área útil del ${unidad || "pliego"}: ${numTexto(geo.utilAncho)}x${numTexto(geo.utilAlto)} cm · ${sep}.`,
    ];
  }
  if (modo === "m2") return ["Se cotiza cualquier medida (m2 = ancho x alto en cm ÷ 10.000)."];
  return [];
}

/** Descripción de una colección por nombre. */
const descripcionDe = (datos: Datos, coleccion: string): string =>
  datos.colecciones.find((c) => c["Colección"] === coleccion)?.["Descripción"] ?? "";

/** Material base de una colección (columna del Excel); "" si no está marcada. */
const baseDe = (datos: Datos, coleccion: string): string =>
  datos.colecciones.find((c) => c["Colección"] === coleccion)?.[COL_BASE] ?? "";

/** ¿La colección está exenta del mínimo por trabajo? (ver COL_SIN_MINIMO) */
const sinMinimoDe = (datos: Datos, coleccion: string): boolean =>
  esSi(datos.colecciones.find((c) => c["Colección"] === coleccion)?.[COL_SIN_MINIMO]);

/**
 * La escala como DATO estructurado para `metadata`. El texto del chunk la lleva en prosa
 * (`lineaPrecio`) porque es lo que lee el LLM; esto es lo que lee el AUDITOR del workflow
 * para re-calcular el total sin confiar en lo que el bot dice haber leído.
 */
function escalaMeta(tramos: Tramo[]): Record<string, unknown>[] {
  return tramos.map((t) => ({
    desde: t.desde,
    hasta: t.hasta,
    precio: t.precio,
    ...(t.minimo !== null && { minimo_facturable: t.minimo }),
  }));
}

/** Productos de una colección, en el orden del Excel. */
const productosDe = (datos: Datos, coleccion: string): Fila[] =>
  datos.productos.filter((p) => p["Colección"] === coleccion);

/** Nombres de colección en orden: los de la hoja Colecciones primero, después huérfanas. */
function nombresColeccion(datos: Datos): string[] {
  const declaradas = datos.colecciones.map((c) => c["Colección"]).filter(Boolean);
  const usadas = [...new Set(datos.productos.map((p) => p["Colección"]).filter(Boolean))];
  return [...declaradas, ...usadas.filter((u) => !declaradas.includes(u))];
}

/** Materiales que usa una colección, en orden de aparición. */
const materialesDe = (items: Fila[]): string[] => [
  ...new Set(items.map((p) => p["Material"]).filter(Boolean)),
];

// ── Estrategia 1: colección + material (la unidad cotizable cerrada) ────────────────────
// Una sola escala por chunk: cero ambigüedad de qué precio aplicar. El bot igual ve las
// medidas hermanas, así puede sugerir 5x5 si le piden 4x4.

function chunksColeccionMaterial(datos: Datos): Chunk[] {
  const out: Chunk[] = [];
  for (const col of nombresColeccion(datos)) {
    const items = productosDe(datos, col);
    if (!items.length) continue;
    const mats = materialesDe(items);
    const desc = descripcionDe(datos, col);

    const base = baseDe(datos, col);

    for (const mat of mats) {
      const suyos = items.filter((p) => p["Material"] === mat);
      const tramos = escalaDe(datos.materiales, mat);
      // Con un solo material, el nombre del material no agrega nada al título.
      const titulo = mats.length > 1 ? `${col} — ${mat}` : col;

      const unidad = unidadDe(datos.materiales, mat);
      const modo = modoDe(unidad);
      const geo = geometriaDe(datos.materiales, mat);
      // Solo hay base donde hay algo que elegir: con un material único la línea sería
      // ruido (y "el material base" no significa nada si no hay alternativa).
      const varios = mats.length > 1;
      const esBase = varios && base === mat;
      const otros = mats.filter((m) => m !== mat);

      const L: string[] = [titulo];
      if (desc) L.push(desc);
      // Los dos ejes por SEPARADO. El título los junta con un guion y el bot no tiene
      // cómo saber dónde termina uno y empieza el otro: sin esta línea, "la colección"
      // de las de abajo se queda sin referente claro.
      if (varios) L.push(`Colección: ${col}. Material: ${mat}.`);
      // La colección se nombra explícita (no "la colección") por lo mismo. Y cada chunk
      // lleva a sus hermanos: si el retrieval trae uno solo, el bot igual puede sugerir
      // alternativas sin inventarlas ni depender de la prosa de la descripción.
      if (esBase) {
        L.push(`Es el material BASE de "${col}": se cotiza este salvo que el cliente pida otro.`);
        if (otros.length) L.push(`También hay en: ${otros.join(" · ")}.`);
      } else if (varios && base) {
        L.push(`El material base de "${col}" es ${base}.`);
      }
      const motor = lineasMotor(modo, unidad, geo);
      if (motor.length) L.push("", ...motor);
      L.push("", "Medidas de referencia:");
      for (const p of suyos) L.push(...itemProducto(p, unidad, geo, tramos));
      const precio = lineaPrecio(mat, tramos);
      if (precio) L.push("", precio);

      out.push({
        titulo,
        texto: L.join("\n"),
        meta: {
          estrategia: "coleccion-material",
          coleccion: col,
          material: mat,
          unidad,
          modo,
          productos: suyos.length,
          es_base: esBase,
          // El auditor lo lee para NO aplicar el mínimo por trabajo (ver COL_SIN_MINIMO).
          sin_minimo: sinMinimoDe(datos, col),
          // El auditor del workflow re-calcula con esto; sin escala en la metadata
          // tendría que parsear la prosa del chunk.
          escala: escalaMeta(tramos),
          ...(geo && {
            geometria: {
              util_ancho: geo.utilAncho,
              util_alto: geo.utilAlto,
              separacion: geo.separacion,
            },
          }),
        },
      });
    }
  }
  return out;
}

// ── Estrategia 2: por colección ────────────────────────────────────────────────────────
// Menos chunks, pero una colección con varios materiales arrastra TODAS sus escalas en el
// mismo bloque y el bot tiene que elegir cuál aplica. Se genera para poder verlo.

function chunksColeccion(datos: Datos): Chunk[] {
  const out: Chunk[] = [];
  for (const col of nombresColeccion(datos)) {
    const items = productosDe(datos, col);
    if (!items.length) continue;
    const desc = descripcionDe(datos, col);

    const base = baseDe(datos, col);

    const L: string[] = [col];
    if (desc) L.push(desc);
    if (base && materialesDe(items).length > 1) {
      L.push(`Material base de "${col}": ${base} (se cotiza este salvo que el cliente pida otro).`);
    }
    L.push("", "Productos disponibles:");
    // Acá conviven productos de materiales distintos: la unidad se resuelve por producto.
    for (const p of items) {
      const mat = p["Material"] ?? "";
      L.push(
        ...itemProducto(
          p,
          unidadDe(datos.materiales, mat),
          geometriaDe(datos.materiales, mat),
          escalaDe(datos.materiales, mat),
        ),
      );
    }

    const mats = materialesDe(items);
    const precios = mats
      .map((m) => lineaPrecio(m, escalaDe(datos.materiales, m)))
      .filter(Boolean);
    if (precios.length) L.push("", ...precios);

    out.push({
      titulo: col,
      texto: L.join("\n"),
      meta: {
        estrategia: "coleccion",
        coleccion: col,
        materiales: mats,
        productos: items.length,
        ...(base && { material_base: base }),
      },
    });
  }
  return out;
}

// ── Estrategia 3: por producto ─────────────────────────────────────────────────────────
// Máxima precisión al recuperar, pero repite la escala completa en cada chunk que comparte
// material y el bot no ve alternativas sin más retrievals.

function chunksProducto(datos: Datos): Chunk[] {
  return datos.productos.map((p) => {
    const mat = p["Material"] ?? "";
    const tramos = escalaDe(datos.materiales, mat);
    const unidad = unidadDe(datos.materiales, mat);
    const geo = geometriaDe(datos.materiales, mat);
    const nombre = p["Producto"] ?? "(sin nombre)";

    const L: string[] = [nombre];
    if (p["Colección"]) L.push(`Colección: ${p["Colección"]}.`);
    if (p["Descripción"]) L.push(p["Descripción"]);

    const a = p["Ancho (cm)"];
    const h = p["Alto (cm)"];
    if (a && h) L.push(`Medida: ${a}x${h} cm.`);
    const r = rindeEfectivo(p, geo);
    if (r) {
      L.push(`Entran ${numTexto(r)} por ${unidad || "unidad"}.`);
      const ej = ejemploCadena(r, tramos, unidad);
      if (ej) L.push(ej.trimStart());
    }

    for (const k of Object.keys(p).filter((k) => !CONOCIDAS.has(k))) L.push(`${k}: ${p[k]}.`);

    const precio = lineaPrecio(mat, tramos);
    if (precio) L.push(precio);

    return {
      titulo: nombre,
      texto: L.join("\n"),
      meta: {
        estrategia: "producto",
        coleccion: p["Colección"] ?? null,
        material: mat,
        unidad,
        modo: modoDe(unidad),
        piezas_por_unidad: r,
        escala: escalaMeta(tramos),
      },
    };
  });
}

/** Arma los chunks con la estrategia pedida. Las tres salen de los mismos datos. */
export function chunks(datos: Datos, estrategia: Estrategia): Chunk[] {
  switch (estrategia) {
    case "coleccion-material":
      return chunksColeccionMaterial(datos);
    case "coleccion":
      return chunksColeccion(datos);
    case "producto":
      return chunksProducto(datos);
  }
}

/**
 * Problemas del catálogo que el chunk NO puede mostrar (saldría "un chunk que parece
 * completo y no lo está"). Se muestran en el visor antes de ingestar; no bloquean.
 */
export function avisos(datos: Datos): string[] {
  const out: string[] = [];

  // Material con precio cargado pero SIN ningún producto que lo use. El chunk es
  // colección+material y sale de los productos, así que ese material no genera chunk: el
  // bot no puede verlo ni cotizarlo, aunque esté en la lista de precios del cliente.
  // Desaparece en silencio — el cliente lo ve en su Excel y asume que el bot lo cotiza.
  //
  // Lo encontró la Fase 4: el caso "300 etiquetas 4x4 solo impresión" era IMPOSIBLE de
  // acertar (el material no tiene productos), y el bot cotizó el troquelado, que es lo
  // razonable con lo que puede ver. Sin este aviso parecía un fallo del modelo.
  const conProducto = new Set(datos.productos.map((p) => p["Material"]).filter(Boolean));
  const conPrecio = [...new Set(datos.materiales.map((m) => m["Material"]).filter(Boolean))];
  for (const mat of conPrecio) {
    if (conProducto.has(mat)) continue;
    out.push(
      `"${mat}": tiene precio cargado pero ningún producto lo usa, así que no genera chunk ` +
        `y el bot no puede cotizarlo. Agregale un producto en la hoja Productos, o sacalo ` +
        `de Materiales si ya no se ofrece.`,
    );
  }

  // Material base: solo importa donde hay más de un material para elegir. Sin base
  // marcada el bot no sabe cuál cotizar por default y elige el que le quede a mano.
  for (const col of nombresColeccion(datos)) {
    const items = productosDe(datos, col);
    const mats = materialesDe(items);
    if (mats.length < 2) continue;
    const base = baseDe(datos, col);
    if (!base) {
      out.push(
        `${col}: usa ${mats.length} materiales y no tiene "${COL_BASE}" marcado. ` +
          `Elegí cuál se cotiza cuando el cliente no pide una opción especial.`,
      );
    } else if (!mats.includes(base)) {
      out.push(
        `${col}: el "${COL_BASE}" es "${base}", pero ningún producto de la colección lo usa ` +
          `(usa: ${mats.join(" · ")}). Revisá cuál está mal.`,
      );
    }
  }

  for (const p of datos.productos) {
    const mat = p["Material"] ?? "";
    const unidad = unidadDe(datos.materiales, mat);
    if (modoDe(unidad) !== "pliego") continue;

    const nombre = p["Producto"] ?? "(sin nombre)";
    const geo = geometriaDe(datos.materiales, mat);
    const cargado = num(p[COL_RINDE]);
    const a = num(p["Ancho (cm)"]);
    const h = num(p["Alto (cm)"]);
    const calculado = geo && a !== null && h !== null ? rinde(a, h, geo) : null;

    if (cargado === null && calculado === null) {
      // Sin columna ni geometría: el chunk sale con precio pero sin rinde, y el bot inventa.
      out.push(
        `${nombre}: sin rinde — el material "${mat}" no tiene geometría (área útil + separación) ` +
          `y la columna "${COL_RINDE}" está vacía. El bot no va a poder cotizarlo.`,
      );
    } else if (cargado !== null && calculado !== null && cargado !== calculado) {
      // Dos fuentes que no coinciden: gana el dato cargado (lo puso un humano a propósito).
      out.push(
        `${nombre}: la columna dice ${cargado} pero la geometría de "${mat}" calcula ${calculado}. ` +
          `Se usa ${cargado}; revisar cuál está mal.`,
      );
    } else if (cargado === null && calculado === 0) {
      out.push(
        `${nombre} (${a}x${h} cm): no entra en el área útil de "${mat}" en ninguna orientación. ` +
          `La referencia sale sin rinde; el bot debe derivar a consulta.`,
      );
    }
  }

  // Colecciones donde el mínimo por trabajo se come TODOS los precios y no están exentas.
  // El caso son las terminaciones (laminado $330, ojalillos $1.000): agregados sobre un
  // trabajo ya cobrado, donde el mínimo multiplica el precio por 12. Es un error caro y
  // silencioso — el total "se ve" bien, solo está mal.
  //
  // El mínimo aplica al TOTAL, no al precio unitario, así que no alcanza con mirar el
  // tramo: en una colección por pliegos el unitario puede ser $2.800 y un pedido de 2
  // pliegos ya pasa el mínimo. Solo avisa cuando la colección no puede superarlo NUNCA, y
  // eso solo pasa donde no hay cantidad que escale el total: unidades no geométricas
  // (una unidad = un ítem). Las colecciones pliego/m2 quedan fuera por construcción.
  const minimoTrabajo = num(
    datos.parametros.find((p) => p["Parámetro"] === "Mínimo por trabajo")?.["Valor"],
  );
  if (minimoTrabajo !== null && minimoTrabajo > 0) {
    for (const col of nombresColeccion(datos)) {
      if (sinMinimoDe(datos, col)) continue;
      const mats = materialesDe(productosDe(datos, col));
      // Con una unidad de cobro geométrica (pliego) o continua (m2), la cantidad hace
      // crecer el total y el mínimo solo afecta al pedido más chico: eso es lo que se
      // quiere. El problema es solo donde una unidad = un ítem.
      if (mats.some((m) => modoDe(unidadDe(datos.materiales, m)) !== "otro")) continue;
      const topes = mats
        .map((m) => escalaDe(datos.materiales, m))
        .filter((t) => t.length)
        .map((t) => Math.max(...t.map((x) => x.precio)));
      if (!topes.length) continue;
      const tope = Math.max(...topes);
      if (tope >= minimoTrabajo) continue;
      out.push(
        `${col}: el precio más alto de la colección (${money(tope)}) no llega al mínimo por ` +
          `trabajo (${money(minimoTrabajo)}), así que un pedido de 1 se va a cotizar ${money(minimoTrabajo)}. ` +
          `Si son agregados sobre otro trabajo (laminado, ojalillos, anillado), marcá ` +
          `"${COL_SIN_MINIMO}" = sí en la hoja Colecciones.`,
      );
    }
  }

  return out;
}
