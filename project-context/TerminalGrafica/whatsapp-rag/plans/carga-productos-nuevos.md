# Borrador de carga — productos nuevos al v3

> Estado: BORRADOR para revisar. Todavía no toca el Excel.
> Sale de `Catalogo_WhatsApp_Terminal_Grafica (1).xlsx` (entrega del cliente).
> Decisiones de esquema y alcance: `normalizar-catalogo-cliente.md`.

## Resumen

| | Cuánto |
|---|---|
| Colecciones nuevas | 8 |
| Productos `fijo` (precio cerrado) | 33 |
| Productos `escala` (escala propia) | 13 |
| Descartados | 8 |
| **Total a cargar** | **46 productos** |

Las 4 colecciones y 31 productos que ya existen NO se tocan. Su columna `Modo` queda
vacía = comportamiento actual (precio del material).

---

## 1. Colecciones nuevas

Descripción corta redactada por mí, para revisar. Sin `Material base`: todas tienen un solo
material o ninguno, y la columna solo importa cuando hay más de uno para elegir (verificado
en `chunk.ts` — con material único la línea se omite y no salta aviso).

| Colección | Descripción propuesta |
|---|---|
| Tarjetas personales | Tarjetas de presentación 9x5 cm, full color. Simple o doble faz, en papel ilustración o kraft 280 g, con opción encapsulada (plastificada de ambos lados). Se cotizan por cantidad cerrada: 100, 500 o 1000. |
| Papelería comercial | Papelería impresa con la marca del negocio: hojas membretadas, sobres, talonarios de factura o remito, notas de pedido, recetarios y carpetas institucionales. |
| Impresión digital | Impresión de archivos por hoja, en color o blanco y negro, A4 y A3. En papel obra, ilustración u opalina. El precio por hoja baja según la cantidad. |
| Encuadernación y terminaciones | Trabajos que se hacen sobre un impreso ya listo: anillado, wire-o, fresado, abrochado, laminado, plastificado, troquelado, ojalillos y numerado. Se cobran por unidad y no incluyen la impresión. |
| Folletería y editorial | Volantes, anotadores, apuntes y libros de estudio. |
| Gran formato y cartelería | Posters, banners roll-up y porta banners tipo X, listos para usar. |
| Señalética y punto de venta | Carteles de seguridad e higiene, cartas y menús plastificados, y carteles de precios para el local. |
| Eventos y sociales | Tarjetería para eventos: agradecimiento, invitaciones y afines. |

**A confirmar con vos**: "Tarjetas personales" y "Eventos y sociales" tienen el mismo
producto base (tarjeta 9x5 a $13.200). El cliente las separó por uso. Se puede dejar así o
fusionar.

---

## 2. Productos `Modo = fijo`

Precio cerrado para una cantidad. `Cantidad` = a cuántas unidades corresponde ese precio.
En todos, el cliente tenía `Mínimo` = `Múltiplo` = `Cant.`, o sea la cantidad ES el producto.

### Tarjetas personales (14)

| Producto | Precio | Cantidad |
|---|---|---|
| 100 tarjetas 9x5 cm simple faz | 13.200 | 100 |
| 100 tarjetas 9x5 cm simple faz encapsuladas | 16.500 | 100 |
| 100 tarjetas 9x5 cm doble faz | 16.500 | 100 |
| 100 tarjetas 9x5 cm doble faz encapsuladas | 18.700 | 100 |
| 100 tarjetas 9x5 cm en papel kraft 280 g simple faz | 17.600 | 100 |
| 100 tarjetas 9x5 cm en papel kraft 280 g doble faz | 24.200 | 100 |
| 500 tarjetas 9x5 cm simple faz | 28.000 | 500 |
| 500 tarjetas 9x5 cm simple faz encapsuladas | 38.000 | 500 |
| 500 tarjetas 9x5 cm doble faz | 38.000 | 500 |
| 500 tarjetas 9x5 cm doble faz encapsuladas | 45.000 | 500 |
| 1000 tarjetas 9x5 cm simple faz | 42.000 | 1000 |
| 1000 tarjetas 9x5 cm simple faz encapsuladas | 54.000 | 1000 |
| 1000 tarjetas 9x5 cm doble faz | 54.000 | 1000 |
| 1000 tarjetas 9x5 cm doble faz encapsuladas | 59.000 | 1000 |

