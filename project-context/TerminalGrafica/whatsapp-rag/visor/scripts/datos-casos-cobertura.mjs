// LOS DATOS de 37 casos nuevos para la hoja "Casos de prueba", uno por cada material que hoy
// no tiene ningún caso (37 de 73 materiales sin cobertura, medido el 2026-08-31). Con estos,
// los 73 materiales del catálogo quedan con al menos un caso.
//
// Cada objeto tiene EXACTAMENTE las 7 columnas de la hoja "Casos de prueba":
//   Pedido | Cantidad | Material | Ancho (cm) | Alto (cm) | Piezas por unidad de cobro | Precio correcto
//
// El precio de cada fila salió de correr `cotizar()` (copiado literal de n8n/build-flow.mjs,
// FUENTE_RINDE + FUENTE_COTIZAR) contra el Excel real — no de calcularlo a mano. Ver el
// `.md` al lado para el detalle por caso y el resultado de la corrida de verificación.
//
// Reglas seguidas:
// - Los 2 materiales modo PLIEGO (OPP brillo, OPP plata/holográfico/cristal/mate — ambos
//   "sin cortar", geometría 31x46 sep 0) y el único modo M2 sin caso (Vinilo y lona UV con
//   blanco o barniz) usan medidas 8x8 cm y 60x80 cm respectivamente: NINGUNA de las dos
//   está en los 93 casos existentes ni en "Medidas de referencia" de Productos para esos
//   materiales (que hoy solo declaran 5x5 y 50x70).
// - Los 34 materiales modo ITEM llevan cada uno su propio caso (se cobran distinto entre sí).
// - "Piezas por unidad de cobro" solo se carga en los 2 casos pliego (donde el motor
//   devuelve un rinde real); en m2 e item queda vacía, igual que en los 93 casos existentes.
// - Ningún caso nuevo cae en "Derivar a consulta": las medidas y cantidades elegidas son
//   todas cotizables con el catálogo tal cual está.
export const CASOS_COBERTURA = [
  // ── Modo PLIEGO — 2 materiales sin ningún caso ──────────────────────────────────────
  {
    Pedido: "100 stickers en OPP brillo sin cortar de 8x8 cm",
    Cantidad: 100,
    Material: "OPP brillo",
    "Ancho (cm)": 8,
    "Alto (cm)": 8,
    "Piezas por unidad de cobro": 15,
    "Precio correcto": 16800,
  },
  {
    Pedido: "100 stickers holográficos sin cortar de 8x8 cm",
    Cantidad: 100,
    Material: "OPP plata, holográfico, cristal o mate",
    "Ancho (cm)": 8,
    "Alto (cm)": 8,
    "Piezas por unidad de cobro": 15,
    "Precio correcto": 18200,
  },

  // ── Modo M2 — 1 material sin ningún caso ────────────────────────────────────────────
  {
    Pedido: "1 cartel adhesivo con blanco de 60x80 cm",
    Cantidad: 1,
    Material: "Vinilo y lona UV con blanco o barniz",
    "Ancho (cm)": 60,
    "Alto (cm)": 80,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 13000,
  },

  // ── Modo ITEM — Tarjetas x100 (5 materiales; falta cubrir junto al x100 simple faz,
  //    que ya tiene caso) ──────────────────────────────────────────────────────────────
  {
    Pedido: "100 tarjetas 9x5 simple faz encapsuladas",
    Cantidad: 100,
    Material: "Tarjetas 9x5 simple faz encapsuladas x100",
    "Ancho (cm)": 9,
    "Alto (cm)": 5,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 16500,
  },
  {
    Pedido: "100 tarjetas 9x5 doble faz",
    Cantidad: 100,
    Material: "Tarjetas 9x5 doble faz x100",
    "Ancho (cm)": 9,
    "Alto (cm)": 5,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 16500,
  },
  {
    Pedido: "100 tarjetas 9x5 doble faz encapsuladas",
    Cantidad: 100,
    Material: "Tarjetas 9x5 doble faz encapsuladas x100",
    "Ancho (cm)": 9,
    "Alto (cm)": 5,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 18700,
  },
  {
    Pedido: "100 tarjetas 9x5 en papel kraft simple faz",
    Cantidad: 100,
    Material: "Tarjetas 9x5 kraft simple faz x100",
    "Ancho (cm)": 9,
    "Alto (cm)": 5,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 17600,
  },
  {
    Pedido: "100 tarjetas 9x5 en papel kraft doble faz",
    Cantidad: 100,
    Material: "Tarjetas 9x5 kraft doble faz x100",
    "Ancho (cm)": 9,
    "Alto (cm)": 5,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 24200,
  },

  // ── Modo ITEM — Tarjetas x500 (3 materiales; el simple faz y doble faz sin encapsular
  //    de x500 ya tienen caso) ─────────────────────────────────────────────────────────
  {
    Pedido: "500 tarjetas 9x5 simple faz",
    Cantidad: 500,
    Material: "Tarjetas 9x5 simple faz x500",
    "Ancho (cm)": 9,
    "Alto (cm)": 5,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 28000,
  },
  {
    Pedido: "500 tarjetas 9x5 simple faz encapsuladas",
    Cantidad: 500,
    Material: "Tarjetas 9x5 simple faz encapsuladas x500",
    "Ancho (cm)": 9,
    "Alto (cm)": 5,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 38000,
  },
  {
    Pedido: "500 tarjetas 9x5 doble faz encapsuladas",
    Cantidad: 500,
    Material: "Tarjetas 9x5 doble faz encapsuladas x500",
    "Ancho (cm)": 9,
    "Alto (cm)": 5,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 45000,
  },

  // ── Modo ITEM — Tarjetas x1000 (3 materiales; el simple faz encapsuladas de x1000 ya
  //    tiene caso) ─────────────────────────────────────────────────────────────────────
  {
    Pedido: "1000 tarjetas 9x5 simple faz",
    Cantidad: 1000,
    Material: "Tarjetas 9x5 simple faz x1000",
    "Ancho (cm)": 9,
    "Alto (cm)": 5,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 42000,
  },
  {
    Pedido: "1000 tarjetas 9x5 doble faz",
    Cantidad: 1000,
    Material: "Tarjetas 9x5 doble faz x1000",
    "Ancho (cm)": 9,
    "Alto (cm)": 5,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 54000,
  },
  {
    Pedido: "1000 tarjetas 9x5 doble faz encapsuladas",
    Cantidad: 1000,
    Material: "Tarjetas 9x5 doble faz encapsuladas x1000",
    "Ancho (cm)": 9,
    "Alto (cm)": 5,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 59000,
  },

  // ── Modo ITEM — papelería con paquete cerrado ───────────────────────────────────────
  {
    Pedido: "100 sobres impresos con el logo",
    Cantidad: 100,
    Material: "Sobres impresos x100",
    "Ancho (cm)": 21,
    "Alto (cm)": 11,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 25000,
  },
  {
    Pedido: "500 perforados",
    Cantidad: 500,
    Material: "Perforado x500",
    "Ancho (cm)": "",
    "Alto (cm)": "",
    "Piezas por unidad de cobro": "",
    "Precio correcto": 4000,
  },

  // ── Modo ITEM — sin medida ni paquete, escala por tramo o precio plano ─────────────
  {
    Pedido: "5 recetarios en negro",
    Cantidad: 5,
    Material: "Recetarios en negro",
    "Ancho (cm)": "",
    "Alto (cm)": "",
    "Piezas por unidad de cobro": "",
    "Precio correcto": 20000,
  },
  {
    Pedido: "5 recetarios en color",
    Cantidad: 5,
    Material: "Recetarios en color",
    "Ancho (cm)": "",
    "Alto (cm)": "",
    "Piezas por unidad de cobro": "",
    "Precio correcto": 22500,
  },
  {
    Pedido: "50 impresiones color A4 doble faz",
    Cantidad: 50,
    Material: "Impresión color A4 doble faz",
    "Ancho (cm)": 21,
    "Alto (cm)": 29.7,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 30000,
  },
  {
    Pedido: "10 impresiones color A3",
    Cantidad: 10,
    Material: "Impresión color A3",
    "Ancho (cm)": 29.7,
    "Alto (cm)": 42,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 12000,
  },
  {
    Pedido: "5 impresiones blanco y negro A3",
    Cantidad: 5,
    Material: "Impresión blanco y negro A3",
    "Ancho (cm)": 29.7,
    "Alto (cm)": 42,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 3000,
  },
  {
    Pedido: "20 impresiones en papel ilustración",
    Cantidad: 20,
    Material: "Impresión en papel ilustración",
    "Ancho (cm)": 21,
    "Alto (cm)": 29.7,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 16000,
  },
  {
    Pedido: "15 impresiones en opalina",
    Cantidad: 15,
    Material: "Impresión en opalina",
    "Ancho (cm)": 21,
    "Alto (cm)": 29.7,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 13500,
  },
  {
    Pedido: "5 anillados metálicos wire-o",
    Cantidad: 5,
    Material: "Anillado metálico wire-o",
    "Ancho (cm)": 21,
    "Alto (cm)": 29.7,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 16000,
  },
  {
    Pedido: "10 encuadernaciones abrochadas",
    Cantidad: 10,
    Material: "Encuadernación abrochada",
    "Ancho (cm)": 21,
    "Alto (cm)": 29.7,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 20000,
  },
  {
    Pedido: "3 encuadernaciones fresadas",
    Cantidad: 3,
    Material: "Encuadernación fresada",
    "Ancho (cm)": 21,
    "Alto (cm)": 29.7,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 15000,
  },
  {
    Pedido: "1 plastificado oficio",
    Cantidad: 1,
    Material: "Plastificado oficio",
    "Ancho (cm)": 22,
    "Alto (cm)": 33,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 2400,
  },
  {
    Pedido: "20 troquelados y corte a medida sobre unas cajitas ya impresas",
    Cantidad: 20,
    Material: "Troquelado y corte a medida",
    "Ancho (cm)": "",
    "Alto (cm)": "",
    "Piezas por unidad de cobro": "",
    "Precio correcto": 1000,
  },
  {
    Pedido: "20 numerados correlativos en unas entradas",
    Cantidad: 20,
    Material: "Numerado correlativo",
    "Ancho (cm)": "",
    "Alto (cm)": "",
    "Piezas por unidad de cobro": "",
    "Precio correcto": 100000,
  },
  {
    Pedido: "1 libro de medicina, el de Guyton",
    Cantidad: 1,
    Material: "Libros de medicina",
    "Ancho (cm)": "",
    "Alto (cm)": "",
    "Piezas por unidad de cobro": "",
    "Precio correcto": 30000,
  },
  {
    Pedido: "el pack de los 4 libros de medicina",
    Cantidad: 1,
    Material: "Pack 4 libros de medicina",
    "Ancho (cm)": "",
    "Alto (cm)": "",
    "Piezas por unidad de cobro": "",
    "Precio correcto": 99000,
  },
  {
    Pedido: "5 anotadores personalizados en negro",
    Cantidad: 5,
    Material: "Anotadores personalizados en negro",
    "Ancho (cm)": 10,
    "Alto (cm)": 15,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 20000,
  },
  {
    Pedido: "2 posters A3",
    Cantidad: 2,
    Material: "Posters A3 y A2",
    "Ancho (cm)": 29.7,
    "Alto (cm)": 42,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 3200,
  },
  {
    Pedido: "1 porta banner tipo X",
    Cantidad: 1,
    Material: "Porta banner tipo X",
    "Ancho (cm)": 90,
    "Alto (cm)": 190,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 32000,
  },
  {
    Pedido: "1 cartel de seguridad e higiene A3",
    Cantidad: 1,
    Material: "Cartelería en plástico corrugado A3",
    "Ancho (cm)": 29.7,
    "Alto (cm)": 42,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 10500,
  },
  {
    Pedido: "4 cartas plastificadas A4 para el menú",
    Cantidad: 4,
    Material: "Cartas y menús plastificados",
    "Ancho (cm)": 21,
    "Alto (cm)": 29.7,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 10400,
  },
  {
    Pedido: "1 cartel de precios A3 con plastificado",
    Cantidad: 1,
    Material: "Impresión color más plastificado",
    "Ancho (cm)": 29.7,
    "Alto (cm)": 42,
    "Piezas por unidad de cobro": "",
    "Precio correcto": 4800,
  },
];
