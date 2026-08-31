// LOS DATOS de los pendientes que Martin confirmó el 2026-08-31, separados del escritor
// para poder revisarlos sin leer código.
//
// De los 11 pendientes entran 6. Quedan afuera, esperando a TG:
//   · Gigantografías   — no se sabe si es la misma Lona o algo distinto
//   · Marco / photocall — $34.000 acá vs $30.000 del corrugado que ya tenemos
//   · Imanes            — la unidad no está confirmada y falta la medida
//
// Lo que entra y con qué criterio, uno por uno:

// ── 1. Los dos de m² donde el cliente puso dos números ───────────────────────────────
// Confirmado por Martin: el precio por m² es el GRANDE. El chico de la columna PRECIO era
// el mínimo de medio m², que en el catálogo va en su propia columna.
export const MATERIALES = [
  {
    material: "Vinilo microperforado",
    unidad: "m2",
    tramos: [[1, null, 18000]],
    minimoFacturable: "0,5",
  },
  {
    material: "PVC espumado 3 mm con vinilo",
    unidad: "m2",
    tramos: [[1, null, 46000]],
    minimoFacturable: "0,5",
  },

  // ── 2. Planos, solo el lineal ──────────────────────────────────────────────────────
  // El cliente listaba tres precios; entra UNO. Los otros dos (50% de cobertura, vegetal)
  // NO se cargan a propósito: el porcentaje de cobertura lo tiene que ver un empleado
  // mirando el diseño, así que eso deriva a mail. Cargar un precio ahí haría que el bot
  // cotice algo que nadie puede calcular sin ver el archivo.
  {
    material: "Impresión de planos lineal",
    unidad: "m2",
    tramos: [[1, null, 7000]],
    minimoFacturable: "0,5",
  },

  // ── 3. Escaneo: metro LINEAL, no m² ────────────────────────────────────────────────
  // Confirmado: son planos A3 y se cobra por metro escaneado — 3 metros = $24.000. Es
  // cantidad × precio, no ancho × alto, así que va como `item` (ver modoDe en parse.ts).
  // El A3 es el tamaño del original, no un dato de cotización: va en Formato.
  {
    material: "Escaneo de planos",
    unidad: "metro lineal",
    tramos: [[1, null, 8000]],
  },

  // ── 4. Plancha A4: un precio que sale de sumar dos ─────────────────────────────────
  // $900 del autoadhesivo A4 + $1.000 del medio corte = $1.900. Mismo caso que los
  // apuntes: se crea UN material que es la combinación, porque el precio de la plancha no
  // se deriva de ninguno de los dos por separado.
  //
  // La escala baja porque lo que baja es el MEDIO CORTE, no el papel:
  //   1 plancha    → 900 + 1000 = 1900
  //   2 a 100      → 900 +  500 = 1400
  //   101 en más   → 900 +  100 = 1000
  {
    material: "Plancha A4 de stickers",
    unidad: "unidad",
    tramos: [[1, 1, 1900], [2, 100, 1400], [101, null, 1000]],
  },

  // ── 5. Las dos lonas con estructura ────────────────────────────────────────────────
  // Precio CERRADO, medida fija: no se calculan por m². La nota del cliente lo dice
  // explícito ("el precio ya incluye la estructura; la lona sola se cotiza por m2"), así
  // que van como material propio y no como una medida más de Lona.
  { material: "Lona 1,9x0,9 m con porta banner 2 velas", unidad: "unidad", tramos: [[1, null, 61360]] },
  { material: "Lona 2x0,85 m con porta banner roll up", unidad: "unidad", tramos: [[1, null, 65200]] },
];

