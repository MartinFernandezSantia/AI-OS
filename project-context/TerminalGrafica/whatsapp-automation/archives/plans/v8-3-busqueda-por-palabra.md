# v8.3 — Búsqueda por palabra + filtro con la conversación

> Diseño pedido por Martin (2026-07-27) para reemplazar "el LLM elige el nombre exacto" por
> "el LLM tira palabras, Postgres busca, un segundo LLM filtra". **Medido antes de construir**,
> con el export fresco del 2026-07-27 (schema 2, 88 productos / 185 variantes), por dos lentes
> Sonnet. Nada construido todavía.

---

## 1. El pipeline

```
Extraer palabras (LLM 1)  →  Buscar por token (Postgres)  →  Filtrar (LLM 2, + conversación)
   →  Get Precio de los elegidos  →  Redactar (compositor)
```

**Por qué es mejor que lo que hay.** El LLM viene acertando el sustantivo y errando el eje: los
cuatro confident-wrong de la ronda del 27 fueron todos "eligió una variante que el cliente nunca
nombró". Tokenizar lo que ya emite aprovecha lo que hace bien y descarta lo que hace mal, **sin
agregar una llamada** (el LLM 1 ya existe). Y a diferencia de la opción C que yo había propuesto,
**un error del LLM no deja al cliente sin respuesta**: lo que llega es una lista de más, no vacía.

**Fail-safe, y esto es lo que la hace aceptable:** cada paso degrada hacia "de más", nunca hacia
"nada". Si el LLM 1 tira una palabra mala, el SQL trae ruido y el LLM 2 lo poda. Si el LLM 2 se
equivoca podando, quedan opciones de más y el cliente elige. La única forma de que el cliente no
reciba nada es que el SQL devuelva cero filas — y ahí ya existe el Aclarador.

---

## 2. Lo que midió la lente de cobertura

Tokenizado como lo hace el bot (minúsculas, sin acentos, frontera de palabra), buscando contra
`nombre_canonico + nombre_vivo + sinonimos_efectivos`, sobre los 10 casos reales de la ronda.

**La buena:** cuando el string trae una palabra distintiva del rubro, la búsqueda es quirúrgica.

| caso | candidatos | ¿está el esperado? |
|---|---|---|
| "cuánto sale anillar" → `anillado` | **6** | sí, los 3 visibles + 3 ocultos por plazo |
| "me hacen fotocopias?" → `IMPRESIONES` | **3** | sí, exacto |
| "Precio de las rifas?" → `Talonarios Rifas 100 numeros` | **3** | sí |
| "un cartel de 1x0.65" → `Carteleria en plástico corrugado` | 10 | sí |
| "una lona de 3x2" → `Lona Mate` | 15 | sí, **y NO aparece Talonarios Rifas** (la frontera de palabra aguanta) |

**La mala: el token `papel` está en 30 de los 88 productos**, y muchos nombres reales lo llevan
adentro (`Impresiones papel obra 75 gr`, `Papel Kraft 130 Gr`). Cuando el string del LLM lo
incluye, la lista explota:

| caso | candidatos | comentario |
|---|---|---|
| "papel kraft a4" | **31** | los 2 kraft están, y 27 productos que no tienen nada que ver |
| "el papel no sé, normal" | **42** | obra 75 y obra 106 compiten bien… entre 40 ajenos |
| "papel ilustración para 500 folletos" | **46** | **más de la mitad del catálogo** |

**Los 15 tokens más frecuentes**, y cuántos productos trae cada uno: `papel` 30 · `de` 23 ·
`gr` 18 · `a4` 15 · `brillo` 12 · `negro` 11 · `mate` 11 · `impresion` 10 · `color` 10 ·
`plastico` 10 · `para` 10 · `obra` 10 · `cm` 10 · `grande` 9 · `a3` 7.

**Conclusión operativa: un token que aparece en un tercio del catálogo no puede valer lo mismo que
`kraft`.** La búsqueda necesita ponderar por rareza, no sólo matchear. Sin eso el LLM 2 recibe 46
ítems y vuelve a elegir por intuición, que es el bug que estamos arreglando.

---

## 3. Lo que confirmó la hipótesis de Martin: los invisibles

