// LOS DATOS de los 46 productos nuevos, sacados del Excel que mandó el cliente
// (`Catalogo_WhatsApp_Terminal_Grafica (1).xlsx`, hoja "Lista de precios" + las dos hojas
// de escalas). Separados del script que los escribe para poder revisarlos sin leer código.
//
// Decisiones aplicadas (ver plans/carga-productos-nuevos.md):
// - `fijo`: precio cerrado para una cantidad. 100 tarjetas $13.200, y 500 NO son cinco
//   veces eso. Se modela como escala de un tramo cuya unidad de cobro ES el paquete.
// - precio plano por unidad: escala de UN tramo (1 a ∞). No se usa `fijo` con cantidad 1
//   porque el chunk diría "el precio es $2.400 por 1 unidad" en vez de "$2.400 cada uno".
// - Las variantes que el cliente escondió en notas ("Doble faz: 600/200/120/110") se
//   desdoblan en productos propios con su escala completa.
// - Se descartan: los 3 que ya cotizamos por pliego, Fotocopias (el ID del cliente dice
//   FOTOCOPIAS-NO y es lo único que TG no trabaja), los compuestos, y el duplicado
//   "Libros con encuadernación fresada" = "Encuadernación fresada".

/** Colecciones nuevas. `sinMinimo` exime del mínimo por trabajo (ver COL_SIN_MINIMO). */
export const COLECCIONES = [
  {
    nombre: "Tarjetas personales",
    descripcion:
      "Tarjetas de presentación 9x5 cm, full color. Simple o doble faz, en papel ilustración " +
      "o kraft 280 g, con opción encapsulada (plastificada de ambos lados). Se cotizan por " +
      "cantidad cerrada: 100, 500 o 1000.",
  },
  {
    nombre: "Papelería comercial",
    descripcion:
      "Papelería impresa con la marca del negocio: hojas membretadas, sobres, talonarios de " +
      "factura o remito, notas de pedido, recetarios y carpetas institucionales.",
  },
  {
    nombre: "Impresión digital",
    descripcion:
      "Impresión de archivos por hoja, en color o blanco y negro, A4 y A3. En papel obra, " +
      "ilustración u opalina. El precio por hoja baja según la cantidad.",
    // Una hoja b/n cuesta $100: el mínimo por trabajo la llevaría a $4.000, cuarenta veces
    // su precio. Se cobra por hoja y el cliente pide las hojas que necesita.
    sinMinimo: true,
  },
  {
    nombre: "Encuadernación y terminaciones",
    descripcion:
      "Trabajos que se hacen sobre un impreso ya listo: anillado, wire-o, fresado, abrochado, " +
      "laminado, plastificado, troquelado, ojalillos y numerado. Se cobran por unidad y no " +
      "incluyen la impresión.",
    // Son agregados sobre un trabajo ya cobrado: el mínimo les multiplicaría el precio por 12.
    sinMinimo: true,
  },
  {
    nombre: "Folletería y editorial",
    descripcion: "Volantes, anotadores, apuntes y libros de estudio.",
  },
  {
    nombre: "Gran formato y cartelería",
    descripcion: "Posters, banners roll-up y porta banners tipo X, listos para usar.",
  },
  {
    nombre: "Señalética y punto de venta",
    descripcion:
      "Carteles de seguridad e higiene, cartas y menús plastificados, y carteles de precios " +
      "para el local.",
  },
  {
    nombre: "Eventos y sociales",
    descripcion: "Tarjetería para eventos: agradecimiento, invitaciones y afines.",
  },
];

/**
 * Materiales nuevos. Cada uno es la LÍNEA DE PRECIO de un producto (o de un grupo que
 * comparte precio), no un material físico: es la unidad en la que el negocio cobra.
 *
 * `unidad` define el modo. Todas las nuevas son unidades no geométricas ("unidad", "hoja",
 * "paquete de N"), o sea modo `item`: una unidad de cobro = un ítem, sin rinde ni m2.
 * Por eso ninguna lleva geometría.
 *
 * `sinMinimo` exime del mínimo por trabajo de $4.000. Va acá y no en la colección porque
 * casi todas mezclan: "Papelería comercial" tiene sobres a $250 la unidad —que sin exención
 * cotizarían $4.000— y talonarios de $54.000, que sí tienen que llevar piso. La regla que
 * seguí: lo que se cobra DE A UNO y cuesta menos que el mínimo va exento; los paquetes
 * cerrados y todo lo que ya supera el mínimo, no.
 */
