// Los DATOS del lote de limpieza del catálogo v4 — separados del escritor
// (cargar-catalogo-v4.mjs) para que se puedan revisar leyendo esta tabla, sin leer código.
// Plan completo: plans/limpieza-catalogo-v4.md.
//
// Números de fila: los del catálogo del cliente TAL COMO LLEGÓ (Catalogo-TG.xlsx), que
// sobreviven intactos en Catalogo-TG-v4-wip.xlsx después de normalizar-inline.mjs,
// portar-hojas.mjs y extender-listas.mjs (ninguno de esos 3 pasos reordena filas de
// Materiales/Productos/Colecciones). Verificados contra el volcado antes de escribir esto.

// ── §5: unidades → renombrar a una que el motor ya entiende (arreglo en el DATO) ──────

export const RENOMBRES_MATERIAL = [
  {
    hoja: "Materiales",
    fila: 95,
    motivo: 'Puntillado: "pasada" es un ítem contable ($50 × N pasadas). El matiz ya está en la',
    cambios: { B: "unidad" }, // era "pasada"
  },
  {
    hoja: "Materiales",
    fila: 250,
    motivo:
      'Corte x millar: el cliente pide "cortame 5000 volantes", no "5 millares" — el schema ' +
      "declara sin convertir. Con paquete de 1000 el auditor divide 5000/1000=5 y cotiza bien; " +
      '"millar" a secas cae en modo otro y aborta el build.',
    cambios: { A: "Corte x1000", B: "paquete de 1000 hojas" }, // era "Corte x millar" / "millar"
  },
];

// ── §6: apartar a Pendientes (fuera del lote, decisión ya tomada) ─────────────────────
//
// Ninguno tiene mecanismo hoy: Corte a medida es un recargo (no existe la suma de
// componentes en cotizar()) y Troquelado/Talonarios cargan un precio TOTAL por tramo (no
// hay modo de cobro que lo exprese). Se registran en Pendientes con el dato intacto y se
// borran de Materiales/Productos para que no entren rotos en silencio.

export const A_PENDIENTES = [
  {
    Producto: "Corte a medida",
    Descripción: "Recargo fijo por modelo/diseño de corte recto a medida, no depende de la cantidad de piezas.",
    "Cómo se cobra": "$5.000 fijo por modelo (unidad original: \"modelo de corte\")",
    Notas:
      "Omitido del lote de limpieza v4 (sept-2026): no hay mecanismo de recargos en el motor " +
      "(cotizar() devuelve un total escalar por material, no componentes sumables). Confirmar con " +
      "TG si es un recargo POR TRABAJO (una vez, sin importar las piezas) antes de diseñarlo.",
  },
  {
    Producto: "Troquelado (corte con forma en papel)",
    Descripción: "Corte con forma sobre un impreso ya listo.",
    "Cómo se cobra":
      "1-10 piezas: $10.000 TOTAL fijo (no por pieza). 11-50: $1.000/pieza. 51-100: $800/pieza. " +
      "101-500: $600/pieza.",
    Notas:
      'Omitido del lote v4: el primer tramo es "precio total del tramo", una forma de cobro que ' +
      "el motor no tiene (cotizar() multiplicaría 5 × $10.000 = $50.000 en vez de $10.000, en " +
      "silencio). Reemplaza a \"Troquelado y corte a medida\" ($50/unidad, sin mínimo), que existía " +
      "en producción — el bot pierde esa cotización hasta que se resuelva el modo nuevo.",
  },
  {
    Producto: "Talonario de rifas 100 números 10x7 cm",
    Descripción: "Talonarios de rifas numeradas correlativamente, 100 números por talonario, 10x7 cm.",
    "Cómo se cobra":
      "Escala en NÚMEROS DE RIFA (no en talonarios), precio TOTAL por tramo: 100-249→$7.200 · " +
      "250-499→$9.600 · 500-999→$12.000 · 1.000-4.999→$18.000 · 5.000-9.999→$50.400 · 10.000+→$64.800.",
    Notas: "Mismo motivo que Troquelado: precio total del tramo, sin modo de cobro que lo exprese.",
  },
  {
    Producto: "Talonario de rifas 100 números 15x7 cm",
    Descripción: "Talonarios de rifas numeradas correlativamente, 100 números por talonario, 15x7 cm.",
    "Cómo se cobra":
      "Escala en NÚMEROS DE RIFA, precio TOTAL por tramo: 100-249→$10.800 · 250-499→$13.200 · " +
      "500-999→$20.400 · 1.000-4.999→$31.200 · 5.000-9.999→$57.600 · 10.000+→$68.400.",
    Notas: "Mismo motivo que Troquelado: precio total del tramo, sin modo de cobro que lo exprese.",
  },
  {
    Producto: "Corte a medida en Obra 80 gr / Ilustracion brillo 150 gr / mate 240 gr / mate 300 gr / Opalina 240 gr",
    Descripción: "5 productos (Productos filas 102-106): apuntan al material del PAPEL, no al recargo.",
    "Cómo se cobra":
      "Si se dejaran, el bot cotizaría solo el papel y se comería los $5.000 de recargo en " +
      "silencio — peor que no tenerlos.",
    Notas: "Se borran junto con el material Corte a medida.",
  },
];