`OBRA 80 GR` y `OBRA 106 GR` **no aparecen** ante *"fotocopias a color"* ni *"imprimir hojas a
color"* — verificado, no inferido. Sus sinónimos son todos del tipo "papel obra 106 gramos":
ninguno contiene un verbo de pedido.

**19 productos sólo son encontrables por sinónimo.** De esos, **6 de riesgo alto**, donde ni el
nombre ni los sinónimos cubren la forma natural de pedirlos:

| producto | por qué no se encuentra | qué falta |
|---|---|---|
| `OBRA 106 GR` | ninguna palabra de pedido en el nombre | sinónimos con verbo: imprimir, impresión, fotocopia, hoja |
| `OBRA 80 GR` | ídem | ídem |
| `OPP Mate/Holografico/Plata/Crystal/Glitter/Kraft` | sólo el término técnico "opp" | "plástico brillante", "para regalo" |
| `Microperforado` | nadie pide "microperforado" sin conocerlo | "para vidriera", "que se ve de un lado" |
| `Folios a4/Oficio` | "folio" se usa poco fuera del rubro | "funda", "cubierta plástica" |
| `Lineal obra 90 gr Color/Negro` | sólo por "plotear" (nicho de arquitectos) | "plano", "impresión de planos" |

### Nombres a estandarizar

El quiebre está en **Impresiones laser color**: 4 productos siguen `<Papel> <Acabado> <Gramaje>`
en Sentence Case, y **2 rompen** — están en mayúsculas y sin el sustantivo al frente.

| hoy | propuesta | por qué |
|---|---|---|
| `OBRA 106 GR` | `Impresiones papel obra 106 gr color` | lo alinea con su hermano directo `Impresiones papel obra 75 gr` y lo hace encontrable por "impresiones" |
| `OBRA 80 GR` | `Impresiones papel obra 80 gr color` | ídem |
| `A5 ILUST. MATE 250 GR` | `Ilustración Mate 250 gr A5` | mayúsculas + abreviatura; queda solo en un rubro "LASER" separado que probablemente deba fusionarse |
| `Lona front brillo (ancho máx 1,52 m)` | `Lona Brillo (ancho máx 1,52 m)` | "front" es el único anglicismo del grupo |
| los 3 anillados | capitalización y tildes consistentes | no afecta el match (todo se normaliza), sí la lectura |

**No es sólo cosmética:** el display es lo que el bot muestra Y uno de los campos contra los que
matchea. Un nombre estandarizado se encuentra por su sustantivo sin depender de la lista de
sinónimos.

---

## 4. Lo que midió la lente de atributos: el LLM 2 no los va a leer bien solo

**23 claves distintas.** Las cinco que más volumen mueven necesitan una frase explícita en el
prompt, porque su nombre no dice lo que contienen:

| clave | lo que un modelo asumiría | lo que es |
|---|---|---|
| `unidad` (top-level) vs `atributos.unidad_venta` | que coinciden | **no coinciden**: `unidad` es texto libre del mostrador y dice "Hoja" en 148 de 185 variantes, incluso en lonas y anillados. El curado es `unidad_venta`. **Al LLM 2 no hay que mostrarle `unidad` en absoluto** |
| `solo_descuentos` | algo de descuentos de precio | 54 de 185 variantes: **no ofrecer espontáneamente, sólo si el cliente la pide por nombre** |
| `mostrable` | "se puede mostrar" | 105 de 185 en `false`: existe pero no se propone por defecto |
| `acabado` | siempre string | **string en 47 casos y array en 10** — y cuando es array son alternativas equivalentes al mismo precio, no un acabado compuesto |
| `medida` vs `tamano` | lo mismo | ejes distintos: `medida` es `{ancho, alto, unidad}` físico del producto terminado; `tamano` es formato de papel. **29 variantes tienen los dos a la vez** |

Menores pero reales: `cobertura` mezcla números-como-string ("25", "50") con el categórico
`"lineal"` · `ancho_max` es límite de rollo, no medida del producto · `impreso_en` es la superficie
cuando el producto es un servicio de montaje · `por_pagina` es bandera de UX, no unidad de cobro ·
`tamano` a nivel producto lista todos los tamaños existentes y a nivel variante el de esa variante.

