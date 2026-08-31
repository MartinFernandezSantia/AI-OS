// Casos para las unidades de cobro que son una MEDIDA CONTINUA (metro lineal), no una cosa
// contable. Los dos casos que ya había del escaneo usan cantidades ENTERAS (1 y 3 metros),
// y con eso el gate no distinguía "3 metros" de "3 piezas": el paso donde se rompe quedaba
// afuera del test por construcción.
//
// El bug real (ejecución 345): el cliente pidió 2,45 metros, el modelo declaró `cantidad: 1`
// —para él 2,45 metros de planos es UN trabajo— y el bot cobró $8.000 en vez de $19.600.
// El auditor no lo vio: 1 × $8.000 es internamente coherente. Cobrar de menos en silencio.
//
// Verificado contra el motor: 2,45 × $8.000 = $19.600 (el redondeo a $100 lo deja igual).
export const CASOS_MEDIDA_CONTINUA = [
  {
    Pedido: "escaneo de 2,45 metros de planos (medida con decimales)",
    Cantidad: 2.45,
    Material: "Escaneo de planos",
    "Ancho (cm)": "",
    "Alto (cm)": "",
    "Piezas por unidad de cobro": "",
    "Precio correcto": 19600,
  },
  {
    // Media unidad: cae por debajo del "Desde 1" del único tramo y lo levanta el mínimo por
    // trabajo. Fija que un pedido chico de medida continua no se cotice como 1 metro entero.
    Pedido: "escaneo de 0,5 metros de planos (activa el mínimo por trabajo)",
    Cantidad: 0.5,
    Material: "Escaneo de planos",
    "Ancho (cm)": "",
    "Alto (cm)": "",
    "Piezas por unidad de cobro": "",
    "Precio correcto": 4000,
  },
];
