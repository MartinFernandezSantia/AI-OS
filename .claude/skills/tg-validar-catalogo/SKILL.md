---
name: tg-validar-catalogo
description: Revisa el catálogo de Terminal Gráfica (Catalogo-TG-cliente.xlsx) antes de mandarlo
  para integrar al bot. Usar cuando el usuario diga "revisá el catálogo", "está bien cargado",
  "chequeá la planilla", "validá el Excel", "¿puedo mandarlo?", o cuando termine de cargar
  productos, materiales o precios. Detecta los errores que rompen en silencio: materiales mal
  escritos, unidades sin fórmula, tramos con huecos o superpuestos, piezas que no entran en el
  pliego, geometría faltante. Solo diagnostica — las correcciones las hace el usuario en la planilla.
metadata:
  version: 1.0.0
---

Esta planilla es el catálogo que usa el bot de WhatsApp para cotizar. Los errores acá no
avisan solos: Excel no marca nada, la planilla se ve completa, y el bot simplemente cotiza
mal o no cotiza. Tu trabajo es leer las 4 hojas enteras y decir exactamente qué está mal,
dónde, y qué consecuencia tiene si se manda así.

**Vos revisás y explicás. Las correcciones las hacen ellos en la planilla — nunca edites el
archivo vos mismo, ni siquiera para "arreglar algo obvio".**

## Cómo abrir el archivo

Tres reglas, en este orden de importancia:

1. **Abrir SIEMPRE con `load_workbook(ruta)`. NUNCA con `data_only=True`.**
   `data_only=True` borra de forma **permanente** las ~598 fórmulas de la hoja oculta
   `_listas` (las que alimentan los desplegables de Colección y Material). El daño no se ve:
   los desplegables siguen mostrando la lista vieja, congelada, como si nada hubiera pasado.
   Pero desde ese momento ningún material ni colección nuevo vuelve a aparecer ahí. Esto está
   verificado en la práctica, no es una hipótesis — es la razón por la que esta regla existe.
2. La lista de materiales y colecciones válidos se lee de las hojas **Materiales** y
   **Colecciones**, nunca de `_listas` (ahí hay fórmulas, no valores legibles).
3. `_listas` es generada. No la abras, no la edites, no la "arregles".

## Qué NO se revisa

Esto no audita decisiones comerciales. Si suben un precio o retiran un producto, es su
negocio. Acá solo se miran inconsistencias, faltantes y duplicados — cosas que rompen el
cálculo, no cosas que cambian el precio.

## Las revisiones

Recorré las 4 hojas completas (Colecciones, Materiales, Productos, y la geometría dentro de
Materiales). Cada hallazgo va con: qué está mal · qué consecuencia tiene · cómo se corrige.

### Antes que nada

- **Hojas requeridas presentes**: Colecciones, Materiales, Productos. Si falta alguna, no
  sigas — decilo y listo.
- **`_listas` con fórmulas vivas**: si al abrir el archivo notás que las fórmulas de `_listas`
  ya no están (por ejemplo porque alguien lo guardó con `data_only=True` antes), es el error
  más caro de todos: los desplegables quedaron congelados con la lista vieja y nada de lo que
  se cargue desde ahora va a aparecer ahí. **No se arregla cargando de nuevo** — hay que
  regenerar la copia desde un archivo limpio. Avisá esto primero, antes que cualquier otra cosa.

### Materiales

Un material son N filas (una por tramo de precio), todas con el mismo nombre en la columna
Material. **Agrupá primero por nombre de Material antes de aplicar estas reglas** — varias de
ellas (Unidad, Modo de cálculo, geometría, Mínimo facturable) se cargan **una sola vez por
material**, típicamente en su primera fila, y quedan vacías en los tramos siguientes del mismo
material. Eso NO es un error de esos tramos: es tomar el valor de cualquier fila del grupo que
lo tenga cargado, no exigirlo fila por fila.

- **Sin Unidad**: ningún tramo del material tiene Unidad cargada. Sin unidad no hay forma de
  cobrarlo. Error.