export const MATERIALES = [
  // ── Tarjetas: cada combinación de cantidad + terminación tiene su precio cerrado ──────
  { material: "Tarjetas 9x5 simple faz x100", unidad: "paquete de 100", tramos: [[1, null, 13200]] },
  { material: "Tarjetas 9x5 simple faz encapsuladas x100", unidad: "paquete de 100", tramos: [[1, null, 16500]] },
  { material: "Tarjetas 9x5 doble faz x100", unidad: "paquete de 100", tramos: [[1, null, 16500]] },
  { material: "Tarjetas 9x5 doble faz encapsuladas x100", unidad: "paquete de 100", tramos: [[1, null, 18700]] },
  { material: "Tarjetas 9x5 kraft simple faz x100", unidad: "paquete de 100", tramos: [[1, null, 17600]] },
  { material: "Tarjetas 9x5 kraft doble faz x100", unidad: "paquete de 100", tramos: [[1, null, 24200]] },
  { material: "Tarjetas 9x5 simple faz x500", unidad: "paquete de 500", tramos: [[1, null, 28000]] },
  { material: "Tarjetas 9x5 simple faz encapsuladas x500", unidad: "paquete de 500", tramos: [[1, null, 38000]] },
  { material: "Tarjetas 9x5 doble faz x500", unidad: "paquete de 500", tramos: [[1, null, 38000]] },
  { material: "Tarjetas 9x5 doble faz encapsuladas x500", unidad: "paquete de 500", tramos: [[1, null, 45000]] },
  { material: "Tarjetas 9x5 simple faz x1000", unidad: "paquete de 1000", tramos: [[1, null, 42000]] },
  { material: "Tarjetas 9x5 simple faz encapsuladas x1000", unidad: "paquete de 1000", tramos: [[1, null, 54000]] },
  { material: "Tarjetas 9x5 doble faz x1000", unidad: "paquete de 1000", tramos: [[1, null, 54000]] },
  { material: "Tarjetas 9x5 doble faz encapsuladas x1000", unidad: "paquete de 1000", tramos: [[1, null, 59000]] },

  // ── Papelería comercial ──────────────────────────────────────────────────────────────
  { material: "Hojas membretadas A4 x500", unidad: "paquete de 500", tramos: [[1, null, 35000]] },
  { material: "Sobres impresos x100", unidad: "paquete de 100", tramos: [[1, null, 25000]] },
  { material: "Talonarios x10", unidad: "paquete de 10", tramos: [[1, null, 54000]] },
  // Escala confirmada por el cliente el 19/08/2026 contra la pantalla de su sistema.
  { material: "Sobres oficio inglés", unidad: "unidad", tramos: [[1, 200, 250], [201, 500, 220], [501, 1000, 190], [1001, null, 180]], sinMinimo: true },
  { material: "Carpetas institucionales sin laminar", unidad: "unidad", tramos: [[1, 20, 2600], [21, 50, 2500], [51, 100, 2300], [101, 300, 2100], [301, null, 1900]], sinMinimo: true },
  { material: "Carpetas institucionales laminadas", unidad: "unidad", tramos: [[1, 20, 3000], [21, 50, 2800], [51, 100, 2600], [101, 300, 2400], [301, null, 2300]], sinMinimo: true },
  // "Mínimo 5 unidades" según la nota del cliente: no hay dónde cargarlo (el mínimo del
  // Excel es por importe, no por cantidad), va en la descripción del producto.
  { material: "Recetarios en negro", unidad: "unidad", tramos: [[1, 10, 4000], [11, 20, 3400], [21, 50, 3000], [51, null, 2600]], sinMinimo: true },
  { material: "Recetarios en color", unidad: "unidad", tramos: [[1, 10, 4500], [11, 20, 3800], [21, 50, 3200], [51, null, 2800]], sinMinimo: true },

  // ── Impresión digital ────────────────────────────────────────────────────────────────
  { material: "Impresión color A4 simple faz", unidad: "hoja", tramos: [[1, 70, 400], [71, 150, 150], [151, 500, 80], [501, null, 70]], sinMinimo: true },
  // Desdoblada de la nota "Doble faz: 600/200/120/110" del cliente.
  { material: "Impresión color A4 doble faz", unidad: "hoja", tramos: [[1, 70, 600], [71, 150, 200], [151, 500, 120], [501, null, 110]], sinMinimo: true },
  { material: "Impresión blanco y negro A4 simple faz", unidad: "hoja", tramos: [[1, 10, 100], [11, null, 70]], sinMinimo: true },
  // La escala completa la pasó TG aparte: el archivo del cliente la traía aplastada a dos
  // tramos y con los precios de doble faz sueltos en una nota. De acá sale el precio de los
  // apuntes (doble faz + anillado), así que los cortes importan.
  { material: "Impresión blanco y negro A4 doble faz", unidad: "hoja", tramos: [[1, 10, 150], [11, 100, 96], [101, 500, 88], [501, 1000, 86], [1001, null, 84]], sinMinimo: true },
  { material: "Impresión color A3", unidad: "hoja", tramos: [[1, null, 1200]], sinMinimo: true },
  { material: "Impresión blanco y negro A3", unidad: "hoja", tramos: [[1, null, 600]], sinMinimo: true },
  { material: "Impresión en papel ilustración", unidad: "hoja", tramos: [[1, null, 800]], sinMinimo: true },
  { material: "Impresión en opalina", unidad: "hoja", tramos: [[1, null, 900]], sinMinimo: true },

  // ── Encuadernación y terminaciones (colección EXENTA del mínimo) ─────────────────────
  { material: "Anillado plástico", unidad: "unidad", tramos: [[1, null, 2400]], sinMinimo: true },
  { material: "Anillado metálico wire-o", unidad: "unidad", tramos: [[1, null, 3200]], sinMinimo: true },
  { material: "Encuadernación abrochada", unidad: "unidad", tramos: [[1, null, 2000]], sinMinimo: true },
  { material: "Encuadernación fresada", unidad: "unidad", tramos: [[1, 1, 7000], [2, null, 5000]] },
  { material: "Laminado", unidad: "unidad", tramos: [[1, null, 330]], sinMinimo: true },
  // El cliente tenía los 5 formatos metidos en la descripción de una sola fila
  // ("A4 $2.200, oficio $2.400, A3 $3.000, carnet 9x13 $1.500, cocodrilo $800").
  // Desdoblados: si no, plastificar un carnet cotizaría $2.200 en vez de $1.500.
  { material: "Plastificado A4", unidad: "unidad", tramos: [[1, null, 2200]], sinMinimo: true },
  { material: "Plastificado oficio", unidad: "unidad", tramos: [[1, null, 2400]], sinMinimo: true },
  { material: "Plastificado A3", unidad: "unidad", tramos: [[1, null, 3000]], sinMinimo: true },
  { material: "Plastificado carnet", unidad: "unidad", tramos: [[1, null, 1500]], sinMinimo: true },
  { material: "Plastificado cocodrilo", unidad: "unidad", tramos: [[1, null, 800]], sinMinimo: true },
  { material: "Troquelado y corte a medida", unidad: "unidad", tramos: [[1, null, 50]], sinMinimo: true },
  { material: "Colocación de ojalillos", unidad: "unidad", tramos: [[1, null, 1000]], sinMinimo: true },
  { material: "Numerado correlativo", unidad: "unidad", tramos: [[1, null, 5000]] },
  { material: "Perforado x500", unidad: "paquete de 500", tramos: [[1, null, 4000]] },

  // ── Folletería y editorial ───────────────────────────────────────────────────────────
  { material: "Volantes A6 x500", unidad: "paquete de 500", tramos: [[1, null, 12000]] },
  { material: "Libros de medicina", unidad: "unidad", tramos: [[1, null, 30000]] },
  { material: "Pack 4 libros de medicina", unidad: "pack", tramos: [[1, null, 99000]] },
  { material: "Anotadores personalizados en negro", unidad: "unidad", tramos: [[1, 10, 4000], [11, 20, 3400], [21, 50, 3000], [51, null, 2600]], sinMinimo: true },
  // Desdoblada de la nota "En color: 4500/3800/3200/2800".
  { material: "Anotadores personalizados en color", unidad: "unidad", tramos: [[1, 10, 4500], [11, 20, 3800], [21, 50, 3200], [51, null, 2800]], sinMinimo: true },

  // ── Gran formato y cartelería ────────────────────────────────────────────────────────
  { material: "Posters A3 y A2", unidad: "unidad", tramos: [[1, null, 1600]], sinMinimo: true },
  { material: "Banner roll-up", unidad: "unidad", tramos: [[1, null, 38000]] },
  { material: "Porta banner tipo X", unidad: "unidad", tramos: [[1, null, 32000]] },

  // ── Señalética y punto de venta ──────────────────────────────────────────────────────
  { material: "Cartelería en plástico corrugado A3", unidad: "unidad", tramos: [[1, null, 10500]] },
  { material: "Cartas y menús plastificados", unidad: "unidad", tramos: [[1, null, 2600]], sinMinimo: true },
  // El cliente lo llamaba "Plastificado A4", pero el producto es A3 y el precio no es el
  // del plastificado solo: es impresión color + plastificado, como dice su descripción.
  // El nombre del material dice de qué está hecho el precio.
  { material: "Impresión color más plastificado", unidad: "unidad", tramos: [[1, null, 4800]] },
];

