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
  version: 1.0.0
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
  --aspect_ratio "4:3" --resolution "2k" \
  --image "./foto.jpg" --wait --wait-timeout 15m \
  --prompt "..."
```

- **`aspect_ratio` SIEMPRE explícito.** El default del modelo es `1:1` y recorta la foto a
  cuadrado. Las fotos del celular de Martin son 4:3.
- Params del modelo con guión bajo (`--aspect_ratio`), flags del CLI con guión medio
  (`--wait-timeout`). El error `Unknown params` es esto.
- **Modelo**: `nano_banana_2` (Pro, 2 créditos) vs `nano_banana_flash` (1,5). La diferencia
  es chica y Pro se justifica en escenas con geometría exigente — pisos en damero,
  perspectiva fuerte. Pro es **premium**: nunca se corre sin un sí explícito de Martin, y el
  número real sale de `generate cost`, nunca estimado a ojo.
- Generar siempre **desde la foto original**, no desde una versión anterior, para no
  acumular degradación entre iteraciones.

## Paso 5 — Revisar el resultado

Mirar la imagen antes de dársela por buena. Chequeo, en orden de probabilidad de fallo:

1. **Patas y contacto con el piso** — sillas con tres patas, muebles flotando sin sombra.
   Las sillas de comedor son lo más difícil: patas finas, escorzo fuerte, grilla visible.
2. **Continuidad de las juntas** del piso alrededor de cada mueble.
3. **La vista por el vidrio** — comparar contra el original: ¿apareció follaje? ¿cambió un techo?
4. **Las cuatro esquinas**, si hubo enderezado: moldura que no cierra o zócalo cortado raro
   = relleno inventado.
5. **Escala contra referencias fijas** — el respaldo de un sofá tiene que quedar claramente
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