// Filas de MATERIALES a borrar (por número de fila, para no ambigüedad con nombres repetidos
// en tramos). El de Troquelado son 4 filas (156-159, un tramo cada una).
export const MATERIALES_A_BORRAR = [155, 156, 157, 158, 159, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298];

// Filas de PRODUCTOS a borrar: los 5 "Corte a medida en X" (102-106) + los 3 productos que
// apuntan DIRECTO a Troquelado/Talonarios (101, 164, 165) — el validador los cazó como
// "material no existe" tras apartar esos materiales a Pendientes. "Corte por millar" (154)
// NO va acá: sigue existiendo, se REAPUNTA al material renombrado (ver PRODUCTOS_A_REAPUNTAR).
export const PRODUCTOS_A_BORRAR = [101, 102, 103, 104, 105, 106, 164, 165];

// ── §7: presentaciones leídas como tramos → materiales separados con Familia ──────────
//
// El cliente cargó estas como filas del MISMO material con Desde=1/Hasta vacío — el motor
// las lee como tramos de una escala y colisiona (gana la primera). Son presentaciones
// distintas: se reemplazan por materiales separados agrupados por Familia, el patrón que
// ya usa el catálogo con las tarjetas (Tarjetas 9x5 simple faz x100/x500/x1000).
//
// Cada entrada REEMPLAZA un bloque de filas viejas (ver PRESENTACIONES_A_BORRAR) por N
// materiales nuevos con Desde=1/Hasta vacío (tramo único, sin escala real).

export const PRESENTACIONES_A_BORRAR = [246, 247, 248, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262];