Todas 9x5 cm. Sinónimos: `tarjetas personales, tarjetas de presentacion, tarjetas comerciales`.

### Papelería comercial (4)

| Producto | Precio | Cantidad | Medida |
|---|---|---|---|
| Hojas membretadas A4 | 35.000 | 500 | — |
| Sobres impresos | 25.000 | 100 | 21x11 |
| Talonarios de factura o remito | 54.000 | 10 | — |
| Notas de pedido y comandas | 54.000 | 10 | — |

**Ojo**: `Talonarios` traía como sinónimos `lona, banner, pancarta, cartel de lona,
gigantografia` — copiado de otra fila. Los saco.

### Folletería y editorial (6)

| Producto | Precio | Cantidad |
|---|---|---|
| Volantes A6 (10x15 cm) | 12.000 | 500 |
| Apuntes y material de estudio | 12.000 | 1 |
| ROSS Histología | 30.000 | 1 |
| LANGMAN Embriología Médica | 30.000 | 1 |
| GUYTON & HALL Fisiología | 30.000 | 1 |
| MOORE Anatomía Clínica | 30.000 | 1 |

**A decidir**: `Pack 4 libros de medicina` a $99.000. Es un combo de los 4 de arriba
(que sueltos suman $120.000). Entra como producto propio, o queda afuera por ser compuesto.
Mi voto: entra — no necesita cálculo, es un precio cerrado más.

### Gran formato y cartelería (2)

| Producto | Precio | Medida |
|---|---|---|
| Banner roll-up 85x200 cm | 38.000 | 85x200 |
| Porta banner tipo X 60x160 cm | 32.000 | 90x190 |

**Inconsistencia del cliente**: el porta banner se llama "60x160" pero tiene cargado
90x190. Hay que preguntarle cuál va.

Los 2 combos lona + portabanner ($61.360 y $65.200) quedan afuera por compuestos, como
se decidió.

### Señalética y punto de venta (1)

| Producto | Precio | Medida |
|---|---|---|
| Cartelería de seguridad e higiene | 10.500 | 29,7x42 (A3) |

### Eventos y sociales (1)

| Producto | Precio | Cantidad | Medida |
|---|---|---|---|
| Tarjetas de agradecimiento | 13.200 | 100 | 9x5 |

### Encuadernación y terminaciones (2)

| Producto | Precio | Cantidad |
|---|---|---|
| Numerado correlativo | 5.000 | 1 |
| Perforado y microperforado | 4.000 | 500 |

---

## 3. Productos `Modo = escala`

Van a la hoja nueva `Escalas por producto`. El motor es el mismo `tramoDe()` que ya usan
los materiales: solo cambia que el tramo se busca por unidades del producto, no por pliegos.

### Con escala confirmada por el cliente el 19/08/2026

| Producto | Escala (desde-hasta: $/unidad) |
|---|---|
| Sobres oficio inglés | 1-200: 250 · 201-500: 220 · 501-1000: 190 · 1001+: 180 |
| Carpetas institucionales sin laminar | 1-20: 2.600 · 21-50: 2.500 · 51-100: 2.300 · 101-300: 2.100 · 301+: 1.900 |
| Carpetas institucionales laminadas | 1-20: 3.000 · 21-50: 2.800 · 51-100: 2.600 · 101-300: 2.400 · 301+: 2.300 |

Las dos hojas de escalas del cliente coinciden exactamente en carpetas; la fechada
19/08/2026 ya trae la variante laminada desdoblada, que es lo que decidimos hacer.

