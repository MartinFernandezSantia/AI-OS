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
  esMedidaContinua,
  esSi,
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

/** El material que se cotiza cuando el cliente no pide una opción especial. Vive en la
 *  hoja Colecciones (una por colección) porque la elección es del negocio, no del bot:
 *  el prompt le dice "cotizá la base y sugerí alternativas". */
export const COL_BASE = "Material base";

/** Colecciones cuyos productos son un AGREGADO sobre otro trabajo (laminado, ojalillos,
 *  anillado), no un trabajo en sí. El mínimo por trabajo no les aplica: cubre el armado
 *  y el montaje de una producción, y laminar una hoja no tiene nada de eso. Sin esto el
 *  bot cotizaría el mínimo entero por un laminado de $330. Vacío = se aplica, como siempre. */
export const COL_SIN_MINIMO = "Sin mínimo por trabajo";

/**
 * El tamaño como lo nombra el cliente: "A4", "A5 o A6", "oficio", "9x13 cm".
 *
 * Es distinto de Ancho/Alto, que son la medida con la que se CALCULA. En lo que se cobra
 * de a ítem (un anillado, un recetario) no hay nada que calcular: el tamaño es una
 * característica del producto, y el cliente pregunta y responde en A4, no en 21x29,7. Poner
 * los cm ahí no solo no ayuda — hace que el bot los lea como una medida cotizable.
 *
 * Donde SÍ se calcula por superficie (pliego, m2) esta columna no va: ahí la medida es el
 * dato de entrada y el cliente pide cualquiera.
 */
export const COL_FORMATO = "Formato";

/**
 * Agrupa líneas de precio que son EL MISMO producto en distinta presentación: las tarjetas
 * simple faz de 100, 500 y 1000, o los cinco formatos de plastificado.
 *
 * Sin esto cada precio genera su propio chunk, y en tarjetas eso daba 14 casi idénticos —
 * 35% de su texto literalmente igual, y la descripción de la colección nombrando "100, 500
 * o 1000" dentro de TODOS, así que buscar "1000 tarjetas" matcheaba con los 14 por igual.
 * Agrupados, el bot ve la tabla entera en un resultado y elige leyendo, no confiando en que
 * el vector correcto entre en el top K.
 *
 * Es una agrupación de PRESENTACIÓN, no una escala: cada fila mantiene su precio cerrado
 * (500 tarjetas no son cinco veces 100) y no se interpola entre ellas.
 */
export const COL_FAMILIA = "Familia";

/**
 * Cuántas PIEZAS trae una unidad de cobro que se vende en paquete cerrado: 100 tarjetas,
 * 500 volantes, 10 talonarios, 4 libros.
 *
 * Existe porque el cliente pide en piezas ("mil tarjetas") y el catálogo cobra en paquetes.
 * Sin este dato el auditor multiplicaba las dos cosas: el modelo declaraba el material
 * "Tarjetas 9x5 doble faz x1000" con cantidad 1000, y 1000 × $54.000 daba $54.000.000.
 * El nombre ya decía x1000 y la cantidad lo volvía a decir.
 *
 * Es un dato del CATÁLOGO, no algo que el modelo deba despejar en el prompt: esa es la
 * misma apuesta que ya falló con los pliegos. El auditor divide y exige división exacta.
 *
 * Se deriva sola de la Unidad ("paquete de 500 volantes" → 500). La columna es para lo que
 * no se puede leer así, y si está cargada manda sobre lo derivado.
 *
 * OJO con la diferencia entre un empaque y un producto que se LLAMA pack: el "Pack 4 libros
 * de medicina" tiene unidad "pack" y el cliente lo pide de a uno ("quiero el pack"), no de
 * a cuatro. Cargarle 4 hacía que el bot derivara un producto que sí está en el catálogo,
 * porque 1 no es múltiplo de 4. Por eso una unidad de conjunto SIN número no cuenta como
 * paquete: el número tiene que estar, y tiene que ser de piezas.
 */
export const COL_PAQUETE = "Piezas por paquete";