export const PRESENTACIONES_NUEVAS = [
  // Puntas redondeadas: filas 246-248 → 3 materiales.
  { A: "Puntas redondeadas x100", B: "paquete de 100 puntas", E: 3000, K: "sí", L: "Puntas redondeadas" },
  { A: "Puntas redondeadas x500", B: "paquete de 500 puntas", E: 5000, K: "sí", L: "Puntas redondeadas" },
  { A: "Puntas redondeadas x1000", B: "paquete de 1000 puntas", E: 7000, K: "sí", L: "Puntas redondeadas" },

  // Folletos 10x15 obra b/n: filas 251-254 → 4 materiales, Familia propia (antes las 12
  // folletos compartían una sola Familia "Folletos 10x15 cm" que mezclaba 3 papeles).
  { A: "Folletos 10x15 obra b/n x500", B: "paquete de 500 folletos", E: 12000, K: "sí", L: "Folletos 10x15 obra b/n" },
  { A: "Folletos 10x15 obra b/n x1000", B: "paquete de 1000 folletos", E: 20000, K: "sí", L: "Folletos 10x15 obra b/n" },
  { A: "Folletos 10x15 obra b/n x2000", B: "paquete de 2000 folletos", E: 34000, K: "sí", L: "Folletos 10x15 obra b/n" },
  { A: "Folletos 10x15 obra b/n x3000", B: "paquete de 3000 folletos", E: 49000, K: "sí", L: "Folletos 10x15 obra b/n" },

  // Folletos 10x15 obra color inkjet: filas 255-258 → 4 materiales.
  { A: "Folletos 10x15 obra color x500", B: "paquete de 500 folletos", E: 19000, K: "sí", L: "Folletos 10x15 obra color" },
  { A: "Folletos 10x15 obra color x1000", B: "paquete de 1000 folletos", E: 27000, K: "sí", L: "Folletos 10x15 obra color" },
  { A: "Folletos 10x15 obra color x2000", B: "paquete de 2000 folletos", E: 40000, K: "sí", L: "Folletos 10x15 obra color" },
  { A: "Folletos 10x15 obra color x3000", B: "paquete de 3000 folletos", E: 59000, K: "sí", L: "Folletos 10x15 obra color" },

  // Folletos 10x15 ilustración brillo 150gr: filas 259-262 → 4 materiales.
  { A: "Folletos 10x15 ilustración brillo x500", B: "paquete de 500 folletos", E: 66000, K: "sí", L: "Folletos 10x15 ilustración brillo" },
  { A: "Folletos 10x15 ilustración brillo x1000", B: "paquete de 1000 folletos", E: 120000, K: "sí", L: "Folletos 10x15 ilustración brillo" },
  { A: "Folletos 10x15 ilustración brillo x2000", B: "paquete de 2000 folletos", E: 223000, K: "sí", L: "Folletos 10x15 ilustración brillo" },
  { A: "Folletos 10x15 ilustración brillo x3000", B: "paquete de 3000 folletos", E: 300000, K: "sí", L: "Folletos 10x15 ilustración brillo" },
];

// Los 4 productos de folletos (155,156,157) y el de Puntas redondeadas (152) apuntan a la
// presentación más chica de su familia — se actualiza el Material referenciado (columna D
// de Productos) al nombre nuevo con sufijo x<n>. Verificado contra el volcado: los 4 son
// los únicos productos que referencian estos materiales por su nombre viejo.
export const PRODUCTOS_A_REAPUNTAR = [
  { fila: 152, de: "Puntas redondeadas", a: "Puntas redondeadas x100" },
  { fila: 154, de: "Corte x millar", a: "Corte x1000" }, // sigue el renombre de RENOMBRES_MATERIAL
  { fila: 155, de: "Folletos 10x15 cm papel obra 75gr b/n", a: "Folletos 10x15 obra b/n x500" },
  { fila: 156, de: "Folletos 10x15 cm papel obra 75gr color inkjet", a: "Folletos 10x15 obra color x500" },
  { fila: 157, de: "Folletos 10x15 cm papel ilustración brillo 150gr", a: "Folletos 10x15 ilustración brillo x500" },
];