**Dos contradicciones de dato, las dos con el mismo patrón** (el atributo está bien, el nombre de
la variante está mal):

- `Anillado Plastico a3` → variante llamada **"A4"**, `tamano: ["a3"]`
- `A5 ILUST. MATE 250 GR` → variante llamada **"A4"**, `tamano: ["a5"]`

Buena noticia: **0 productos tienen variantes con atributos idénticos**, así que siempre hay un eje
por el cual distinguirlas.

**Lo que queda sin medir:** la cobertura de `faz` (22/185) y `color` (48/185) se reportó como
"inservible", pero el número no separa "el dato falta" de "ese eje no aplica a ese producto" — una
lona no tiene faz. Antes de dar por malo el eje más caro del catálogo hay que medir la cobertura
**dentro de los productos que sí tienen ese eje**. Pendiente.

---

## 5. Veredicto y orden de trabajo

**El diseño es viable, y es mejor que lo que hay. Pero tiene dos prerrequisitos, los dos de datos,
y uno de prompt.** Construirlo antes de eso es construir sobre un catálogo que no responde.

1. **Curación de nombres y sinónimos** (los 6 de riesgo alto + los 5 renombres). Sin esto, la
   consulta más frecuente del catálogo —imprimir hojas— no encuentra dos de sus productos.
2. **Ponderación por rareza en la búsqueda.** `papel` no puede pesar lo mismo que `kraft`. Es
   código, no dato: puede entrar con el nodo.
3. **La leyenda de atributos en el prompt del LLM 2**, con las cinco frases de §4. Sin eso el
   modelo ignora la columna y vuelve a elegir por el nombre.

### 5 bis. El acento descompuesto — bug vivo, arreglo de una línea (pendiente)

Detectado el 2026-07-27 a partir de una pregunta de Martin. El `translate(lower(...),
'áéíóúñ','aeioun')` de `Get Precio` se aplica **a los dos lados**, así que `Impresión` sí resuelve
a `Impresiones` (el ancla del rank 2 queda abierta al final justo para conservar el plural). Eso
funciona. Lo que **no** funciona es la otra forma de escribir la misma tilde:

```
translate("Impresión")   -> "impresion"    matchea
translate("Impresión")  -> "impresión"    NO matchea   (o + U+0301, acento combinante)
```

Los teclados de iOS y macOS emiten la forma descompuesta. v8.1 ya lo arregló **para el mensaje del
cliente** (`decidir.js:52`, `normalize('NFC')`), pero **el string que llega a Postgres no es el
mensaje del cliente: es el campo `producto` que escribe el LLM**, y ese viaja crudo de
`Parsear Respuesta` a `Get Precio`. Es el único `normalize()` del workflow entero.

- **Arreglo:** NFC sobre los slots del LLM en `Parsear Respuesta`, donde ya se sanean los demás
  campos. Va en el lote de v8.2 (código), no en la curación.
- **La búsqueda por token de v8.3 hereda el bug tal cual**, porque compara las mismas palabras
  contra los mismos nombres: arreglarlo antes es prerrequisito.
- **Segundo agujero, dormido:** `translate` sólo cubre `áéíóúñ`. Un `ü` o un `ç` no se normaliza y
  el match muere en silencio. Hoy no rompe nada — barrido sobre los 88 productos y 185 variantes:
  ningún diacrítico fuera de ese set, ningún string en forma NFD. Es riesgo para nombres futuros,
  y por eso la curación del 27 escribe "cristal" y no "crystal".

Y dos cosas menores que salieron de paso: **filtrar `oculto` antes de pasarle la lista al LLM 2**
(los 5 huérfanos de E0 están todos ocultos y aparecen como ruido en cualquier búsqueda de
"anillado"), y **`Sobre Ingles` está duplicado** (visible en Librería, oculto en Soportes
Especiales, con el mismo nombre canónico — es la pregunta TG 37).

---

## 5 ter. El caso de prueba que dejó la ronda del 27 (mejor que uno inventado)

