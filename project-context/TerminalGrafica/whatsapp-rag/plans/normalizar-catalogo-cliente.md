# Plan — normalizar el catálogo del cliente hacia el nuestro

> Estado: APROBADO en lo grande (alcance y decisiones), sin construir.
> Fuente de verdad: `Catalogo-TG-v2.xlsx` (el NUESTRO). El archivo del cliente
> (`Catalogo_WhatsApp_Terminal_Grafica (1).xlsx`) es una entrega de datos por única vez.

## La dirección

**Normalizamos hacia nuestro Excel, no al revés.** El del cliente lo armó con Claude sin las
instrucciones de nuestro esquema, así que trae cosas cambiadas de nombre, columnas pensadas
para otra cosa, y decisiones que no aplican. De ahí sacamos dos cosas:

1. **Datos**: productos nuevos con su precio y de qué material sale.
2. **Aprendizajes**: qué le falta a nuestro esquema para que TG pueda seguir cargando sin que
   nosotros lo rehagamos.

Después de esta pasada, el cliente carga en NUESTRO Excel. Este archivo no se vuelve a usar.

## Alcance de esta pasada

**Entra**: lo cotizable — `pliego`, `m2` (ya andan), `fijo`, `unidad`, `hoja`, `metro lineal`.

**Queda afuera** (decidido, no olvidado):
- `no` (37 productos) y `consultar` (31). No son cálculo: son respuestas de texto. Se ven
  aparte, como tema propio.
- Filas sin precio. No entran al catálogo.
- Los 4 productos compuestos (`Planchas de stickers A4` = medio corte + hoja; los 2 combos
  lona + portabanner). Pocos y ninguno es de los que más se piden.
- Columnas del cliente que no usamos: `ID`, `Plazo`, `Archivo que manda el cliente`,
  `Respuesta corta para WhatsApp`, `Precio actualizado`.
- `Plazo`: se sigue confirmando en el momento, no se carga.

**Se guarda sin usar todavía**: `No confundir con` (el cliente la agregó porque en sus pruebas
el bot recomendaba algo que no era). Puede servir; hoy no tiene destino.

## Lo que encontramos en el archivo del cliente

179 productos en la hoja `Lista de precios`, con columna `Modo`:

| Modo | Filas | Estado |
|---|---|---|
| `fijo` | 39 | entra (menos 4 duplicados) |
| `no` | 37 | afuera |
| `consultar` | 31 | afuera |
| `m2` | 26 | ya lo tenemos |
| `pliego` | 20 | ya lo tenemos |
| `unidad` | 18 | entra |
| `hoja` | 7 | entra |
| `metro lineal` | 1 | entra |

### Los 20 `pliego` y los 6 de vinilo UV coinciden BIT A BIT con los nuestros

Mismos precios, misma geometría (28x44, sep 0,3), mismos tramos. La hoja `Pliegos A3` del
cliente es nuestra hoja `Materiales` con otro nombre. Cero cambios ahí.

### Un cambio de tarifa real

`Vinilo y lona UV`: **$21.000 → $22.000** el m² (confirmado 18/08/2026 en el archivo).
Mueve 4 de nuestros casos de prueba:

| Caso | Antes | Ahora |
|---|---|---|
| Cartel adhesivo 50x70 | $10.500 | $11.000 |
| Cartel adhesivo 70x100 | $14.700 | $15.400 |
| Vinilo vidriera 1x1 m | $21.000 | $22.000 |
| Vinilo vidriera 1x2 m | $42.000 | $44.000 |

Los rígidos ($30.000) y las lonas ($16.000) no cambian.

**Ojo**: el propio archivo quedó inconsistente — la fila de `Vinilo UV troquelado` sigue
diciendo en su nota "vinilo y lona UV ($21.000) más $7.000 de troquelado", pero la tarifa de
arriba dice $22.000. El cliente cambió el número sin actualizar la nota que lo deriva.

### `fijo` = precio que no se calcula

Precio cerrado para una cantidad. 100 tarjetas cuestan $13.200, y 500 **no** son cinco veces
eso ($28.000). No hay fórmula: se le da tal cual al cliente.

En todas las filas `Mínimo` = `Múltiplo` = `Cant.` — o sea, la cantidad ES el producto.
También cubre trabajos sin medida: colocación de ojalillos no tiene tamaño, es el trabajo.

**4 filas se descartan por duplicar productos que ya cotizamos calculando**: `Stickers
troquelados` ($6.600), `Etiquetas para frascos` ($11.000), `Stickers holográficos` ($9.000).
Ya existen como `pliego`.

### `unidad` y `hoja` mezclan DOS cosas

De los 26 productos, solo **11 tienen escala** (en las hojas `Escalas` y `Escalas por unidad`).
Los otros 15 son **precio plano por unidad**: anillado $2.400, laminado $330, ojalillos
$1.000, plastificado $2.200, impresión A3 $600. La columna `Modo` no los distingue — hay que
mirar si el producto aparece en alguna hoja de escalas.