// gruposDe() en chunk.ts agrupa por Familia, PERO solo entre materiales que YA tienen un
// Producto propio (materialesDe() sale de la columna Material de Productos, nunca de
// Materiales directamente). Familia sin un producto por presentación no rescata nada — un
// material sin producto queda invisible para el bot pase lo que pase en Materiales.
// Verificado contra el código, no supuesto: el patrón real (tarjetas 9x5) tiene UN producto
// por cada x100/x500/x1000. Por eso las presentaciones que faltan y las 9 coberturas de
// plano necesitan su propio Producto, igual que 152/155/156/157 arriba.
export const PRODUCTOS_NUEVOS = [
  // Puntas redondeadas: falta x500 y x1000 (x100 ya lo cubre el producto 152 reapuntado).
  {
    A: "Encuadernación y terminaciones",
    B: "Puntas redondeadas x500",
    C: "Redondeo de puntas sobre un impreso ya listo. Paquete de 500.",
    D: "Puntas redondeadas x500",
    H: "puntas redondeadas, esquinas redondeadas",
  },
  {
    A: "Encuadernación y terminaciones",
    B: "Puntas redondeadas x1000",
    C: "Redondeo de puntas sobre un impreso ya listo. Paquete de 1000.",
    D: "Puntas redondeadas x1000",
    H: "puntas redondeadas, esquinas redondeadas",
  },

  // Folletos obra b/n: falta x1000/x2000/x3000 (x500 ya lo cubre el producto 155 reapuntado).
  {
    A: "Folletería y editorial",
    B: "1000 folletos 10x15 cm papel obra b/n",
    C: "Folletos 10x15 cm impresos en blanco y negro, papel obra 75 gr. El precio es por los 1000.",
    D: "Folletos 10x15 obra b/n x1000",
    H: "folletos, volantes, flyers, panfletos",
    I: "10x15 cm",
  },
  {
    A: "Folletería y editorial",
    B: "2000 folletos 10x15 cm papel obra b/n",
    C: "Folletos 10x15 cm impresos en blanco y negro, papel obra 75 gr. El precio es por los 2000.",
    D: "Folletos 10x15 obra b/n x2000",
    H: "folletos, volantes, flyers, panfletos",
    I: "10x15 cm",
  },
  {
    A: "Folletería y editorial",
    B: "3000 folletos 10x15 cm papel obra b/n",
    C: "Folletos 10x15 cm impresos en blanco y negro, papel obra 75 gr. El precio es por los 3000.",
    D: "Folletos 10x15 obra b/n x3000",
    H: "folletos, volantes, flyers, panfletos",
    I: "10x15 cm",
  },

  // Folletos obra color inkjet: falta x1000/x2000/x3000.
  {
    A: "Folletería y editorial",
    B: "1000 folletos 10x15 cm papel obra color inkjet",
    C: "Folletos 10x15 cm impresos a color (inkjet), papel obra 75 gr. El precio es por los 1000.",
    D: "Folletos 10x15 obra color x1000",
    H: "folletos, volantes, flyers, panfletos",
    I: "10x15 cm",
  },
  {
    A: "Folletería y editorial",
    B: "2000 folletos 10x15 cm papel obra color inkjet",
    C: "Folletos 10x15 cm impresos a color (inkjet), papel obra 75 gr. El precio es por los 2000.",
    D: "Folletos 10x15 obra color x2000",
    H: "folletos, volantes, flyers, panfletos",
    I: "10x15 cm",
  },
  {
    A: "Folletería y editorial",
    B: "3000 folletos 10x15 cm papel obra color inkjet",
    C: "Folletos 10x15 cm impresos a color (inkjet), papel obra 75 gr. El precio es por los 3000.",
    D: "Folletos 10x15 obra color x3000",
    H: "folletos, volantes, flyers, panfletos",
    I: "10x15 cm",
  },

  // Folletos ilustración brillo 150gr: falta x1000/x2000/x3000.
  {
    A: "Folletería y editorial",
    B: "1000 folletos 10x15 cm papel ilustración brillo 150gr",
    C: "Folletos 10x15 cm en papel ilustración brillo 150 gr, mejor calidad. El precio es por los 1000.",
    D: "Folletos 10x15 ilustración brillo x1000",
    H: "folletos, volantes, flyers, panfletos, papel ilustracion",
    I: "10x15 cm",
  },
  {
    A: "Folletería y editorial",
    B: "2000 folletos 10x15 cm papel ilustración brillo 150gr",
    C: "Folletos 10x15 cm en papel ilustración brillo 150 gr, mejor calidad. El precio es por los 2000.",
    D: "Folletos 10x15 ilustración brillo x2000",
    H: "folletos, volantes, flyers, panfletos, papel ilustracion",
    I: "10x15 cm",
  },
  {
    A: "Folletería y editorial",
    B: "3000 folletos 10x15 cm papel ilustración brillo 150gr",
    C: "Folletos 10x15 cm en papel ilustración brillo 150 gr, mejor calidad. El precio es por los 3000.",
    D: "Folletos 10x15 ilustración brillo x3000",
    H: "folletos, volantes, flyers, panfletos, papel ilustracion",
    I: "10x15 cm",
  },

  // Coberturas de plano: los productos 96/121 (Impresión de planos lineal / Plotter obra
  // 90gr) YA prometen "decinos cuál para cotizar" en su descripción. Faltan los productos
  // de las 3 coberturas para que el chunk las traiga agrupadas por Familia.
  {
    A: "Gran formato y cartelería",
    B: "Impresión de planos A1, 25% cobertura",
    C: "Impresión de planos en papel obra 90 g, por metro cuadrado, mínimo medio m2. Cobertura de color/relleno 25%.",
    D: "Impresión de planos 25% cobertura",
    E: 59.4,
    F: 84.1,
    H: "planos, planos de obra, autocad, plotteo, ploteo de planos, plotter",
  },
  {
    A: "Gran formato y cartelería",
    B: "Impresión de planos A1, 50% cobertura",
    C: "Impresión de planos en papel obra 90 g, por metro cuadrado, mínimo medio m2. Cobertura de color/relleno 50%.",
    D: "Impresión de planos 50% cobertura",
    E: 59.4,
    F: 84.1,
    H: "planos, planos de obra, autocad, plotteo, ploteo de planos, plotter",
  },
  {
    A: "Gran formato y cartelería",
    B: "Impresión de planos A1, 100% cobertura",
    C: "Impresión de planos en papel obra 90 g, por metro cuadrado, mínimo medio m2. Cobertura de color/relleno 100%.",
    D: "Impresión de planos 100% cobertura",
    E: 59.4,
    F: 84.1,
    H: "planos, planos de obra, autocad, plotteo, ploteo de planos, plotter",
  },
  {
    A: "Gran formato y cartelería",
    B: "Plotter papel vegetal, 25% cobertura",
    C: "Impresión de planos en papel vegetal (translúcido), por metro cuadrado, mínimo medio m2. Cobertura 25%.",
    D: "Plotter papel vegetal 25% cobertura",
    H: "plotter, plotteo, planos, vegetal, papel calco",
  },
  {
    A: "Gran formato y cartelería",
    B: "Plotter papel vegetal, 50% cobertura",
    C: "Impresión de planos en papel vegetal (translúcido), por metro cuadrado, mínimo medio m2. Cobertura 50%.",
    D: "Plotter papel vegetal 50% cobertura",
    H: "plotter, plotteo, planos, vegetal, papel calco",
  },
  {
    A: "Gran formato y cartelería",
    B: "Plotter papel vegetal, 100% cobertura",
    C: "Impresión de planos en papel vegetal (translúcido), por metro cuadrado, mínimo medio m2. Cobertura 100%.",
    D: "Plotter papel vegetal 100% cobertura",
    H: "plotter, plotteo, planos, vegetal, papel calco",
  },
  {
    A: "Gran formato y cartelería",
    B: "Plotter papel 130gr recubierto/encapado, 25% cobertura",
    C: "Impresión de planos en papel 130 gr recubierto/encapado, por metro cuadrado, mínimo medio m2. Cobertura 25%.",
    D: "Plotter papel 130gr recubierto/encapado 25% cobertura",
    H: "plotter, plotteo, planos, papel recubierto, papel encapado",
  },
  {
    A: "Gran formato y cartelería",
    B: "Plotter papel 130gr recubierto/encapado, 50% cobertura",
    C: "Impresión de planos en papel 130 gr recubierto/encapado, por metro cuadrado, mínimo medio m2. Cobertura 50%.",
    D: "Plotter papel 130gr recubierto/encapado 50% cobertura",
    H: "plotter, plotteo, planos, papel recubierto, papel encapado",
  },
  {
    A: "Gran formato y cartelería",
    B: "Plotter papel 130gr recubierto/encapado, 100% cobertura",
    C: "Impresión de planos en papel 130 gr recubierto/encapado, por metro cuadrado, mínimo medio m2. Cobertura 100%.",
    D: "Plotter papel 130gr recubierto/encapado 100% cobertura",
    H: "plotter, plotteo, planos, papel recubierto, papel encapado",
  },

  // Microperforado (solvente): el 94 solo cubre el UV. Mismo tamaño de referencia.
  {
    A: "Carteles y vidrieras",
    B: "Microperforado (solvente) para vidriera 1x1 m",
    C: "Microperforado solvente para vidrieras: desde adentro se ve hacia afuera, desde afuera se ve la impresión. Otro proceso de impresión que el UV (no fusionar sin confirmar con Pedro). Se cotiza por metro cuadrado, mínimo medio m2.",
    D: "Microperforado (solvente)",
    E: 100,
    F: 100,
    H: "microperforado solvente, vinilo para vidriera, vinilo que se ve de adentro",
  },
];