// ── Los productos que ve el bot ──────────────────────────────────────────────────────
// Las descripciones salen de las del cliente, recortadas y pasadas a su voz. Los sinónimos
// son los que él mismo cargó en su columna "Sinónimos (cómo lo pide el cliente)".
export const PRODUCTOS = [
  {
    coleccion: "Carteles y vidrieras",
    producto: "Vinilo microperforado para vidriera 1x1 m",
    material: "Vinilo microperforado",
    ancho: "100",
    alto: "100",
    descripcion:
      "Vinilo microperforado para vidrieras: desde adentro se ve hacia afuera, desde afuera se ve la impresión. Se cotiza por metro cuadrado, mínimo medio m2.",
    sinonimos: "microperforado, vinilo para vidriera, vinilo que se ve de adentro",
  },
  {
    coleccion: "Carteles y vidrieras",
    producto: "Cartel en PVC espumado 3 mm 50x70 cm",
    material: "PVC espumado 3 mm con vinilo",
    ancho: "50",
    alto: "70",
    descripcion:
      "Cartel en PVC espumado de 3 mm con vinilo brillo o mate. Más firme y durable que el plástico corrugado, que es la alternativa más económica. Se cotiza por metro cuadrado, mínimo medio m2.",
    sinonimos: "pvc, pvc espumado, cartel rigido, sintra, letrero",
  },
  {
    coleccion: "Gran formato y cartelería",
    producto: "Impresión de planos A1",
    material: "Impresión de planos lineal",
    // Un A1 es 59,4 x 84,1 cm ≈ 0,5 m2: justo el mínimo, y es la medida de referencia que
    // usa el propio cliente para explicar el precio.
    ancho: "59.4",
    alto: "84.1",
    descripcion:
      "Impresión de planos en papel obra 90 g, línea sobre fondo blanco. Se cotiza por metro cuadrado, mínimo medio m2. Si el plano lleva zonas con color o relleno, escribinos: el recargo depende de cuánta superficie cubre y lo tiene que ver alguien del taller.",
    sinonimos: "planos, planos de obra, autocad, plotteo, ploteo de planos, plotter",
  },
  {
    coleccion: "Diseño y servicios",
    producto: "Escaneo de planos",
    material: "Escaneo de planos",
    formato: "A3",
    descripcion:
      "Escaneo y digitalización de planos en gran formato. Se cobra por metro lineal escaneado: 3 metros son $24.000. También escaneamos A3.",
    sinonimos: "escanear, escaneo, digitalizar, escaneo de planos, pasar a digital",
  },
  {
    coleccion: "Stickers con forma",
    producto: "Plancha A4 de stickers",
    material: "Plancha A4 de stickers",
    formato: "A4",
    descripcion:
      "Hoja A4 de stickers en papel autoadhesivo, con medio corte para despegarlos de a uno. Incluye la impresión y el corte. El precio baja bastante desde 2 planchas.",
    sinonimos: "plancha de stickers, hoja de stickers, stickers en plancha, calcos en hoja",
  },
  {
    coleccion: "Gran formato y cartelería",
    producto: "Lona 1,9x0,9 m con porta banner 2 velas",
    material: "Lona 1,9x0,9 m con porta banner 2 velas",
    formato: "1,9 x 0,9 m",
    descripcion:
      "La lona impresa full color con bolsillos, más la estructura tipo araña de 2 velas. Se arma y se guarda en minutos. El precio incluye las dos cosas.",
    sinonimos: "banner completo, kit de banner, lona con estructura, araña con lona, banner armado",
  },
  {
    coleccion: "Gran formato y cartelería",
    producto: "Lona 2x0,85 m con porta banner roll up",
    material: "Lona 2x0,85 m con porta banner roll up",
    formato: "2 x 0,85 m",
    descripcion:
      "La lona impresa full color más el roll up con estuche: la lona se enrolla dentro de la base. No lleva bolsillos. El precio incluye las dos cosas.",
    sinonimos: "roll up, rollup con lona, banner enrollable, banner completo, kit de banner",
  },
];