Con la curación aplicada y el compositor arreglado, *"cuánto sale imprimir 100 hojas a color?"*
(conversación 343) devolvió un menú de **4 productos, todos del rubro láser color**, y el
compositor lo redactó bien. Pero el menú **dejó afuera `Impresiones papel obra 75 gr`** — que es
**inkjet**, tiene variantes de color y es **la más barata de todas**. También quedaron afuera
variantes de las ilustraciones.

**No es culpa del compositor:** obra 75 nunca estuvo en el borrador. El menú se armó incompleto, y
el sesgo es justo el que venimos persiguiendo — el cliente ve el techo y no el piso.

Dos causas posibles, sin decidir:
- **El cupo de ~4 opciones** de `Armar Menu Opciones` (r6). Si obra 75 quedó quinta, se cae por corte.
- **La búsqueda no la trajo**, porque el LLM emitió un producto del rubro láser y obra 75 vive en
  otro rubro con otro nombre.

Se distingue mirando `notas` de esa fila: trae los nombres canónicos que entraron y **cuántas
opciones** eran (`menu: A / B / C (N opciones)`).

**Por qué no se arregla ahora:** el pipeline de v8.3 reemplaza exactamente esa pieza — el menú deja
de salir de `Armar Menu Opciones` con su cupo, y pasa a decidirlo el filtro con la conversación
delante. Calibrar el cupo hoy sería afinar un nodo que está por desaparecer.

**Y el cupo mismo hay que revisarlo:** los 4 se fijaron en r6 porque los menús largos se leían mal
— pero eso era **antes de que el compositor funcionara**. Ahora convierte 17 opciones en tres
oraciones legibles. La premisa que justificaba el cupo dejó de ser cierta.

> **Caso de aceptación de v8.3, textual:** *"cuánto sale imprimir 100 hojas a color"* tiene que
> traer **`Impresiones papel obra 75 gr`** entre los candidatos y ofrecerla, no sólo el rubro
> láser color. Es evidencia real de la ronda, no un caso inventado.

## 5 quater. Pendiente de diagnóstico: ¿el log escribe `borrador`/`final`/`senales`?

Las 15 filas que se miraron el 27 tenían esas tres columnas en `null`, pero **todas eran del 25**,
anteriores al compositor — así que no se puede distinguir "el mapeo está roto" de "todavía no
corrió el workflow nuevo". `Log Turno` mapea `{{ $json.notas }}` y compañía, y `$json` en ese punto
podría ser la respuesta del API de Chatwoot en vez del ítem de `Aplicar Compositor`.

**Lo resuelve una consulta**, y hay que correrla antes de construir nada: si la telemetría está
rota, el pipeline nuevo la hereda y se depura a ciegas.

```sql
select mensaje_cliente, accion, notas,
       borrador is not null as tiene_borrador,
       final    is not null as tiene_final,
       senales  is not null as tiene_senales
  from bot.decisiones
 where conversation_id = 343
 order by created_at desc limit 3;
```

Si `tiene_borrador` es `false`, hay que arreglar el mapeo de `Log Turno` **antes** de la fase 1.

## 6. Las dos decisiones que siguen abiertas

Preguntadas dos veces, sin respuesta todavía. **Mi default, si no me decís otra cosa:**

1. **Con muchos candidatos → repregunta, no lista.** Medido: la búsqueda puede traer 46. Una lista
   de 46 no existe como mensaje de WhatsApp, y el refutador de voz ya midió que la familia
   `impresion` da 63 líneas. Entonces: si tras el filtro quedan más de ~4, el bot **pregunta el eje
   que los separa** en vez de listar. Con 4 o menos, lista.
2. **Con un solo candidato → cotiza, pero declarando el supuesto.** Si el filtro dejó uno solo y el
   cliente no ancló el eje que lo distingue de sus hermanos, sale el precio **con la puerta
   abierta** pegada al monto ("…si lo necesitás en otro gramaje, avisame"). No repregunta: eso
   cuesta un mensaje pago y la puerta informa lo mismo gratis. La diferencia con hoy es que el
   filtro vio a los hermanos y decidió, en vez de que la elección viniera hecha desde el prompt.

**Nada de esto se construye hasta que pase una pasada adversarial de 2 lentes** (plata y costo por
mensaje), como manda la disciplina del proyecto — y con más razón acá, que es un cambio de
arquitectura y no un parche.