const CONOCIDAS = new Set([
  "Colección",
  "Producto",
  "Descripción",
  "Material",
  "Ancho (cm)",
  "Alto (cm)",
  COL_FORMATO,
]);

/**
 * El rinde efectivo de un producto, calculado SIEMPRE desde la geometría del material
 * (la columna cargada a mano ya no existe). Con medidas + geometría devuelve el rinde;
 * sin alguna de las dos, null. Un 0 calculado significa "no entra en el área útil" — se
 * devuelve tal cual para que `avisos` lo vea, pero el chunk no lo emite (0 es falsy).
 */
export function rindeEfectivo(p: Fila, geo: Geometria | null): number | null {
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
 *
 * Se pluraliza SOLO la primera palabra (el sustantivo; lo que sigue es el calificador de
 * tamaño). Los sustantivos son una lista CERRADA: el catálogo tiene una docena de unidades
 * y cada una se escribe como se dice.
 *
 * Antes esto era una regla ("+s" si termina en letra) y se equivocaba en los dos bordes:
 * escribía "unidads" — que salía al texto que lee el cliente — y al arreglarlo con la regla
 * del castellano ("-es" tras consonante) rompía "m2", que pasaba a "mes2" porque el 2 no es
 * letra y el sustantivo capturado quedaba en "m". Una tabla no tiene bordes.
 *
 * Una palabra que no esté acá queda SIN pluralizar: se lee raro pero no inventa.
 */
const PLURALES: Record<string, string> = {
  pliego: "pliegos",
  unidad: "unidades",
  hoja: "hojas",
  paquete: "paquetes",
  pack: "packs",
  metro: "metros",
  item: "items",
  ítem: "ítems",
  plancha: "planchas",
  bobina: "bobinas",
  modelo: "modelos",
  talonario: "talonarios",
};

/** Adjetivos que acompañan a un sustantivo de unidad y tienen que concordar con su plural.
 *  Sin esto "metro lineal" salía "metros lineal" en cada tramo de la escala. Lista CERRADA
 *  por el mismo motivo que PLURALES: una palabra que no esté acá se lee raro, pero no se
 *  inventa una regla que pluralice mal un caso que nadie previó. */
const ADJETIVOS: Record<string, string> = {
  lineal: "lineales",
  cuadrado: "cuadrados",
  corrido: "corridos",
};

const pluralUnidad = (unidad: string): string =>
  unidad
    .replace(/^(\p{L}+)/u, (w) => PLURALES[w.toLowerCase()] ?? w)
    .replace(/\s(\p{L}+)/u, (todo, w) => {
      const p = ADJETIVOS[String(w).toLowerCase()];
      return p ? " " + p : todo;
    });

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
      // Un tramo marcado "Precio total por tramo" es un monto ÚNICO para todo el rango
      // (troquelado 1-10 piezas = $10.000 enteros): sin la marca, el modelo leería el
      // precio como por-unidad y multiplicaría. "TOTAL" es la señal.
      const marca = t.total ? " TOTAL" : "";
      if (t.hasta === null) return `${t.desde}${suf} o más: ${money(t.precio)}${marca}`;
      if (t.desde === t.hasta) {
        // Un solo valor: va en singular ("1 pliego A3", no "1 pliegos A3").
        return `${t.desde}${unidad ? " " + unidad : ""}: ${money(t.precio)}${marca}`;
      }
      return `${t.desde} a ${t.hasta}${suf}: ${money(t.precio)}${marca}`;
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
    ` → tramo "${nombreTramo(objetivo, unidad)}", ${money(objetivo.precio)} cada ${unidad}.` +
    // El ejemplo muestra la cuenta para que el modelo NO lea el tramo en piezas. Pero
    // mostrarla también lo invitaba a hacerla: en la ejecución 412 declaró 6 pliegos para
    // 100 stickers y el sistema volvió a dividir ($4.000 en vez de $16.800). El ejemplo
    // enseña a leer el tramo, no a convertir la cantidad — y hay que decirlo acá, porque
    // acá es donde está la tentación.
    ` (La cuenta es para entender el precio: vos declarás las ${numTexto(piezas)} piezas,` +
    ` no ${unidadesTexto}.)`
  );
}