// ── Casos de prueba ──────────────────────────────────────────────────────────────────
// El gate del builder los corre contra el motor antes de emitir el flow. Mezclan las
// medidas de referencia con otras nuevas, para que no midan solo lo que ya sabemos.
//
// Los totales están calculados a mano con la tarifa y el redondeo del Excel (múltiplo de
// $100 más cercano, mínimo por trabajo $4.000).
export const CASOS = [
  // m² con mínimo facturable: 1x1 m = 1 m2 exacto.
  { pedido: "1 vinilo microperforado de 1x1 m", material: "Vinilo microperforado", ancho: "100", alto: "100", cantidad: "1", total: "18000" },
  // Por debajo del mínimo: 50x50 = 0,25 m2 → se cobran 0,5.
  { pedido: "1 vinilo microperforado de 50x50 cm", material: "Vinilo microperforado", ancho: "50", alto: "50", cantidad: "1", total: "9000" },

  // PVC: 50x70 = 0,35 m2 → mínimo 0,5 → 0,5 x 46.000 = 23.000.
  { pedido: "1 cartel de PVC espumado 50x70 cm", material: "PVC espumado 3 mm con vinilo", ancho: "50", alto: "70", cantidad: "1", total: "23000" },
  // Medida nueva, por encima del mínimo: 1x1,5 m = 1,5 m2 x 46.000 = 69.000.
  { pedido: "1 cartel de PVC espumado de 100x150 cm", material: "PVC espumado 3 mm con vinilo", ancho: "100", alto: "150", cantidad: "1", total: "69000" },

  // Planos A1: 59,4 x 84,1 = 0,4995 m2 → por debajo del mínimo → 0,5 x 7.000 = 3.500,
  // pero el MÍNIMO POR TRABAJO ($4.000) lo levanta.
  { pedido: "1 plano A1", material: "Impresión de planos lineal", ancho: "59.4", alto: "84.1", cantidad: "1", total: "4000" },
  // Cuatro planos A1: 4 x 0,4995 = 1,998 m2 x 7.000 = 13.986 → redondea a 14.000.
  { pedido: "4 planos A1", material: "Impresión de planos lineal", ancho: "59.4", alto: "84.1", cantidad: "4", total: "14000" },

  // Escaneo por metro lineal: el caso que dio Martin.
  { pedido: "escaneo de 3 metros de planos", material: "Escaneo de planos", cantidad: "3", total: "24000" },
  // Un metro solo: $8.000, por encima del mínimo por trabajo.
  { pedido: "escaneo de 1 metro de planos", material: "Escaneo de planos", cantidad: "1", total: "8000" },

  // Plancha A4: una sola cae en el primer tramo, pero el mínimo por trabajo la levanta a
  // $4.000. Es correcto: una plancha suelta es un trabajo entero.
  { pedido: "1 plancha A4 de stickers", material: "Plancha A4 de stickers", cantidad: "1", total: "4000" },
  // 10 planchas: tramo 2-100 → 10 x 1.400 = 14.000.
  { pedido: "10 planchas A4 de stickers", material: "Plancha A4 de stickers", cantidad: "10", total: "14000" },
  // 150 planchas: tramo 101+ → 150 x 1.000 = 150.000.
  { pedido: "150 planchas A4 de stickers", material: "Plancha A4 de stickers", cantidad: "150", total: "150000" },

  // Las lonas con estructura: precio cerrado, sin medida.
  { pedido: "1 lona 1,9x0,9 con porta banner 2 velas", material: "Lona 1,9x0,9 m con porta banner 2 velas", cantidad: "1", total: "61400" },
  { pedido: "1 lona 2x0,85 con roll up", material: "Lona 2x0,85 m con porta banner roll up", cantidad: "1", total: "65200" },
  // Dos combos: 2 x 65.200 = 130.400.
  { pedido: "2 lonas 2x0,85 con roll up", material: "Lona 2x0,85 m con porta banner roll up", cantidad: "2", total: "130400" },
];
