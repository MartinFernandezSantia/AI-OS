---
name: amoblamiento-virtual
description: |
  Amoblamiento virtual (virtual staging) de fotos reales de propiedades
  con Higgsfield, para avisos inmobiliarios. Usar cuando Martin diga
  "amoblamiento virtual", "virtual staging", "amoblá esta foto",
  "stagear el living", "poné muebles en esta foto", o cuando pase la
  foto de un ambiente vacío de una propiedad para publicar. Cubre el
  flujo completo: preguntas previas, prompt que preserva la
  arquitectura real, modelo y flags correctos, y qué NO pedirle al
  modelo generativo. Cargar SIEMPRE junto con higgsfield-preflight,
  que sigue siendo el gate obligatorio antes de generar.
metadata:
  version: 2.0.0
---

# Amoblamiento virtual de propiedades

Amoblar virtualmente la foto de un ambiente vacío para un aviso inmobiliario. El objetivo
es que el interesado vea cómo se vive el espacio, **sin alterar nada de la arquitectura
real**. Es edición sobre una foto real, no una imagen nueva.

`higgsfield-preflight` sigue mandando: el gate con prompt, modelo, params y estimación real
de créditos se muestra igual, y no se genera hasta que Martin diga go.

---

## Paso 1 — Preguntar antes de gastar créditos

Estas cuatro no se asumen. Cada una cambia el prompt, y equivocarse cuesta una generación.

1. **¿Hay más de una foto del mismo ambiente?** Si el aviso va a mostrar dos vistas, los
   muebles tienen que coincidir entre ambas: hay que definir la planta primero y generarla
   consistente, no improvisar por foto. Si es una sola, el problema desaparece.
2. **Textiles y elementos existentes** (cortinas, alfombras, artefactos): ¿se preservan o se
   reemplazan? **Default: preservar.** Amoblar es agregar muebles; cambiar una cortina que
   se entrega con el depto ya es alterar algo real y puede leerse como engaño.
3. **Estado de las paredes**: ¿limpieza cosmética leve (emparejar tono, marcas, repintados)
   o fidelidad total? El criterio de Santía es *realzar la realidad, no fabricarla*.
4. **¿Amoblado o sin amoblar se alquila/vende?** Define si conviene poner TV, y si hay que
   declarar el staging en el aviso.

Usar `AskUserQuestion` con estas, no una lista en prosa: son decisiones, no conversación.

## Paso 2 — Auditar la foto antes de escribir el prompt

Correr el fan-out de agentes de `higgsfield-preflight` (Reference Auditor + Adversarial
Reviewer) en la primera generación de una escena nueva. **Se paga solo**: en la sesión que
originó esta skill, el revisor tumbó un prompt que tenía enderezado, medidas inventadas y
más muebles de los que entraban en el campo visual. Para ediciones de seguimiento chicas
alcanza el revisor adversarial solo.

Lo que el auditor tiene que devolver:

- **Preservar** — inventario de lo arquitectónico: piso (patrón, junta, brillo), zócalo,
  moldura, cielorraso, artefactos de luz, carpintería, cortinas, tomacorrientes.
- **Zonas de fabricación** — todo lo que se ve por el vidrio y todo lo poco nítido. Es donde
  la IA inventa con más confianza.
- **Qué muebles entran de verdad** — con la escala leída de la perspectiva, no del m² del aviso.
- **Riesgos de geometría** — flotación, escala, oclusiones prohibidas.

## El estilo de la casa (aprobado — Libertad 3948, jul-2026)

Este es el look que Martin aprobó. **Arrancar siempre de acá**, no reinventar la estética
cada propiedad. Ganadoras de referencia:
`Propiedades/Libertad 3948 Dpto 1/editadas/comedor.png` y `.../cuarto.png`.

**Los dos prompts completos, listos para copiar, están en
`references/prompts-aprobados.md`** — junto con el historial de lo que no funcionó, para no
repetir iteraciones ya descartadas.

**Estética: IKEA / escandinavo accesible, casa de familia joven ya habitada.**