### Variantes escondidas en notas ← DECIDIDO: se desdoblan

El cliente metió escalas enteras dentro del campo `Nota`:

```
Impresión color A4 | 1-70 $400 · 71-150 $150 · ... | Nota: "Doble faz: 600/200/120/110"
Carpetas           | 1-20 $2.600 · ...             | Nota: "Laminadas: 3000/2800/2600/2400/2300"
Anotadores         | 1-10 $4.000 · ...             | Nota: "En color: 4500/3800/3200/2800"
Recetarios negro   | 1-10 $4.000 · ...             | (y "Recetarios en color" ya es fila propia)
```

Son productos distintos con su propia escala. **Se desdoblan en filas de verdad** ("Impresión
color A4 doble faz", "Carpetas institucionales laminadas", "Anotadores personalizados en
color"), cada una con su escala completa. Más trabajo de carga, pero el bot las cotiza y el
cliente las ve explícitas en la planilla.

## Cambios propuestos a NUESTRO Excel

El cambio de fondo: hoy **el precio sale siempre del material**. Los productos nuevos tienen
precio propio y muchos no tienen material. Hay que aflojar esa regla sin romper lo que anda.

### 1. `Productos` suma columna `Modo`

| Valor | Significa |
|---|---|
| *(vacío)* | Como hoy: el precio sale del material (pliego/m2). No rompe nada de lo existente. |
| `fijo` | El precio está en el producto. No se calcula. |
| `escala` | El producto tiene su propia escala por cantidad (hoja nueva). |

Vacío = comportamiento actual, así que las 31 filas que ya andan no se tocan.

### 2. `Productos` suma `Precio` y `Cantidad`

- `Precio`: solo para `fijo`. Es el número que se le da al cliente.
- `Cantidad`: qué cantidad cubre ese precio (100 tarjetas, 500 hojas membretadas, 10
  talonarios). Para los trabajos sin cantidad (ojalillos, numerado) va 1.

### 3. Hoja nueva `Escalas por producto`

Misma forma que `Materiales` pero indexada por producto:

```
Producto | Desde | Hasta | Precio por unidad | Nota
Sobres oficio inglés | 1 | 200 | 250 |
Sobres oficio inglés | 201 | 500 | 220 |
...
```

El motor que ya existe (`tramoDe()` del auditor) sirve tal cual: solo cambia en qué unidad se
busca el tramo (piezas u hojas en vez de pliegos).

### 4. `Productos` suma `Sinónimos`

Cómo lo pide el cliente ("calcos, pegatinas, autoadhesivos"). Hoy `chunk.ts` ya emite las
columnas desconocidas como extras, así que entraría al chunk sin tocar código — pero conviene
que sea una columna de primera clase.

Útil sobre todo cuando el sinónimo es muy distinto del nombre del producto.

### Lo que NO cambia

- `Múltiplo`: si el nombre del producto ya trae la cantidad ("100 tarjetas"), es redundante.
  No se agrega.
- `Mínimo`: ya lo tenemos, funciona igual.

## Qué falta decidir

- **Colecciones**: el cliente tiene 16 (12 nuevas), nosotros 4. Hay que normalizar nombres y
  decidir cuáles entran. Las nuevas vienen sin descripción ni material base.
- **Casos de prueba**: el archivo del cliente no trae ninguno. Nuestro gate de 46/46 no puede
  correr sobre los productos nuevos hasta que se escriban.
- **Los 68 de `no` + `consultar`**: quedaron afuera de esta pasada, pero son más de un tercio
  del catálogo y el cliente los marcó como "la regla más importante". Tema propio.
- **Límites de producción**: el archivo trae lona máx 1,52 m y vinilo máx 1,48 m de ancho.
  Hoy el bot cotizaría una lona de 3 m sin avisar que va con empalme. No tiene dónde ir en
  nuestra hoja `Parámetros`.

## Gotchas del archivo del cliente

- **La hoja `Lista de precios` tiene el encabezado en la fila 16**, no en la 1. Arriba hay
  tarifas por m2 y notas sueltas. Un parser que asuma fila 1 lee basura.
- **Hojas que son material de trabajo, no datos**: `Presupuestos (crudo)` (líneas de PDFs
  reales), `Productos reales` (8 productos extraídos de esos PDFs), `Lista maestra` (catálogo
  genérico de "lo que puede hacer una gráfica", 127 filas de las que solo 10 tienen respuesta
  en `¿Lo ofrezco?`).
- **`Productos` (150 filas) y `Lista de precios` (179) se solapan pero no coinciden.** La
  primera es la vista "vidriera" de WhatsApp Business (nombre, precio, SKU, foto); la segunda
  es la que tiene el modo y el cálculo. Para normalizar, la fuente es `Lista de precios`.
- **La hoja `Instrucciones` no es la fórmula de cotización**: es la guía para cargar el
  catálogo de WhatsApp Business (límite 500 ítems, fotos 1:1, revisión de Meta). No reemplaza
  nuestra PARTE 1.