/** Las líneas de un producto dentro de la lista de medidas. `unidad` y `geo` vienen del
 *  material; `tramos` solo para el ejemplo de la cadena. */
function itemProducto(p: Fila, unidad: string, geo: Geometria | null, tramos: Tramo[] = []): string[] {
  const partes = [`- ${p["Producto"] ?? "(sin nombre)"}`];

  // El formato manda sobre los cm: es el tamaño en las palabras del cliente ("A5"), y donde
  // existe es porque el producto NO se cotiza por superficie. Decir "14,8x21 cm" ahí sería
  // contestar en una unidad que el cliente no usó y sugerir un cálculo que no existe.
  const formato = p[COL_FORMATO];
  const a = p["Ancho (cm)"];
  const h = p["Alto (cm)"];
  if (formato) partes.push(formato);
  else if (a && h) partes.push(`${numTexto(Number(a))}x${numTexto(Number(h))} cm`);

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
 * La mitad que le faltaba a "se cotiza cualquier medida": de DÓNDE sale esa medida.
 *
 * Medido en vivo (ejecución 400, "100 stickers en OPP" sin medida): el bot cotizó 100
 * stickers de 5x5. No los eligió — de los 5 chunks que trajo el retrieval, 4 encabezan sus
 * "Medidas de referencia" con 5x5, y cada una viene con la cuenta ya hecha de ejemplo. Es
 * una plantilla de cotización servida y lista. El chunk le decía que PODÍA cotizar cualquier
 * medida y no le decía que la medida la tiene que haber dicho el cliente, así que el modelo
 * hizo lo razonable con lo que tenía: agarró la primera.
 *
 * Es la peor clase de falla del bot: la aritmética cierra (5x5 a $8.400 está bien calculado),
 * así que el auditor no puede verla. Solo está mal la premisa, y la premisa no vive en ningún
 * campo contra el cual comparar. El cliente recibe el precio de un trabajo que no pidió.
 */
const MEDIDA_LA_DA_EL_CLIENTE =
  "La medida la da SIEMPRE el cliente: si no la dijo, preguntala — no cotices con una de " +
  "las de referencia. Los ejemplos de abajo muestran cómo se hace la cuenta, no qué pidió.";

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
      MEDIDA_LA_DA_EL_CLIENTE,
      `Área útil del ${unidad || "pliego"}: ${numTexto(geo.utilAncho)}x${numTexto(geo.utilAlto)} cm · ${sep}.`,
    ];
  }
  if (modo === "m2") {
    // La fórmula está para que el bot ENTIENDA de dónde sale el precio, no para que la
    // aplique. Medido (ejecución 422, "una lona de 3x1"): declaró cantidad 3 —los m2— y el
    // auditor multiplicó otra vez por la superficie: 9 m2 por UNA lona, $198.000 en vez de
    // $66.000. El triple, y en verde: 9 × $22.000 cierra perfecto.
    //
    // Es el mismo error que en pliego (ejecución 412), y por la misma razón: mostrar la
    // cuenta invita a hacerla. Acá pesa más porque no hay techo — en pliego la división
    // achica el número (cobra de menos), en m2 la multiplicación lo agranda sin límite.
    return [
      "Se cotiza cualquier medida (m2 = ancho x alto en cm ÷ 10.000).",
      "La fórmula es para entender el precio, NO para aplicarla: la cantidad son las PIEZAS " +
        "que pidió el cliente (una lona de 3x1 es cantidad 1, no 3), y los m2 los calcula el " +
        "sistema a partir de la medida.",
      // El camino DIRECTO: si el cliente pide la cantidad en m² ("3 m² de vinilo"), no hay
      // pieza ni medida — la cantidad ES la unidad de cobro. Sin esta línea, el modelo no
      // sabe que puede declarar sin ancho/alto y repregunta o inventa una medida.
      "Si el cliente pide directo en m² ('3 m² de vinilo'), la cantidad ES 3 y no mandes " +
        "medida: el sistema la toma como los m2 de superficie.",
      MEDIDA_LA_DA_EL_CLIENTE,
    ];
  }
  // Unidad de cobro que es una MEDIDA, no una cosa contable. Sin esta línea el modelo lee
  // "Precio por metro lineal" como cuánto sale un metro —cierto— y declara `cantidad: 1`
  // porque para él 2,45 metros de planos es UN trabajo. El bot cobró $8.000 en vez de
  // $19.600 y el auditor no pudo verlo: 1 × $8.000 cierra solo.
  if (modo === "item" && esMedidaContinua(unidad)) {
    // La frase NO usa pluralUnidad: solo pluraliza la primera palabra y "metro lineal"
    // salía como "metros lineal". Es el mismo bug que las "2 a 100 unidads" — texto roto
    // que pasa los tests en verde y solo se ve leyendo el chunk.
    const u = unidad.trim();
    return [
      `Se cobra por ${u.toUpperCase()}: la cantidad se declara en ${u} (no en piezas), ` +
        `y admite decimales — 2,45 ${u} se declara como 2,45.`,
    ];
  }
  // Un recargo por trabajo (corte a medida): un monto único que NO depende de la cantidad.
  // Sin esta línea el modelo leería "Precio por modelo de corte" y multiplicaría la
  // cantidad pedida por el precio, que es exactamente lo que el modo fijo viene a evitar.
  if (modo === "fijo") {
    return [
      "Precio FIJO por trabajo: no depende de la cantidad de piezas. Declará la cantidad " +
        "como la pida el cliente (1 modelo, 3 modelos) — el sistema cobra el monto único.",
    ];
  }
  // Los talonarios de rifas se cobran por talonario (100 números cada uno) y la escala
  // está en talonarios, pero el cliente habla de "números de rifa". Sin la guía, el
  // modelo declararía 200 por "200 números" y el tramo saltaría al de 100+ talonarios
  // (100 veces más caro). Misma lección que el metro lineal: la unidad en la que declara
  // la cantidad es un DATO del catálogo, no algo que el prompt despeje turno a turno.
  if (modo === "item" && /^talonario\b/.test(unidad.trim().toLowerCase())) {
    return [
      "Se cobra por TALONARIO (100 números): la cantidad se declara en talonarios, no en " +
        "números de rifa. '2 talonarios' se declara como 2.",
    ];
  }
  return [];
}