- **Unidad o Modo de cálculo en "otro"**: la unidad tiene que empezar con "pliego", "m2" o
  "modelo", o ser exactamente una de: unidad, hoja, paquete, pack, item, metro lineal,
  talonario. Si usan la columna "Modo de cálculo", tiene que decir: proporcional, superficie,
  fijo o tramo total. Ojo con **"metro cuadrado"**: NO es lo mismo que "m2" (no empieza
  igual), así que cae en "otro" y queda sin fórmula, sin ningún aviso de Excel.
- **"Modo de cálculo" contradice la Unidad**: si la columna dice una cosa y el prefijo de la
  Unidad sugiere otra, avisalo (no es error — puede ser un cambio deliberado, pero hay que
  confirmarlo).
- **"Modo de cálculo" distinto entre tramos del mismo material**: como esta columna se lee del
  grupo (la gana la primera fila que la tenga cargada), un valor distinto en un tramo
  posterior no rompe nada hoy — pero es dato inconsistente: alguien cargó "tramo total" en el
  primer tramo y se olvidó de repetirlo en los siguientes, que quedaron en "proporcional".
  Avisalo igual, para que se cargue igual en las 22 filas del material.
- **Tramo sin precio o precio 0**: error directo.
- **"Hasta" vacío en un tramo que no es el último**: solo el último tramo puede quedar
  abierto. Si un tramo del medio lo tiene vacío, es un error de carga.
- **Tramos superpuestos** (ej. 1-10 y 5-20): se aplica el primero que coincide, que puede no
  ser el que querían. Error.
- **Hueco entre tramos** (ej. termina en 10, el siguiente arranca en 15): una cantidad ahí no
  matchea ningún tramo y no se puede cotizar. Error.
- **Último tramo con "Hasta" cerrado**: aviso, no error. Una cantidad mayor a ese tope no
  matchea nada. **Excepción**: si la fila tiene algo escrito en "Nota", probablemente sea
  deliberado (ej. "el proveedor no da precio para más de N unidades") — decilo como aviso
  informativo, no como algo a corregir.
- **Modo pliego sin geometría**: ninguna fila del material tiene "Área útil ancho/alto (cm)"
  cargada. Sin geometría no hay de dónde calcular cuántas piezas entran. Error.
- **Modo m2 sin "Mínimo facturable"**: ninguna fila del material la tiene cargada. Se va a
  cobrar la superficie exacta, sin piso mínimo. Aviso.
- **Modo m2 CON geometría cargada**: alguna fila del material sí tiene "Área útil ancho/alto"
  cargada. Hoy el cálculo por m2 ignora el área útil y la separación — esas celdas no hacen
  nada todavía (es el caso pendiente de los troquelados por m2). Aviso, para que sepan que no
  está teniendo efecto.

### Colecciones

- **Colección duplicada**: error.
- **Sin descripción**: es el texto que encabeza lo que lee el bot de esa familia de
  productos. Sin eso, aviso.
- **"Material base" que no existe en Materiales**: revisá que esté escrito igual, tildes
  incluidas. Error.

### Productos

- **Producto duplicado** (misma colección + mismo nombre): con dos filas iguales, el precio
  depende de cuál encuentre el bot primero. Error.
- **Sin colección, o colección que no existe en la hoja Colecciones**: el producto queda sin
  descripción. Error.
- **Sin material, o material que no existe en la hoja Materiales**: el producto queda **sin
  precio** y el bot no lo puede cotizar. Suele ser una letra o una tilde de diferencia —
  hay que elegirlo del desplegable, no escribirlo a mano. Error.
- **Pieza que no entra en el área útil** (rinde 0, ver fórmula abajo): no se puede cotizar en
  ninguna orientación. Error.

### Crecimiento

- Si alguna hoja va pasando el 80% de su tope de filas (Productos hasta 500, Materiales y
  Colecciones hasta 300), avisá. Pasado el tope los desplegables dejan de funcionar sin avisar.

## La fórmula del rinde

Necesaria para chequear la regla de "pieza que no entra". El rinde (cuántas piezas entran en
una unidad de cobro, ej. un pliego) sale de la geometría del material:

```
columnas × filas que entran = floor((útil + separación) ÷ (pieza + separación))
```
calculado en cada eje, **probando las dos orientaciones** de la pieza (acostada y parada), y
quedándose con la que rinde más.