- **Madera**: una sola, pale matte ash / light wood. **Nunca madera anaranjada ni barnizada.**
- **Tela**: una sola familia, `muted dark grey-blue matte fabric`. Es lo que ancla la paleta.
- **Regla de saturación** (la que resolvió el problema más grande): los muebles nuevos
  **nunca** más saturados ni más contrastados que las paredes y el piso que ya están en la
  foto. Textual:
  `never more saturated or more contrasted than the walls and floor already in the photo`.
  Sin esto la madera sale vibrante, destaca y se lee como pegote pegado encima.

**Muebles con propósito — preguntarse por cada pieza "¿por qué o para qué está ahí?".**
Un mueble vacío es de showroom; un mueble con uso es una casa. Lo que funcionó:

| Pieza | Lo que la hace creíble |
|---|---|
| Mesa de comedor | camino de mesa de lino + frutera baja con naranjas |
| Mueble bajo | planta chica + 2-3 libros apilados acostados + bowl de cerámica |
| Cuadro | **COLGADO en la pared**, nunca apoyado sobre un mueble |
| Mesa de luz | velador apagado + un libro acostado |
| Escritorio | notebook cerrada + 2 libros + portalápices |
| TV | apagada, pantalla negra mate, sin logo, sin reflejo |

Nada de vajilla servida ni mesa puesta completa: se lee como set de catálogo.

### Bloques de prompt que hay que copiar

Estos tres bloques son los que movieron la aguja. Van casi textuales, adaptando solo los
sustantivos de la foto.

**1. Encuadre del pedido — "es una edición, no un render".** Va PRIMERO, antes que nada:

```
This is a photograph of a real apartment. Your ONLY task is to add furniture into it.
This is a photo edit, not a new render. Every pixel not covered by new furniture stays
identical to the source photograph.
```

**2. Anclaje del color de pared.** El fallo más caro y más repetido es que **aclara y enfría
las paredes**. No alcanza con "no repintes": hay que *describirle el tono sucio que tiene* y
prohibirle emparejarlo:

```
The walls in this photograph are a dull, cool, slightly dirty pale grey-white, unevenly lit,
darker and greyer towards the left and in the corners. Reproduce that exact wall tone and
that exact uneven shading, pixel for pixel. Do NOT repaint the walls. Do NOT make them
whiter, cleaner, warmer, brighter or more uniform. Do NOT lift the shading or even out the
gradient across them.
```

**3. Bloqueo de cámara explícito** (no alcanza con "mismo encuadre"):

```
DO NOT CHANGE THE CAMERA. Keep the exact same camera position, eye height, lens angle and
field of view. The vanishing lines of the floor, walls and ceiling stay exactly where they
are. Do not re-compose, re-frame, shift the viewpoint or straighten anything.
```

### La regla de la zona prohibida

**El hallazgo más útil de la sesión.** El modelo borró dos veces un calefactor de tiro
balanceado, pese a pedirle en detalle que lo preservara. La causa: le habíamos puesto un
escritorio **en esa misma pared**. Al obligarlo a redibujar la zona, se llevó puesto el
artefacto.

La solución que funcionó no es insistir con la preservación, es **sacarle el conflicto**:
mandar los muebles nuevos a otra pared y declarar esa zona intocable.

```
THE RIGHT-HAND WALL IS OFF LIMITS. No new object of any kind goes on that wall or in front
of it. [el artefacto] must remain in the finished image, unchanged and unobstructed.
Nothing may overlap it, nothing may stand in front of it, and no furniture may be placed
on that side of the room.
```

Regla general: **nunca poner un mueble nuevo contra la pared donde vive un artefacto que hay
que conservar** (calefactor, calefón, split, termotanque). Si el mueble tiene que ir sí o sí,
asumir que el artefacto se pierde y planificar el compuesto.

### Palabras que salieron caras

- **`blank wall`** — la usé para decir "sin aberturas" y el modelo la leyó como "superficie
  limpia": repintó toda la pared y borró las manchas. Decir `solid plaster with no openings`.
