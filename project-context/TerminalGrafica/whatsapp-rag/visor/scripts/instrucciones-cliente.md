# CÓMO CARGAR PRODUCTOS NUEVOS

Esta planilla es el catálogo que usa el bot de WhatsApp para cotizar.
Lo que carguen acá es lo que el bot va a poder responder.

No tiene precios cerrados por cantidad: tiene el framework para calcular cualquier cantidad.
Cada producto dice de qué material se hace, y el precio sale del material.

## LAS HOJAS Y PARA QUÉ SIRVEN

Colecciones — las familias de productos. Su descripción encabeza el bloque que lee el bot.
Productos   — lo que se ofrece. La cantidad NO va acá: la pide el cliente.
Materiales  — precios y tramos. Un material sin escala por volumen = un solo tramo.
_listas     — hoja OCULTA y AUTOMÁTICA. Se llena sola con lo que carguen en Materiales y
              en Colecciones. NO la abran ni escriban en ella: si escriben ahí, los
              desplegables dejan de actualizarse.

## EL ORDEN IMPORTA: colección → material → producto

Las columnas Colección y Material de la hoja Productos son DESPLEGABLES. Solo ofrecen valores
que ya existen. Si cargan el producto primero, el desplegable no va a tener qué ofrecerles.

## EJEMPLO COMPLETO: producto nuevo, material nuevo, colección nueva

Pedido: "agregar imanes de heladera 8x5 cm, se hacen en imán flexible, $18.000 el m2, mínimo 0,3 m2".

PASO 1 — Colección nueva. En la hoja Colecciones, primera fila libre:
>    Colección:   Imanes
>    Descripción: Imanes flexibles impresos full color, cortados con forma. Para heladera,
>                 pizarras y superficies metálicas. Se cotizan por metro cuadrado.
>    La descripción es lo que lee el bot: que se entienda sola, sin nombrar otras colecciones.

PASO 2 — Material nuevo. En la hoja Materiales, primera fila libre:
>    Material: Imán flexible | Unidad: m2 | Desde: 1 | Hasta: (vacío)
>    Precio por unidad: 18000 | Mínimo facturable: 0,3 | Nota: confirmado el 26/08/2026

PASO 3 — Producto. En la hoja Productos, primera fila libre:
>    Colección: Imanes (ya aparece en el desplegable) | Producto: Imán 8x5 cm
>    Descripción: Imán flexible impreso full color, cortado con forma.
>    Material: Imán flexible | Ancho: 8 | Alto: 5

## QUÉ COLUMNAS SON OBLIGATORIAS

Depende del modo del material, y es al revés en cada uno:
>    Modo pliego → el MATERIAL necesita 'Área útil ancho/alto (cm)' y 'Separación (cm)';
>                  no lleva mínimo facturable. El producto deja el rinde VACÍO: se calcula.
>                  'Piezas por unidad de cobro' se carga SOLO para unidades no geométricas.
>    Modo m2     → el MATERIAL necesita 'Mínimo facturable'. El producto deja el rinde vacío.

Una columna vacía no es un error: es lo que hace que el bot no vea datos que no corresponden.

## CÓMO SE ESCRIBE UNA ESCALA DE PRECIOS

Un material = una o más filas en Materiales, todas con el MISMO nombre en la columna Material.
>    Precio fijo, sin descuento por volumen → UNA fila: Desde 1, Hasta vacío.
>    Con descuento por volumen → una fila por tramo. Desde/Hasta sin huecos ni superposiciones.
>    El último tramo va con Hasta VACÍO: significa 'de acá en adelante'.
>    Ejemplo de escala: 1 a 1 → 2500 · 2 a 10 → 2200 · 11 a 50 → 2000 · 101 a (vacío) → 1710

## DE DÓNDE SALE EL RINDE ("Piezas por unidad de cobro")

Ya NO se carga a mano para los pliegos. La geometría se declara UNA vez por material en
la hoja Materiales ('Área útil ancho/alto (cm)' y 'Separación (cm)') y el rinde se
calcula solo: el bot lo resuelve para cualquier medida que pida el cliente.
>    Troquelado o medio corte: área útil 28 x 44 cm, separación 0,3 cm.
>    Solo impresión:           área útil 31 x 46 cm, separación 0.