/**
 * Los productos. `medida` es [ancho, alto] en cm, o null para los trabajos sin medida
 * (un anillado no tiene tamaño: es el trabajo).
 */
export const PRODUCTOS = [
  // ── Tarjetas personales ──────────────────────────────────────────────────────────────
  { coleccion: "Tarjetas personales", producto: "100 tarjetas 9x5 cm simple faz", material: "Tarjetas 9x5 simple faz x100", medida: [9, 5], descripcion: "Tarjetas de presentación full color, impresas de un lado. El precio es por las 100.", sinonimos: "tarjetas personales, tarjetas de presentación, tarjetas comerciales" },
  { coleccion: "Tarjetas personales", producto: "100 tarjetas 9x5 cm simple faz encapsuladas", material: "Tarjetas 9x5 simple faz encapsuladas x100", medida: [9, 5], descripcion: "Impresas de un lado y plastificadas de los dos: más resistentes y con mejor tacto." },
  { coleccion: "Tarjetas personales", producto: "100 tarjetas 9x5 cm doble faz", material: "Tarjetas 9x5 doble faz x100", medida: [9, 5], descripcion: "Full color de los dos lados. El precio es por las 100." },
  { coleccion: "Tarjetas personales", producto: "100 tarjetas 9x5 cm doble faz encapsuladas", material: "Tarjetas 9x5 doble faz encapsuladas x100", medida: [9, 5], descripcion: "Impresas de los dos lados y plastificadas." },
  { coleccion: "Tarjetas personales", producto: "100 tarjetas 9x5 cm en papel kraft simple faz", material: "Tarjetas 9x5 kraft simple faz x100", medida: [9, 5], descripcion: "Papel kraft 280 g, con textura y color natural. Impresas de un lado." },
  { coleccion: "Tarjetas personales", producto: "100 tarjetas 9x5 cm en papel kraft doble faz", material: "Tarjetas 9x5 kraft doble faz x100", medida: [9, 5], descripcion: "Papel kraft 280 g, impresas de los dos lados." },
  { coleccion: "Tarjetas personales", producto: "500 tarjetas 9x5 cm simple faz", material: "Tarjetas 9x5 simple faz x500", medida: [9, 5], descripcion: "Full color de un lado. El precio es por las 500." },
  { coleccion: "Tarjetas personales", producto: "500 tarjetas 9x5 cm simple faz encapsuladas", material: "Tarjetas 9x5 simple faz encapsuladas x500", medida: [9, 5], descripcion: "De un lado y plastificadas. El precio es por las 500." },
  { coleccion: "Tarjetas personales", producto: "500 tarjetas 9x5 cm doble faz", material: "Tarjetas 9x5 doble faz x500", medida: [9, 5], descripcion: "Full color de los dos lados. El precio es por las 500." },
  { coleccion: "Tarjetas personales", producto: "500 tarjetas 9x5 cm doble faz encapsuladas", material: "Tarjetas 9x5 doble faz encapsuladas x500", medida: [9, 5], descripcion: "De los dos lados y plastificadas. El precio es por las 500." },
  { coleccion: "Tarjetas personales", producto: "1000 tarjetas 9x5 cm simple faz", material: "Tarjetas 9x5 simple faz x1000", medida: [9, 5], descripcion: "Full color de un lado. El precio es por las 1000." },
  { coleccion: "Tarjetas personales", producto: "1000 tarjetas 9x5 cm simple faz encapsuladas", material: "Tarjetas 9x5 simple faz encapsuladas x1000", medida: [9, 5], descripcion: "De un lado y plastificadas. El precio es por las 1000." },
  { coleccion: "Tarjetas personales", producto: "1000 tarjetas 9x5 cm doble faz", material: "Tarjetas 9x5 doble faz x1000", medida: [9, 5], descripcion: "Full color de los dos lados. El precio es por las 1000." },
  { coleccion: "Tarjetas personales", producto: "1000 tarjetas 9x5 cm doble faz encapsuladas", material: "Tarjetas 9x5 doble faz encapsuladas x1000", medida: [9, 5], descripcion: "De los dos lados y plastificadas. El precio es por las 1000." },

  // ── Papelería comercial ──────────────────────────────────────────────────────────────
  { coleccion: "Papelería comercial", producto: "500 hojas membretadas A4", material: "Hojas membretadas A4 x500", medida: [21, 29.7], descripcion: "Hojas A4 impresas con el logo y los datos del negocio. El precio es por las 500.", sinonimos: "hojas membretadas, papel con logo, membrete" },
  { coleccion: "Papelería comercial", producto: "100 sobres impresos", material: "Sobres impresos x100", medida: [21, 11], descripcion: "Sobres con el logo y los datos del negocio. El precio es por los 100.", sinonimos: "sobres membretados, sobres con logo" },
  // El cliente lo describe como "10 talonarios de 50 juegos por duplicado": el pedido son
  // 500 juegos, no 10 blocks sueltos. El nombre lo dice para que el bot no cobre 10 veces.
  { coleccion: "Papelería comercial", producto: "10 talonarios de factura o remito", material: "Talonarios x10", medida: [15, 21], descripcion: "10 talonarios A5 de 50 juegos por duplicado, abrochados y troquelados. El precio es por los 10 talonarios.", sinonimos: "talonarios, facturas, remitos, notas de pedido, comandas" },
  { coleccion: "Papelería comercial", producto: "Sobres oficio inglés", material: "Sobres oficio inglés", medida: [23.5, 12], descripcion: "Sobre tamaño oficio inglés impreso. Se cobra por unidad y el precio baja por cantidad.", sinonimos: "sobres, sobres oficio" },
  // 31x46 cm es la carpeta ABIERTA (cerrada queda A4). El dato es del archivo del cliente.
  { coleccion: "Papelería comercial", producto: "Carpetas institucionales", material: "Carpetas institucionales sin laminar", medida: [31, 46], descripcion: "Carpeta de presentación A4 cerrada, en cartulina 300 g, troquelada, con solapa y ranura. Sin laminar. Se cobra por unidad.", sinonimos: "carpetas, carpetas de presentación, folders" },
  { coleccion: "Papelería comercial", producto: "Carpetas institucionales laminadas", material: "Carpetas institucionales laminadas", medida: [31, 46], descripcion: "La misma carpeta A4, plastificada: más resistente al uso y al roce." },
  { coleccion: "Papelería comercial", producto: "Recetarios en negro", material: "Recetarios en negro", medida: [14.8, 21], descripcion: "Talonario de recetas impreso en negro. Mínimo 5 unidades.", sinonimos: "recetarios, recetas médicas, blocks de receta" },
  { coleccion: "Papelería comercial", producto: "Recetarios en color", material: "Recetarios en color", medida: [14.8, 21], descripcion: "Talonario de recetas impreso full color. Mínimo 5 unidades." },

  // ── Impresión digital ────────────────────────────────────────────────────────────────
  { coleccion: "Impresión digital", producto: "Impresión color A4", material: "Impresión color A4 simple faz", medida: [21, 29.7], descripcion: "Impresión full color en papel obra 75 g, de un lado. Se cobra por hoja y el precio baja por cantidad.", sinonimos: "imprimir, impresiones, copias en color" },
  { coleccion: "Impresión digital", producto: "Impresión color A4 doble faz", material: "Impresión color A4 doble faz", medida: [21, 29.7], descripcion: "Full color de los dos lados de la hoja." },
  { coleccion: "Impresión digital", producto: "Impresión blanco y negro A4", material: "Impresión blanco y negro A4 simple faz", medida: [21, 29.7], descripcion: "Impresión en blanco y negro en papel obra 75 g, de un lado. Se cobra por hoja.", sinonimos: "imprimir, impresiones, impresión de archivos, fotocopias" },
  { coleccion: "Impresión digital", producto: "Impresión blanco y negro A4 doble faz", material: "Impresión blanco y negro A4 doble faz", medida: [21, 29.7], descripcion: "Blanco y negro de los dos lados de la hoja. Es lo que se usa para apuntes y material de estudio: se cuentan las hojas y se le suma el anillado." },
  { coleccion: "Impresión digital", producto: "Impresión color A3", material: "Impresión color A3", medida: [29.7, 42], descripcion: "Impresión láser full color en A3. Se cobra por hoja." },
  { coleccion: "Impresión digital", producto: "Impresión blanco y negro A3", material: "Impresión blanco y negro A3", medida: [29.7, 42], descripcion: "Impresión en blanco y negro en A3. Se cobra por hoja." },
  { coleccion: "Impresión digital", producto: "Impresión en papel ilustración", material: "Impresión en papel ilustración", medida: [21, 29.7], descripcion: "Papel ilustración: más grueso y con terminación satinada." },
  { coleccion: "Impresión digital", producto: "Impresión en opalina", material: "Impresión en opalina", medida: [21, 29.7], descripcion: "Opalina: papel rígido y liso, para certificados y diplomas." },

  // ── Encuadernación y terminaciones ───────────────────────────────────────────────────
  { coleccion: "Encuadernación y terminaciones", producto: "Anillado plástico", material: "Anillado plástico", medida: [21, 29.7], descripcion: "Anillado con espiral plástico. Se cobra por unidad y no incluye la impresión.", sinonimos: "anillado, espiralado, espiral, encuadernado con anillo" },
  { coleccion: "Encuadernación y terminaciones", producto: "Anillado metálico wire-o", material: "Anillado metálico wire-o", medida: [21, 29.7], descripcion: "Anillado con espiral metálico wire-o. No incluye la impresión." },
  { coleccion: "Encuadernación y terminaciones", producto: "Encuadernación abrochada a caballo", material: "Encuadernación abrochada", medida: [21, 29.7], descripcion: "Abrochado al centro, para cuadernillos de pocas hojas. No incluye la impresión." },
  { coleccion: "Encuadernación y terminaciones", producto: "Encuadernación fresada", material: "Encuadernación fresada", medida: [21, 29.7], descripcion: "Encuadernación pegada, tipo libro. No incluye la impresión.", sinonimos: "encuadernación, empastado, tesis, libros" },
  { coleccion: "Encuadernación y terminaciones", producto: "Laminado mate o brillante", material: "Laminado", medida: [21, 29.7], descripcion: "Plastificado fino sobre el impreso, mate o brillante. Se cobra por unidad.", sinonimos: "laminado, plastificado, brillo, mate" },
  { coleccion: "Encuadernación y terminaciones", producto: "Plastificado de documentos A4", material: "Plastificado A4", medida: [21, 29.7], descripcion: "Plastificado rígido de documentos en A4. Se cobra por unidad.", sinonimos: "plastificado, laminado rígido, plastificar" },
  { coleccion: "Encuadernación y terminaciones", producto: "Plastificado de documentos oficio", material: "Plastificado oficio", medida: [21.6, 33], descripcion: "Plastificado rígido en tamaño oficio." },
  { coleccion: "Encuadernación y terminaciones", producto: "Plastificado de documentos A3", material: "Plastificado A3", medida: [29.7, 42], descripcion: "Plastificado rígido en A3." },
  { coleccion: "Encuadernación y terminaciones", producto: "Plastificado de credencial o carnet 9x13", material: "Plastificado carnet", medida: [9, 13], descripcion: "Plastificado de credenciales y carnets, 9x13 cm.", sinonimos: "credencial, carnet, plastificar carnet" },
  { coleccion: "Encuadernación y terminaciones", producto: "Plastificado cocodrilo", material: "Plastificado cocodrilo", descripcion: "Plastificado cocodrilo, el formato más chico.", sinonimos: "cocodrilo" },
  { coleccion: "Encuadernación y terminaciones", producto: "Troquelado y corte a medida", material: "Troquelado y corte a medida", descripcion: "Corte con forma sobre un impreso. Se cobra por unidad.", sinonimos: "troquelado, corte con forma, troquel" },
  { coleccion: "Encuadernación y terminaciones", producto: "Colocación de ojalillos", material: "Colocación de ojalillos", descripcion: "Colocación de ojalillos metálicos. Se cobra por ojalillo.", sinonimos: "ojales, ojalillos, arandelas" },
  { coleccion: "Encuadernación y terminaciones", producto: "Numerado correlativo", material: "Numerado correlativo", descripcion: "Numeración correlativa sobre el impreso.", sinonimos: "numerado, numeración, correlativo" },
  { coleccion: "Encuadernación y terminaciones", producto: "500 perforados o microperforados", material: "Perforado x500", descripcion: "Perforado o microperforado. El precio es por los 500.", sinonimos: "perforado, agujeros, microperforado" },

  // ── Folletería y editorial ───────────────────────────────────────────────────────────
  { coleccion: "Folletería y editorial", producto: "500 volantes A6", material: "Volantes A6 x500", medida: [10, 15], descripcion: "Volantes 10x15 cm full color. El precio es por los 500.", sinonimos: "volantes, flyers, panfletos, folletos" },
  // "Apuntes y material de estudio" NO va como producto con precio propio: los $12.000 del
  // cliente eran un ejemplo, no una tarifa. Un apunte se cotiza sumando lo que de verdad
  // lleva — las hojas (b/n doble faz, en su tramo) más el anillado — y esos dos ya están
  // cargados. Un precio fijo acá cotizaría igual un apunte de 20 hojas que uno de 300.
  { coleccion: "Folletería y editorial", producto: "Libros de medicina", material: "Libros de medicina", descripcion: "Cuatro títulos puntuales: ROSS Histología, LANGMAN Embriología Médica, GUYTON & HALL Fisiología y MOORE Anatomía Clínica. Mismo precio cada uno, sin importar la cantidad de páginas. Solo estos cuatro.", sinonimos: "ross, langman, guyton, hall, moore, histología, embriología, fisiología, anatomía, anatomía clínica" },
  { coleccion: "Folletería y editorial", producto: "Pack 4 libros de medicina", material: "Pack 4 libros de medicina", descripcion: "Los cuatro libros juntos: ROSS, LANGMAN, GUYTON & HALL y MOORE.", sinonimos: "pack de libros, combo medicina, los 4 libros" },
  { coleccion: "Folletería y editorial", producto: "Anotadores personalizados", material: "Anotadores personalizados en negro", medida: [10, 15], descripcion: "Taco de anotador 10x15 cm impreso en negro. Se cobra por unidad.", sinonimos: "anotadores, tacos, blocks, libretas" },
  { coleccion: "Folletería y editorial", producto: "Anotadores personalizados en color", material: "Anotadores personalizados en color", medida: [10, 15], descripcion: "El mismo taco 10x15 cm, impreso full color." },

  // ── Gran formato y cartelería ────────────────────────────────────────────────────────
  { coleccion: "Gran formato y cartelería", producto: "Posters A3 y A2", material: "Posters A3 y A2", medida: [29.7, 42], descripcion: "Poster impreso full color, A3 o A2. Se cobra por unidad.", sinonimos: "posters, afiches, láminas" },
  { coleccion: "Gran formato y cartelería", producto: "Banner roll-up 85x200 cm", material: "Banner roll-up", medida: [85, 200], descripcion: "Banner enrollable con estructura de aluminio y bolso. Listo para usar.", sinonimos: "roll up, banner enrollable" },
  // La medida que se trabaja es 90x190 (confirmado por TG). El cliente lo había nombrado
  // "60x160", que no es una medida que exista acá.
  { coleccion: "Gran formato y cartelería", producto: "Porta banner tipo X 90x190 cm", material: "Porta banner tipo X", medida: [90, 190], descripcion: "Estructura tipo X con la lona impresa, 90x190 cm. Liviana y fácil de armar.", sinonimos: "porta banner, araña, banner tipo x" },

  // ── Señalética y punto de venta ──────────────────────────────────────────────────────
  // Es una opción ÚNICA en A3, no un cartel a medida. Si lo piden en otro tamaño es un
  // cartel común y se cotiza por m2 desde "Carteles y vidrieras": la descripción lo dice
  // para que el bot no aplique este precio a cualquier medida.
  { coleccion: "Señalética y punto de venta", producto: "Cartelería de seguridad e higiene A3", material: "Cartelería en plástico corrugado A3", medida: [29.7, 42], descripcion: "Carteles reglamentarios de seguridad e higiene, en A3 (29,7x42 cm) sobre plástico corrugado. Este precio es solo para el A3; en otra medida se cotiza como cartel.", sinonimos: "cartel de seguridad, señalética, higiene y seguridad, cartel reglamentario" },
  // Mismo material, mismo precio, mismo A3 que la cartelería de seguridad: es la otra cara
  // del mismo producto y el cliente la tenía como fila propia.
  { coleccion: "Señalética y punto de venta", producto: "Señalética de baños y accesos A3", material: "Cartelería en plástico corrugado A3", medida: [29.7, 42], descripcion: "Señalética de baños y accesos en A3 sobre plástico corrugado. Para interior también se puede en A4 plastificado.", sinonimos: "señalética, cartel de baño, cartel de acceso, señal" },
  { coleccion: "Señalética y punto de venta", producto: "Cartas y menús plastificados A4", material: "Cartas y menús plastificados", medida: [21, 29.7], descripcion: "Carta o menú A4 impreso y plastificado, para que aguante el uso diario.", sinonimos: "cartas, menús, carta de restaurante" },
  { coleccion: "Señalética y punto de venta", producto: "Carteles de precios y ofertas A3", material: "Impresión color más plastificado", medida: [29.7, 42], descripcion: "Cartel de precios u ofertas en A3: impresión color más plastificado.", sinonimos: "cartel de precios, cartel de oferta, cartel para el local" },

  // ── Eventos y sociales ───────────────────────────────────────────────────────────────
  { coleccion: "Eventos y sociales", producto: "100 tarjetas de agradecimiento", material: "Tarjetas 9x5 simple faz x100", medida: [9, 5], descripcion: "Tarjetas 9x5 cm para agradecer a los invitados. El precio es por las 100.", sinonimos: "tarjetas de agradecimiento, tarjetas de evento" },
];