- **`professionally colour graded`** — licencia para aplanar el contraste (ya estaba en v1).
- Prohibición genérica sin nombrar el riesgo. `do not add any window` solo no alcanzó: igual
  inventó una ventana. Funciona mejor **nombrar la pared concreta**: `the left wall and the
  back wall are solid plaster with no openings`.

### Verificar el color con números, no a ojo

El desvío de pared se **mide**, no se estima. Muestrear la misma zona de pared limpia en el
original alineado y en el resultado:

```bash
ffmpeg -nostdin -v error -i imagen.png -vf "crop=500:300:1500:150,scale=1:1" \
  -f rawvideo -pix_fmt rgb24 - | od -An -tu1 | head -1
```

Referencia de lo que se consiguió en Libertad 3948 (pared del comedor):
original `167,175,188` → v2 `188,200,218` (mal) → v3 `173,184,206` (aprobada).
Un desvío de ~10 puntos pasa; ~25 puntos se ve como otra pintura. Ojo con el canal azul: es
el que más se va, y una pared "un poco más clara" en realidad suele estar **azulada**.

## Paso 3 — El prompt

### Estructura que funciona

1. **Bloqueo de encuadre, primero de todo.**
   `Keep the exact same camera position, framing, crop, aspect ratio and field of view.
   Do not rotate, zoom, re-crop or extend beyond the current borders.`

2. **Preservación CORTA + 3 o 4 puntos de énfasis.** Contraintuitivo pero comprobado:
   cuanto más se le describe en detalle algo que **ya está en el píxel**, más lo invita a
   redibujarlo. Una lista larga de preservación es un riesgo en sí misma. Preferir
   `everything already present stays exactly as photographed, pixel for pixel wherever
   possible` + énfasis solo en lo frágil (el piso, las cortinas, el artefacto de luz, la
   vista exterior).

3. **Congelar la vista por el vidrio, nombrándola.** Cielo, techos vecinos, árboles,
   faroles, antenas, skyline, objetos del balcón. Si no se nombra, lo redibuja: le pone
   follaje a un árbol invernal, convierte chapa en tejas, "completa" una antena borrosa.
   Incluir `stays at its current softness` — el riesgo también es que **nitidice**.

4. **Escala anclada a referencias medibles de la foto**, no a medidas de la sala (que no se
   ven y son inventadas): `the floor tiles are 33 cm squares, the baseboard is about 10 cm
   high, the power outlet sits about 115 cm above the floor`.

5. **Continuidad del piso**: `where furniture interrupts the tile grid, the grout lines
   continue in perfect alignment on the other side`. Es donde más se delata un staging falso.

6. **Integración lumínica.** Nombrar las fuentes reales que ya existen (ej. tungsteno cálido
   del artefacto + luz fría de la ventana) y pedir que los muebles de cada zona tomen la
   temperatura que les toca. Sin esto, todos los muebles salen a la misma temperatura y el
   pegote es evidente. Más: sombra de contacto corta en la base, sombra proyectada
   coherente, y reflejo tenue estirado si el piso es brillante.

7. **Lista de exclusión explícita**: personas, mascotas, espejos, plantas colgantes, arte
   con texto, alfombras con patrón, objetos nuevos en el balcón, y **cualquier puerta,
   ventana o nicho** que no esté ya en la pared. Cerrar también el borde del encuadre:
   `do not draw any wall, corner or floor edge that is not already visible`.

8. **Cierre de grado**: `keep the original exposure, white balance and contrast. Do not
   brighten shadows, do not apply any colour grade.` Sacar "professionally colour graded" —
   es licencia para aplanar el contraste.

### Qué NO pedirle nunca al modelo generativo

- **Enderezar.** Al rotar quedan cuñas vacías y Nano Banana **no puede outpaint**: las
  rellena inventando piso o moldura. Va aparte, con ffmpeg:
  `ffmpeg -i in.jpg -vf "rotate=-1*PI/180:c=none,crop=iw*0.97:ih*0.97" out.jpg`
  (negativo = horario). Si Martin insiste en generativo, incluir textual *"recortá en vez de
  rellenar"* y revisar las 4 esquinas después.