### Impresión digital

| Producto | Escala |
|---|---|
| Impresión color A4 simple faz | 1-70: 400 · 71-150: 150 · 151-500: 80 · 501-2000: 70 |
| Impresión color A4 doble faz | 1-70: 600 · 71-150: 200 · 151-500: 120 · 501-2000: 110 |
| Impresión blanco y negro A4 simple faz | 1-10: 100 · 11-2000: 70 |
| Impresión blanco y negro A4 doble faz | 1-10: 150 · 11+: 96/88/86/84 ⚠ |

⚠ **La escala de b/n doble faz no cierra**: la nota da 5 precios (150/96/88/86/84) pero la
escala base tiene solo 2 tramos. Faltan los cortes. **Preguntar al cliente.**
Mientras tanto queda afuera.

Las de doble faz salen de desdoblar las notas, como decidimos.

### Con escala propia

| Producto | Escala |
|---|---|
| Anotadores personalizados en negro | 1-10: 4.000 · 11-20: 3.400 · 21-50: 3.000 · 51-100: 2.600 |
| Anotadores personalizados en color | 1-10: 4.500 · 11-20: 3.800 · 21-50: 3.200 · 51-100: 2.800 |
| Recetarios en negro | 1-10: 4.000 · 11-20: 3.400 · 21-50: 3.000 · 51-100: 2.600 |
| Recetarios en color | 1-10: 4.500 · 11-20: 3.800 · 21-50: 3.200 · 51-100: 2.800 |
| Imanes personalizados | 1-3: 8.500 · 4-10: 7.800 · 11-20: 7.200 |
| Encuadernación fresada | 1: 7.000 · 2-10: 5.000 |

Recetarios tiene nota "mínimo 5 unidades" — no hay dónde ponerlo hoy (el mínimo del Excel
es por importe, no por cantidad). Lo dejo anotado, va en la descripción por ahora.

`Libros con encuadernación fresada` y `Encuadernación fresada` tienen la MISMA escala e
ID distinto: es el mismo trabajo duplicado. Cargo uno solo.

### Precio plano por unidad (escala de un solo tramo)

Son los 15 que el cliente marcó `unidad`/`hoja` sin escala. Van como `escala` de un tramo
(1 a ∞) para no inventar un cuarto modo:

| Producto | $/unidad |
|---|---|
| Anillado plástico | 2.400 |
| Anillado metálico wire-o | 3.200 |
| Encuadernación abrochada a caballo | 2.000 |
| Laminado mate | 330 |
| Laminado brillante | 330 |
| Plastificado de documentos | 2.200 |
| Troquelado y corte a medida | 50 |
| Colocación de ojalillos | 1.000 |
| Impresión color A3 laser | 1.200 |
| Impresión blanco y negro A3 | 600 |
| Impresión en papel ilustración | 800 |
| Impresión en opalina | 900 |
| Posters A3 y A2 | 1.600 |
| Cartas y menús plastificados | 2.600 |
| Carteles de precios y ofertas | 4.800 |

**Alternativa**: darles `Modo = fijo` con `Cantidad = 1`. Es más simple de cargar pero
miente en el chunk ("el precio es $2.400 por 1 unidad" vs "$2.400 cada uno"). Prefiero
la escala de un tramo. **Decidilo vos.**

---

## 4. Descartados (8)

| Producto | Por qué |
|---|---|
| Stickers troquelados $6.600 | Ya lo calculamos (pliego) |
| Etiquetas para frascos $11.000 | Ya lo calculamos (pliego) |
| Stickers holográficos $9.000 | Ya lo calculamos (pliego) |
| Fotocopias | ID `FOTOCOPIAS-NO`: es lo único que TG no trabaja |
| Planchas de stickers A4 | Compuesto (medio corte + hoja) |
| Lona 1,9x0,9 + porta banner 2 velas | Compuesto |
| Lona 2x0,85 + porta banner roll up | Compuesto |
| Libros con encuadernación fresada | Duplica `Encuadernación fresada` |