/** Descripción de una colección por nombre. */
const descripcionDe = (datos: Datos, coleccion: string): string =>
  datos.colecciones.find((c) => c["Colección"] === coleccion)?.["Descripción"] ?? "";

/** Material base de una colección (columna del Excel); "" si no está marcada. */
const baseDe = (datos: Datos, coleccion: string): string =>
  datos.colecciones.find((c) => c["Colección"] === coleccion)?.[COL_BASE] ?? "";

/**
 * ¿Esta línea de precio está exenta del mínimo por trabajo? (ver COL_SIN_MINIMO)
 *
 * Se puede marcar en el MATERIAL o en la COLECCIÓN, y alcanza con una. Hace falta el nivel
 * de material porque casi todas las colecciones mezclan: "Papelería comercial" tiene sobres
 * a $250 la unidad (que sin exención cotizarían $4.000) junto a talonarios de $54.000 (que
 * sí tienen que llevar piso). Marcar la colección entera le sacaría el mínimo a los dos.
 * La marca de colección queda como atajo para cuando TODA la colección es del mismo tipo.
 */
const sinMinimoDe = (datos: Datos, coleccion: string, material?: string): boolean => {
  if (material && esSi(datos.materiales.find((m) => m["Material"] === material)?.[COL_SIN_MINIMO])) {
    return true;
  }
  return esSi(datos.colecciones.find((c) => c["Colección"] === coleccion)?.[COL_SIN_MINIMO]);
};