/**
 * Casos de prueba nuevos. Tres clases:
 *  - contra el ejemplo YA COMPROBADO: la cantidad que el cliente tiene cargada.
 *  - contra cantidades NUEVAS: que el motor elija bien el tramo.
 *  - de BORDE: las fronteras de tramo, que es donde un motor de escalas falla.
 */
export const CASOS = [
  // Precio cerrado: pasa tal cual.
  ["100 tarjetas 9x5 simple faz", 1, "Tarjetas 9x5 simple faz x100", 9, 5, 13200],
  ["500 tarjetas 9x5 doble faz", 1, "Tarjetas 9x5 doble faz x500", 9, 5, 38000],
  ["1000 tarjetas 9x5 simple faz encapsuladas", 1, "Tarjetas 9x5 simple faz encapsuladas x1000", 9, 5, 54000],
  ["500 hojas membretadas A4", 1, "Hojas membretadas A4 x500", 21, 29.7, 35000],
  ["10 talonarios de factura", 1, "Talonarios x10", 15, 21, 54000],
  ["500 volantes A6", 1, "Volantes A6 x500", 10, 15, 12000],
  ["1 banner roll-up 85x200", 1, "Banner roll-up", 85, 200, 38000],
  // El propio cotizador del cliente da este número (250 x $220).
  ["250 sobres oficio inglés", 250, "Sobres oficio inglés", 23.5, 12, 55000],

  // Cantidades que el cliente NO tiene cargadas: el motor tiene que elegir el tramo.
  ["150 sobres oficio inglés (tramo 1-200)", 150, "Sobres oficio inglés", 23.5, 12, 37500],
  ["600 sobres oficio inglés (tramo 501-1000)", 600, "Sobres oficio inglés", 23.5, 12, 114000],
  ["1200 sobres oficio inglés (tramo 1001+)", 1200, "Sobres oficio inglés", 23.5, 12, 216000],
  ["30 carpetas institucionales", 30, "Carpetas institucionales sin laminar", 21, 29.7, 75000],
  ["30 carpetas institucionales laminadas", 30, "Carpetas institucionales laminadas", 21, 29.7, 84000],
  ["200 impresiones color A4", 200, "Impresión color A4 simple faz", 21, 29.7, 16000],
  ["15 anotadores en color", 15, "Anotadores personalizados en color", 10, 15, 57000],
  ["40 anillados plásticos", 40, "Anillado plástico", 21, 29.7, 96000],

  // Bordes de tramo. El par 20/21 es el más valioso: 21 carpetas cuestan MÁS que 20
  // aunque el precio unitario baje. Si el motor se equivoca de tramo, salta acá.
  ["200 sobres oficio inglés (último del tramo)", 200, "Sobres oficio inglés", 23.5, 12, 50000],
  // 201 x $220 = $44.220, redondeado al múltiplo de $100 más cercano.
  ["201 sobres oficio inglés (primero del siguiente)", 201, "Sobres oficio inglés", 23.5, 12, 44200],
  ["20 carpetas institucionales (último del tramo)", 20, "Carpetas institucionales sin laminar", 21, 29.7, 52000],
  ["21 carpetas institucionales (sale MÁS que 20)", 21, "Carpetas institucionales sin laminar", 21, 29.7, 52500],

  // La exención del mínimo. Sin ella los cuatro primeros darían $4.000.
  ["1 laminado (exento del mínimo)", 1, "Laminado", 21, 29.7, 300],
  ["1 colocación de ojalillos (exento)", 1, "Colocación de ojalillos", 21, 29.7, 1000],
  ["1 impresión b/n A4 (exenta: $100, no $4.000)", 1, "Impresión blanco y negro A4 simple faz", 21, 29.7, 100],
  ["1 sobre oficio inglés (exento: $250, no $4.000)", 1, "Sobres oficio inglés", 23.5, 12, 300],
  ["12 anillados plásticos (exento, supera el mínimo)", 12, "Anillado plástico", 21, 29.7, 28800],
  // Y el otro lado: lo que NO está exento sigue llevando piso. Si la exención se
  // derramara a los paquetes cerrados, TG cobraría de menos en los trabajos grandes.
  ["1 talonario x10 (NO exento, ya supera el mínimo)", 1, "Talonarios x10", 15, 21, 54000],

  // La escala de b/n doble faz, que TG pasó completa: es de donde sale el precio de un
  // apunte (hojas + anillado). El archivo del cliente la traía aplastada a dos tramos.
  ["50 impresiones b/n A4 doble faz (tramo 11-100)", 50, "Impresión blanco y negro A4 doble faz", 21, 29.7, 4800],
  ["200 impresiones b/n A4 doble faz (tramo 101-500)", 200, "Impresión blanco y negro A4 doble faz", 21, 29.7, 17600],
  ["1500 impresiones b/n A4 doble faz (tramo 1001+)", 1500, "Impresión blanco y negro A4 doble faz", 21, 29.7, 126000],

  // Los formatos de plastificado que el cliente tenía escondidos en una descripción. Sin
  // desdoblarlos, plastificar un carnet cotizaba $2.200 en vez de $1.500.
  ["1 plastificado A4", 1, "Plastificado A4", 21, 29.7, 2200],
  ["1 plastificado de carnet 9x13", 1, "Plastificado carnet", 9, 13, 1500],
  ["1 plastificado cocodrilo (el más barato)", 1, "Plastificado cocodrilo", 5, 8, 800],
  ["10 plastificados A3", 10, "Plastificado A3", 29.7, 42, 30000],
];