La columna 'Piezas por unidad de cobro' queda SOLO para unidades no geométricas — una
bobina, una plancha — donde el rinde es dato del taller, no geometría. Si se carga,
manda sobre el cálculo.

## CUIDADO CON LOS NOMBRES PARECIDOS

El modo se decide por cómo EMPIEZA la unidad, no por el nombre completo:
>    'pliego A3', 'pliego A4', 'pliego doble' → todas caen en modo pliego.
>    'm2', 'M2', 'm2 con laminado'            → todas caen en modo m2.

Si su unidad nueva se cobra distinto, NO la llamen empezando con 'pliego' ni con 'm2':
se va a calcular con la fórmula equivocada y sin ningún aviso.
>    'metro cuadrado' NO es lo mismo que 'm2': no empieza igual, así que no entra en modo m2
>    y queda sin fórmula. Para metros cuadrados escriban siempre 'm2'.

## UNA FORMA DE COBRO NUEVA: AVISENNOS

Hoy el archivo sabe cobrar por pliego, por m2 y por unidad suelta.
Si necesitan cobrar de una manera que hoy no existe (por hora, por metro lineal, por kilo),
NO lo carguen: avisennos. Hay que escribir la fórmula del cálculo de nuestro lado, y sin eso
el bot no sabe pasar de lo que pide el cliente al total, y va a improvisar.

## TROQUELADOS POR M2: TODAVÍA NO

Si un material se cobra por m2 y va TROQUELADO (necesita separación entre las piezas),
avisennos en vez de cargarlo. El sistema todavía no sabe tener en cuenta esa separación
cuando el cobro es por m2, así que cotizaría de menos sin avisar.
>    Es el caso de los imanes troquelados. Estamos trabajando en eso.

## ERRORES QUE ROMPEN EN SILENCIO

- Escribir el material a mano con una letra distinta a la de Materiales: el producto queda sin precio.
- Escribir "metro cuadrado" en vez de "m2": no entra en modo m2 y el material queda sin fórmula.
- Material de modo pliego sin geometría: no hay de dónde calcular el rinde y el bot no puede cotizarlo.
- Pieza más grande que el área útil: no entra. Se deriva a consulta, nunca se inventa.
- Tramos superpuestos (1-10 y 5-20): se aplica el primero que coincide, y puede no ser el que querían.
- Cargar un producto en una colección que no existe en la hoja Colecciones: queda sin descripción.

## QUÉ NO TOCAR

Para que podamos integrar lo que carguen, la estructura tiene que quedar igual:
- No renombrar ni borrar hojas.
- No mover, renombrar ni borrar columnas.
- No tocar los títulos de la fila 1 de cada hoja.
- No abrir ni escribir en la hoja oculta _listas.

Agregar filas, editar precios y borrar productos que ya no hacen: todo eso está bien.

## LÍMITES DE CRECIMIENTO

El archivo tiene lugar de sobra, pero no infinito. Los topes de hoy:
>    Productos:   hasta la fila 500
>    Materiales:  hasta la fila 300
>    Colecciones: hasta la fila 300

Pasado el tope los desplegables dejan de funcionar SIN AVISAR. Si se están acercando
(digamos, pasando la fila 400 de Productos), avisennos y lo extendemos nosotros.
NO toquen los rangos de Datos → Validación por su cuenta.

## SI TRABAJAN ESTE ARCHIVO CON CLAUDE

Estas tres reglas son para Claude, no para ustedes. Si le pasan el archivo por chat,
convienen que estén a la vista:

>    1. Abrir SIEMPRE con load_workbook(ruta). NUNCA con data_only=True: eso borra de forma
>       permanente las fórmulas de la hoja _listas y rompe los desplegables, sin ningún error
>       visible.
>    2. La lista de materiales válidos se lee de la hoja Materiales, NO de la hoja _listas
>       (en _listas hay fórmulas, no valores).
>    3. La hoja _listas es generada: no leerla, no escribirla, no "arreglarla".

## DESPUÉS DE EDITAR

Guarden el archivo y mándennoslo. Nosotros lo revisamos y lo integramos al catálogo del bot.
Los cambios NO llegan al bot hasta ese momento: mientras tanto sigue atendiendo con el
catálogo anterior, así que pueden cargar tranquilos.