/**
 * Cuántas piezas trae el paquete de este material, o null si no se vende en paquete
 * (ver COL_PAQUETE).
 *
 * La columna manda; si está vacía se deriva de la Unidad, que ya lleva el número en todos
 * los casos del catálogo ("paquete de 500 volantes", "paquete de 10 talonarios"). Derivarla
 * evita el error silencioso de cargar 500 en la unidad y 100 en la columna.
 *
 * Solo cuenta el número si la unidad nombra un CONJUNTO. "hoja", "unidad" y "m2" no son
 * paquetes por más que aparezca un número al lado, y tratarlos como tales dividiría un
 * precio unitario por la nada.
 */
export function paqueteDe(materiales: Fila[], material: string): number | null {
  const fila = materiales.find((m) => m["Material"] === material);
  if (!fila) return null;

  const cargado = num(fila[COL_PAQUETE]);
  if (cargado && cargado > 1) return cargado;

  const u = String(fila["Unidad"] ?? "").trim().toLowerCase();
  // "pack" a secas queda AFUERA a propósito: sin un número de piezas al lado no se sabe si
  // es un empaque o un producto que se llama pack y se pide de a uno (ver COL_PAQUETE).
  if (!/^(paquete|caja|resma|juego|blister|set)\b/.test(u)) return null;
  // "paquete de 1000 tarjetas": el primer número que aparezca después del sustantivo.
  const m = u.match(/(\d[\d.,]*)/);
  const n = m ? num(m[1]) : null;
  return n && n > 1 ? n : null;
}

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
    ...(t.total && { precio_total: true }),
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

/** La familia de un material, o su propio nombre si no tiene (ver COL_FAMILIA). */
const familiaDe = (datos: Datos, material: string): string =>
  datos.materiales.find((m) => m["Material"] === material)?.[COL_FAMILIA] || material;

/**
 * Los materiales de una colección agrupados por familia: `[nombre del grupo, materiales]`.
 * Sin familias declaradas es uno por material — el comportamiento de siempre.
 */