- **Transferir la calidad de una foto a otra.** No existe: reinterpreta y reinventa. Para
  subir resolución va `bytedance_image_upscale`, y solo recupera detalle comprimido, nunca
  detalle que no se capturó. Si la foto está movida o desenfocada, ningún upscaler la salva
  — conviene volver a sacarla.
- **Números que no puede evaluar** ("que se vea el 55% del piso") ni distorsión de barril
  selectiva. Reemplazar por condiciones espaciales: *"dejá un camino de piso despejado en
  todo el primer plano; el patrón se ve completo en el tercio inferior"*.

### Muebles: qué agregar

Regla de oro: **una familia de materiales, no muebles sueltos.** Un tapizado compartido
entre sofá y sillas, una madera única en todas las piezas. Es lo que separa un staging que
parece un living de uno que parece un catálogo.

Para un living comedor típico argentino de 2 ambientes: sofá contra la pared larga, mesa
ratona, mesa redonda de 4 cerca de la luz natural, y un mueble bajo. Cuidado con
sobrecargar: en ~20 m² no entran dos zonas completas en el mismo campo visual, y un aviso
saturado **achica visualmente el ambiente**, que es lo contrario del objetivo.

Si va TV: **apagada, pantalla negra mate, sin logo ni contenido**. Una TV encendida es
fabricación gratuita y se nota. En un alquiler sin amoblar además induce a pensar que se
entrega.

Un mueble contra la pared es la mejor forma de tapar un cable suelto o una marca: resuelve
sin obligar al modelo a reconstruir textura.

## Paso 4 — Generar

```bash
higgsfield generate cost nano_banana_2 --prompt "..." --image "./foto.jpg"

higgsfield generate create nano_banana_2 \
  --aspect_ratio "16:9" --resolution "2k" \
  --image "./foto.jpg" --wait --wait-timeout 15m \
  --prompt "..."
```

- **`aspect_ratio` SIEMPRE explícito.** El default del modelo es `1:1` y recorta la foto a
  cuadrado. Las fotos del celular de Martin son 4:3 (8192x6144).
- **Para avisos, Martin pide 16:9** (verificado jul-2026). **No hace falta recortar la foto
  antes**: pasándole la 4:3 original con `--aspect_ratio "16:9"`, el modelo **recorta arriba
  y abajo**, no inventa laterales. Se probó con 1 generación antes de asumirlo. Ojo igual:
  elige él qué recortar, así que si arriba hay algo que no se puede perder (un calefón, una
  ventana alta), conviene recortar con ffmpeg y elegir el encuadre uno mismo.
- Params del modelo con guión bajo (`--aspect_ratio`), flags del CLI con guión medio
  (`--wait-timeout`). El error `Unknown params` es esto.
- **Modelo**: `nano_banana_2` (Pro). **Cuesta lo mismo que `nano_banana_flash`: 2 créditos
  los dos** (verificado con `generate cost` en jul-2026 — la versión anterior de esta skill
  decía 1,5 para flash y estaba mal). Si el precio empata, va Pro siempre: rinde mejor en
  geometría. Sigue siendo **premium**: no se corre sin un sí explícito de Martin, y el número
  sale de `generate cost`, nunca a ojo.
- Generar siempre **desde la foto original**, no desde una versión anterior, para no
  acumular degradación entre iteraciones.

### Elegir la foto: cuántas anclas visuales tiene

**Predice el resultado mejor que cualquier prompt.** El modelo preserva la geometría cuando
tiene con qué anclarse. Si el ambiente es dos paredes lisas y piso, no edita: **reconstruye
la escena entera** — mueve la cámara, cambia el tamaño de las ventanas, repinta.

- **Ambiente con anclas** (mesada, puerta panelada, granito, azulejos, muebles existentes) →
  preserva bastante. El comedor de Libertad 3948 salió en 3 pasadas.
- **Ambiente casi vacío** (paredes lisas, piso liso) → se va a render nuevo. El cuarto de
  Libertad 3948 movió la perspectiva en las 3 pasadas, con la cámara bloqueada en el prompt.