// ── §8: crear la colección Merchandising ───────────────────────────────────────────────

export const COLECCION_NUEVA = {
  A: "Merchandising",
  B: "Imanes personalizados para heladera y promoción. Los chicos se cobran por unidad y bajan " +
     "de precio por cantidad; los troquelados a medida se cotizan por metro cuadrado, mínimo " +
     "medio m2.",
  C: "Iman impresión laminada y corte", // Material base
};

// ── Fase 3: casos de prueba rotos por renombre (§10 del plan) ─────────────────────────
//
// 4 casos referencian el nombre VIEJO del material tras los renombres que trajo el
// cliente (§0.1 del plan — verificado que Productos ya apuntaba bien a los nuevos, solo
// nuestra hoja interna Casos de prueba quedó con el nombre viejo). Mismo precio, mecánico.
// Los casos 119/120 (Encuadernación abrochada / fresada) NO cambian: esos materiales
// siguen con el mismo nombre, solo el PRODUCTO se renombró (que el caso no referencia).
export const CASOS_A_RENOMBRAR = [
  { fila: 63, columna: "C", de: "Anillado plástico", a: "Anillado plástico A4/Oficio" },
  { fila: 68, columna: "C", de: "Laminado", a: "Laminado A4" },
  { fila: 72, columna: "C", de: "Anillado plástico", a: "Anillado plástico A4/Oficio" },
  { fila: 118, columna: "C", de: "Anillado metálico wire-o", a: "Anillado metálico hasta 3/4 pulgada" },
];