function gruposDe(datos: Datos, mats: string[]): [string, string[]][] {
  const grupos = new Map<string, string[]>();
  for (const m of mats) {
    const fam = familiaDe(datos, m);
    if (!grupos.has(fam)) grupos.set(fam, []);
    grupos.get(fam)!.push(m);
  }
  return [...grupos];
}

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

    const grupos = gruposDe(datos, mats);

    for (const [familia, delGrupo] of grupos) {
      // El primer material del grupo define unidad, modo y geometría: los de una familia
      // comparten todo salvo el precio y la presentación (100 / 500 / 1000 tarjetas).
      const mat = delGrupo[0];
      const agrupado = delGrupo.length > 1;
      const suyos = items.filter((p) => delGrupo.includes(p["Material"] ?? ""));
      const tramos = escalaDe(datos.materiales, mat);
      // Con un solo grupo, su nombre no agrega nada al título de la colección.
      const titulo = grupos.length > 1 ? `${col} — ${familia}` : col;

      const unidad = unidadDe(datos.materiales, mat);
      const modo = modoDe(unidad);
      const geo = geometriaDe(datos.materiales, mat);
      // Solo hay base donde hay algo que elegir: con un grupo único la línea sería
      // ruido (y "el material base" no significa nada si no hay alternativa).
      const varios = grupos.length > 1;
      const esBase = varios && delGrupo.includes(base);
      const otros = grupos.map(([f]) => f).filter((f) => f !== familia);

      const L: string[] = [titulo];
      if (desc) L.push(desc);
      // Los dos ejes por SEPARADO. El título los junta con un guion y el bot no tiene
      // cómo saber dónde termina uno y empieza el otro: sin esta línea, "la colección"
      // de las de abajo se queda sin referente claro.
      if (varios) L.push(`Colección: ${col}. Material: ${familia}.`);
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
      // "Medidas de referencia" significa "estas son ejemplos, pedí la que quieras", y eso
      // solo es cierto donde el precio sale de la superficie. Un recetario A5 se vende A5:
      // ahí la lista son los productos, no medidas entre las que elegir. Un recargo fijo
      // tampoco tiene medida: es el trabajo.
      L.push("", modo === "item" || modo === "fijo" ? "Productos:" : "Medidas de referencia:");
      for (const p of suyos) {
        const suMat = p["Material"] ?? mat;
        L.push(...itemProducto(p, unidadDe(datos.materiales, suMat), geo, escalaDe(datos.materiales, suMat)));
      }
      // Un renglón de precio por material del grupo: las presentaciones tienen precio
      // CERRADO (500 tarjetas no son cinco veces 100), así que se listan, no se interpolan.
      const precios = delGrupo
        .map((m) => lineaPrecio(m, escalaDe(datos.materiales, m)))
        .filter(Boolean);
      if (precios.length) L.push("", ...precios);
      if (agrupado) {
        L.push(
          `Son presentaciones distintas del mismo producto: cada una tiene su precio cerrado ` +
            `y no se calcula proporcionalmente. Si el cliente pide una cantidad que no está ` +
            `en la lista, confirmala por mail.`,
        );
      }

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
          sin_minimo: sinMinimoDe(datos, col, mat),
          // Piezas por paquete: el cliente pide en piezas y esto se cobra por paquete.
          // Sin esto el auditor multiplica las dos cosas (ver COL_PAQUETE).
          ...(paqueteDe(datos.materiales, mat) && {
            paquete: paqueteDe(datos.materiales, mat),
          }),
          // El auditor del workflow re-calcula con esto; sin escala en la metadata
          // tendría que parsear la prosa del chunk.
          escala: escalaMeta(tramos),
          // Un chunk agrupado tiene VARIOS materiales cotizables. El auditor indexa por
          // nombre de material, así que se los lleva todos con su escala y su unidad: si
          // no, el bot vería "500 tarjetas" en el texto y el auditor no sabría calcularlo.
          ...(agrupado && {
            familia,
            variantes: delGrupo.map((m) => ({
              material: m,
              unidad: unidadDe(datos.materiales, m),
              modo: modoDe(unidadDe(datos.materiales, m)),
              sin_minimo: sinMinimoDe(datos, col, m),
              escala: escalaMeta(escalaDe(datos.materiales, m)),
              ...(paqueteDe(datos.materiales, m) && {
                paquete: paqueteDe(datos.materiales, m),
              }),
            })),
          }),
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

  // Material base: solo importa donde el cliente puede pedir EL MISMO producto en
  // materiales distintos ("stickers 5x5" en papel o en OPP). Ahí, sin base marcada, el bot
  // no sabe cuál cotizar por default y elige el que le quede a mano.
  //
  // NO importa donde cada material es un producto propio: en "Encuadernación y
  // terminaciones" hay 10 grupos, pero un anillado no es una alternativa de un laminado y
  // no hay nada que elegir. Avisar ahí sería ruido en cada carga.
  //
  // La señal de que hay elección: dos productos de la colección con MEDIDA igual y
  // material distinto. Es lo que hace del material base una decisión y no un dato.
  for (const col of nombresColeccion(datos)) {
    const items = productosDe(datos, col);
    const mats = materialesDe(items);
    if (mats.length < 2) continue;
    const porMedida = new Map<string, Set<string>>();
    for (const p of items) {
      const a = p["Ancho (cm)"];
      const h = p["Alto (cm)"];
      if (!a || !h) continue;
      const k = `${a}x${h}`;
      if (!porMedida.has(k)) porMedida.set(k, new Set());
      porMedida.get(k)!.add(p["Material"] ?? "");
    }
    const hayEleccion = [...porMedida.values()].some((s) => s.size > 1);
    if (!hayEleccion) continue;
    const base = baseDe(datos, col);
    if (!base) {
      out.push(
        `${col}: el cliente puede pedir la misma medida en ${mats.length} materiales y no ` +
          `hay "${COL_BASE}" marcado. Elegí cuál se cotiza cuando no pide una opción especial.`,
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
    const a = num(p["Ancho (cm)"]);
    const h = num(p["Alto (cm)"]);
    const calculado = geo && a !== null && h !== null ? rinde(a, h, geo) : null;

    if (calculado === null) {
      // Sin geometría no hay de dónde calcular el rinde: el chunk sale con precio pero
      // sin cuántas piezas entran, y el bot no puede dividir (inventaría el número).
      out.push(
        `${nombre}: sin rinde — el material "${mat}" no tiene geometría (área útil + separación). ` +
          `El bot no va a poder cotizarlo.`,
      );
    } else if (calculado === 0) {
      out.push(
        `${nombre} (${a}x${h} cm): no entra en el área útil de "${mat}" en ninguna orientación. ` +
          `La referencia sale sin rinde; el bot debe derivar a consulta.`,
      );
    }
  }

  // Líneas de precio que el mínimo por trabajo se come enteras y no están exentas. El caso
  // son las terminaciones (laminado $330, ojalillos $1.000) y la impresión por hoja ($100):
  // el mínimo multiplica el precio por 12 o por 40. Es un error caro y silencioso — el total
  // "se ve" bien, solo está mal.
  //
  // Se mira MATERIAL por material, no colección: casi todas mezclan. "Papelería comercial"
  // tiene sobres a $250 junto a talonarios de $54.000, y avisar (o eximir) por colección
  // entera trataría igual a los dos.
  //
  // El mínimo aplica al TOTAL, así que no alcanza con mirar el tramo: con unidad geométrica
  // (pliego) o continua (m2) la cantidad hace crecer el total y el mínimo solo afecta al
  // pedido más chico, que es lo que se quiere. Solo avisa donde una unidad de cobro es UN
  // ÍTEM y ni el tramo más caro llega al mínimo.
  const minimoTrabajo = num(
    datos.parametros.find((p) => p["Parámetro"] === "Mínimo por trabajo")?.["Valor"],
  );
  if (minimoTrabajo !== null && minimoTrabajo > 0) {
    for (const col of nombresColeccion(datos)) {
      for (const mat of materialesDe(productosDe(datos, col))) {
        if (sinMinimoDe(datos, col, mat)) continue;
        if (modoDe(unidadDe(datos.materiales, mat)) !== "item") continue;
        const tramos = escalaDe(datos.materiales, mat);
        if (!tramos.length) continue;
        const tope = Math.max(...tramos.map((t) => t.precio));
        if (tope >= minimoTrabajo) continue;
        out.push(
          `${col} — ${mat}: el precio más alto (${money(tope)}) no llega al mínimo por trabajo ` +
            `(${money(minimoTrabajo)}), así que un pedido de 1 se va a cotizar ${money(minimoTrabajo)}. ` +
            `Si se cobra de a uno como agregado (laminado, ojalillos, una hoja suelta), marcá ` +
            `"${COL_SIN_MINIMO}" = sí en su fila de Materiales.`,
        );
      }
    }
  }

  // Unidad cuyo sustantivo no está en la tabla de plurales: el chunk sale con el tramo sin
  // pluralizar ("2 a 10 bobinota"), que se lee mal en el texto que ve el cliente. No es
  // grave —el número está bien— pero es invisible si nadie mira el chunk, y así fue como
  // "unidads" llegó al catálogo cargado.
  {
    const sinPlural = new Set<string>();
    for (const m of datos.materiales) {
      const u = String(m["Unidad"] ?? "").trim();
      if (!u) continue;
      // Se mira la UNIDAD ENTERA, no la primera palabra: en "m2" el sustantivo capturado
      // es "m", que no está en la tabla ni tiene por qué estarlo — "m2" es un símbolo y se
      // escribe igual en singular y en plural. Avisar por la letra suelta convertía un
      // caso correcto en un aviso permanente. (Me pasó al escribir este mismo guard.)
      if (!/^\p{L}+(\s|$)/u.test(u)) continue;
      const sustantivo = u.match(/^(\p{L}+)/u)![1];
      if (PLURALES[sustantivo.toLowerCase()]) continue;
      sinPlural.add(sustantivo.toLowerCase());
    }
    for (const s of sinPlural) {
      out.push(
        `La unidad que empieza con "${s}" no tiene plural cargado: los tramos van a decir ` +
          `"2 a 10 ${s}" en vez de pluralizarlo. Agregalo a PLURALES en visor/lib/chunk.ts.`,
      );
    }
  }

  return out;
}