Ejemplo: pieza de 12×8 cm, material con área útil 28×44 cm y separación 0,3 cm.
- Acostada: 28,3÷12,3 = 2 columnas × 44,3÷8,3 = 5 filas = **10**.
- Parada: 44,3÷12,3 = 3 columnas × 28,3÷8,3 = 3 filas = 9.
- Gana la acostada: rinde 10.

Si el rinde da 0 en las dos orientaciones, la pieza no entra: es error, se deriva a consulta,
nunca se inventa un rinde.

## Cómo se decide el modo

Seguí este orden exacto — es el que usa el motor, no lo simplifiques ni lo conviertas en una
tabla plana, porque el orden importa:

1. Si la columna **"Modo de cálculo"** tiene algo cargado:
   - empieza con "superficie" → **m2**
   - es exactamente "fijo" → **fijo**
   - es exactamente "tramo total" → **item**
   - empieza con "proporcional" → **no decide nada por sí sola**: seguí al paso 2 y dejá que
     el prefijo de la Unidad resuelva si es pliego o item. "Proporcional" es el valor que
     tiene casi toda la hoja — significa "el precio escala con la cantidad", no dice CUÁL es
     la unidad de esa cantidad.
   - cualquier otro texto → **otro** (error: valor de columna inválido)
2. Si no hay nada en "Modo de cálculo" (o dio "proporcional" y seguiste acá), mirá el
   **prefijo de la Unidad**, en minúsculas:
   - empieza con "pliego" → **pliego**
   - empieza con "m2" o "m²" → **m2**
   - empieza con "modelo" → **fijo**
   - empieza con una de estas palabras completas (seguida de espacio, coma, fin de texto,
     etc. — **no hace falta que sea la unidad entera**, alcanza con que arranque así):
     `unidad`, `hoja`, `paquete`, `pack`, `item`, `ítem`, `metro lineal`, `talonario`
     → **item**. Por eso "paquete de 100 tarjetas" y "talonario de 10 números" son item
     válidos: no hace falta escribir la palabra sola.
   - si no matchea nada de lo anterior → **otro** (error)

Los casos donde más se pierde plata en silencio son los que **casi** matchean y no matchean:

| Unidad | Da | Por qué |
|---|---|---|
| "pliego A3" | pliego | empieza con "pliego" |
| "m2 con laminado" | m2 | empieza con "m2" |
| "metro cuadrado" | **otro** | NO empieza con "m2" — es un error real, no un caso soportado |
| "paquete de 100 tarjetas" | item | empieza con la palabra completa "paquete" |
| "talonario de 10 números" | item | empieza con la palabra completa "talonario" |
| "talonarios" (plural, solo) | **otro** | "talonario" con "s" pegada no es la palabra completa
  seguida de límite — el plural sin nada más after no matchea el patrón |

Si la unidad nueva se cobra distinto a lo que ya existe, que **no empiece** con ninguna de las
palabras de arriba salvo que sea deliberadamente ese modo — se va a calcular con la fórmula
equivocada y sin ningún aviso de Excel.

## El informe

Armá el resultado con este formato, calcado del validador interno para que sea reconocible:

```
catálogo: <archivo>
N colecciones · N materiales (N tramos) · N productos

✗ ERRORES — hay que corregirlos antes de mandar (N)
   <Hoja> fila <N>: <qué pasa, qué consecuencia tiene, cómo se corrige>

⚠ avisos — conviene mirarlos (N)
   <Hoja> fila <N>: <...>
```

**Con un solo error, no se manda el archivo.** Los avisos no bloquean, pero hay que
mostrarlos igual — son el tipo de cosa que se nota recién cuando el bot ya está cotizando mal.

## Qué NO hacer

- No editar el Excel. Nunca. Ni para arreglar algo que parece obvio.
- No abrir el archivo con `data_only=True`, bajo ninguna circunstancia.
- No tocar ni leer la hoja `_listas`.
- No inventar un material parecido cuando el que escribieron no existe — eso se anota en la
  hoja Pendientes para que el proveedor del bot lo revise, no se fuerza la carga.
- No opinar sobre precios ni decisiones comerciales.
- No decir "está todo bien" sin haber recorrido las 4 hojas completas, fila por fila.
