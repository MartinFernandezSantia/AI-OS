// LOS DATOS de los 5 productos nuevos para los papeles offset por pliego que quedaron
// huérfanos en la carga del catálogo v4: tenían precio y geometría cargados en Materiales
// (modo `pliego A3+`, 31x46 cm) pero ningún producto los usaba, así que no generaban chunk
// y el bot no podía cotizarlos. Confirmado con Martín (2026-09-04): son un producto real,
// "Impresión offset por pliego", agrupado en la colección "Impresión digital" (su
// descripción ya menciona "papel obra, ilustración u opalina"). La medida de referencia es
// el pliego completo (31x46), igual al área útil del material: no hay una pieza chica
// natural como con los stickers, el producto ES el pliego.
export const PRODUCTOS = [
  { coleccion: "Impresión digital", producto: "Impresión offset en papel obra 80 gr", material: "Obra 80 gr", medida: [31, 46], descripcion: "Impresión offset de gran tirada en papel obra 80 gr, por pliego. El precio baja según la cantidad de pliegos.", sinonimos: "offset, imprenta offset, tirada grande, papel obra" },
  { coleccion: "Impresión digital", producto: "Impresión offset en papel ilustración brillo 150 gr", material: "Ilustracion brillo 150 gr", medida: [31, 46], descripcion: "Impresión offset en papel ilustración brillo 150 gr, por pliego. Más grueso y con terminación satinada que el obra." },
  { coleccion: "Impresión digital", producto: "Impresión offset en papel ilustración mate 240 gr", material: "Ilustracion mate 240 gr", medida: [31, 46], descripcion: "Impresión offset en papel ilustración mate 240 gr, por pliego. Terminación mate, más rígido." },
  { coleccion: "Impresión digital", producto: "Impresión offset en papel ilustración mate 300 gr", material: "Ilustracion mate 300 gr", medida: [31, 46], descripcion: "Impresión offset en papel ilustración mate 300 gr, por pliego. El más rígido de los ilustración mate." },
  { coleccion: "Impresión digital", producto: "Impresión offset en opalina 240 gr", material: "Opalina 240 gr", medida: [31, 46], descripcion: "Impresión offset en papel opalina 240 gr, por pliego. Papel rígido y liso, para certificados y diplomas en tirada grande." },
];