Si la foto es del segundo tipo, decirlo **antes de generar** y ofrecer las alternativas:
elegir otra foto del mismo ambiente con más quiebres de geometría, o publicarlo vacío.
Un aviso puede mezclar fotos amobladas y vacías sin problema.

**Tope de intentos: 2 pasadas.** Si a la segunda el modelo sigue reconstruyendo, no insistir
con variaciones de prompt — es límite del modelo con ese ambiente, no del wording.

### Cuándo el compuesto NO sirve

Tentación natural: generar y después restituir con ffmpeg la zona que el modelo arruinó.
**Solo funciona si la geometría coincide** entre el original y el generado. Verificar SIEMPRE
antes, alineando el original al 16:9 y comparando la zona lado a lado:

```bash
ffmpeg -nostdin -loglevel error -y -i original.jpg -vf "crop=8192:4608:0:768,scale=2752:1536" orig_align.png
ffmpeg -nostdin -loglevel error -y -i orig_align.png -vf "crop=800:1300:1950:236,scale=650:-2" a.jpg
ffmpeg -nostdin -loglevel error -y -i generada.png -vf "crop=800:1300:1950:236,scale=650:-2" b.jpg
ffmpeg -nostdin -loglevel error -y -i a.jpg -i b.jpg -filter_complex hstack cmp.jpg
```

Si la perspectiva se movió, el pegado se nota en el zócalo y en la línea de pared: no hay
compuesto posible y hay que decirlo en vez de intentarlo.

## Paso 5 — Revisar el resultado

Mirar la imagen antes de dársela por buena. Chequeo, en orden de probabilidad de fallo:

1. **Color de pared, MEDIDO** — el fallo más frecuente. Muestrear RGB contra el original
   (ver arriba). Aclara y azulea sistemáticamente.
2. **Perspectiva** — comparar lado a lado contra el original alineado. ¿Se movió la cámara?
   ¿Cambió el escorzo de una puerta? ¿Se ensanchó el campo visual?
3. **Artefactos que debían quedar** — calefactor, calefón, split. Chequear que estén, y en su
   posición y tamaño original. Se borran o se mueven, sobre todo si hay un mueble nuevo cerca.
4. **Aberturas inventadas** — recorrer las paredes que en el original son llenas. Inventa
   ventanas aunque el prompt lo prohíba.
5. **Carpintería simplificada** — las puertas paneladas pierden los relieves y quedan lisas,
   y les cambia el picaporte.
6. **Patas y contacto con el piso** — sillas con tres patas, muebles flotando sin sombra.
   Las sillas de comedor son lo más difícil: patas finas, escorzo fuerte, grilla visible.
   También se fusionan entre sí: pedir `space the chairs clearly apart so every individual
   leg is separately visible`.
7. **Deformación de tapas** — la tapa de una mesa curvada en vez de recta. Pedir
   `perfectly straight flat top and square edges`.
8. **Continuidad de las juntas** del piso alrededor de cada mueble.
9. **La vista por el vidrio** — comparar contra el original: ¿apareció follaje? ¿cambió un techo?
10. **Escala contra referencias fijas** — el respaldo de un sofá tiene que quedar claramente
    por debajo del tomacorriente.

Reportar lo que salió distinto de lo pedido aunque se vea bien. Si el modelo puso el sofá en
otro lado, se dice: es información para decidir si vale otra pasada.

## Archivos

- Generados → `project-context/<Proyecto>/assets/drafts/higgsfield/` (gitignored),
  nombrados `<propiedad>_<ambiente>_v<N>.png`.
- La elegida se promueve a `Propiedades/<Dirección>/editadas/<ambiente>.png` y se commitea.
- `editadas/README.md` registra qué versión ganó, con qué modelo y qué se hizo — así la
  próxima sesión no repite iteraciones ya descartadas.

## Contexto de Santía

Las fotos salen del celular en 8192x6144 y ZonaProp corta en 6000 px por lado. El
reescalado lo hace **Martin** con `tools/redimensionar-fotos.html` (drag & drop, todo en el
navegador, él elige dónde se descargan). No correrlo por él. Ver `zonaprop-listing` para
el aviso que acompaña a las fotos.