---

## 5. Casos de prueba nuevos

Dos tipos, como pediste:

**Contra el ejemplo ya comprobado** — la cantidad exacta que el cliente tiene cargada.
Verifica que el precio pasa tal cual:

| Caso | Esperado |
|---|---|
| 100 tarjetas 9x5 simple faz | 13.200 |
| 500 tarjetas 9x5 doble faz | 38.000 |
| 1000 tarjetas 9x5 simple faz encapsuladas | 54.000 |
| 500 hojas membretadas A4 | 35.000 |
| 10 talonarios de factura | 54.000 |
| 500 volantes A6 | 12.000 |
| 1 banner roll-up 85x200 | 38.000 |
| 250 sobres oficio inglés | 55.000 (250 x 220 — el propio cotizador del cliente lo da) |

**Contra cantidades nuevas** — cantidades que el cliente NO tiene cargadas. Verifica que
el motor de escala elige bien el tramo:

| Caso | Cálculo | Esperado |
|---|---|---|
| 150 sobres oficio inglés | 150 x 250 (tramo 1-200) | 37.500 |
| 600 sobres oficio inglés | 600 x 190 (tramo 501-1000) | 114.000 |
| 1200 sobres oficio inglés | 1200 x 180 (tramo 1001+) | 216.000 |
| 30 carpetas institucionales sin laminar | 30 x 2.500 (tramo 21-50) | 75.000 |
| 30 carpetas institucionales laminadas | 30 x 2.800 (tramo 21-50) | 84.000 |
| 200 impresiones color A4 simple faz | 200 x 80 (tramo 151-500) | 16.000 |
| 15 anotadores en color | 15 x 3.800 (tramo 11-20) | 57.000 |
| 5 imanes personalizados | 5 x 7.800 (tramo 4-10) | 39.000 |
| 40 anillados plásticos | 40 x 2.400 (tramo único) | 96.000 |

**Y un caso de borde por cada frontera de tramo**, que es donde un motor de escalas falla:

| Caso | Por qué | Esperado |
|---|---|---|
| 200 sobres oficio inglés | último del tramo 1-200 | 50.000 |
| 201 sobres oficio inglés | primero del 201-500 | 44.220 |
| 20 carpetas sin laminar | último del 1-20 | 52.000 |
| 21 carpetas sin laminar | primero del 21-50 | 52.500 |

El par 20/21 de carpetas es el más valioso: 21 carpetas cuestan MÁS que 20 aunque el
precio unitario baje. Si el motor se equivoca de tramo, salta acá.

⚠ Todos los esperados de arriba asumen que **el redondeo a $100 y el mínimo por trabajo de
$4.000 aplican igual que hoy**. Hay que confirmarlo: el mínimo tiene sentido para un
trabajo de imprenta, pero "1 laminado a $330" caería a $4.000 y eso está mal.
**Esto hay que resolverlo antes de cargar.**

---

## Qué falta decidir antes de cargar

1. **El mínimo de $4.000 no puede aplicar a las terminaciones.** Un laminado de $330 o un
   ojalillo de $1.000 no son un trabajo completo: son un extra sobre otro trabajo. Hay que
   decidir si el mínimo se marca por producto, por colección, o si estos van exentos.
2. **Precio plano**: ¿escala de un tramo (mi voto) o `fijo` con cantidad 1?
3. **`Pack 4 libros`**: ¿entra?
4. **Porta banner tipo X**: el nombre dice 60x160, la medida dice 90x190. Preguntar a TG.
5. **B/N A4 doble faz**: la escala de la nota no cierra con los tramos. Preguntar a TG.
6. **Tarjetas personales vs Eventos y sociales**: ¿colecciones separadas o una?