// El caso 122 ("20 troquelados y corte a medida... → $1.000") referencia el material
// "Troquelado y corte a medida", que ya no existe (se apartó a Pendientes su sucesor con
// otra forma de cobro, ver A_PENDIENTES). Se retira: no hay dato al que actualizarlo sin
// inventar un precio que TG no dio.
export const CASOS_A_BORRAR = [122];

// ── §9: agrupar por Familia (junto con PRODUCTOS_NUEVOS de arriba) ────────────────────
//
// Familia agrupa en UN chunk los materiales de una misma familia que YA tienen producto
// propio (ver la nota en PRODUCTOS_A_REAPUNTAR) — sin esto, planos/plotter saldrían 4
// chunks casi idénticos por familia compitiendo entre sí en el retrieval (el mismo
// problema que ya tenían las tarjetas sin agrupar). Microperforado (solvente) comparte
// Familia con Vinilo microperforado (UV): un chunk, los dos procesos, la nota del cliente
// ("no fusionar sin confirmar con Pedro") sobrevive intacta en la columna G.
export const FAMILIAS_A_CARGAR = [
  // Impresión de planos: fila 118 (lineal) + 187-189 (25/50/100%, con producto nuevo arriba).
  { fila: 118, familia: "Impresión de planos" },
  { fila: 187, familia: "Impresión de planos" },
  { fila: 188, familia: "Impresión de planos" },
  { fila: 189, familia: "Impresión de planos" },

  // Plotter papel vegetal: fila 190 (lineal) + 191-193.
  { fila: 190, familia: "Plotter papel vegetal" },
  { fila: 191, familia: "Plotter papel vegetal" },
  { fila: 192, familia: "Plotter papel vegetal" },
  { fila: 193, familia: "Plotter papel vegetal" },

  // Plotter papel 130gr recubierto/encapado: fila 194 (lineal) + 195-197.
  { fila: 194, familia: "Plotter papel 130gr recubierto" },
  { fila: 195, familia: "Plotter papel 130gr recubierto" },
  { fila: 196, familia: "Plotter papel 130gr recubierto" },
  { fila: 197, familia: "Plotter papel 130gr recubierto" },

  // Microperforado: fila 116 (UV) + 208 (solvente, con producto nuevo arriba).
  { fila: 116, familia: "Microperforado" },
  { fila: 208, familia: "Microperforado" },
];
