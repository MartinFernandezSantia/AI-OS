# Recorrido en video — Brandsen 5120 (SantiaPropiedades)

_Plan creado 2026-07-30._

## Context

Martin tiene el clip del living listo (virtual staging animado, muebles saliendo del piso,
16:9 para YouTube → ZonaProp). Falta el resto del recorrido: 4 clips más que, unidos en
edición, den un walkthrough del departamento.

El objetivo es un video final de ~40-50s que se sube a YouTube y se linkea al aviso de
ZonaProp. Formato **16:9** en todos los clips (lo manda YouTube).

**Layout confirmado por Martin:** entrás → a la izquierda el living (conecta con balcón),
derecho la cocina, a la derecha baño y dormitorio. El pasillo de `Dormitorio - 2` es el
mismo de `Pasillo - 1`.

**Staging virtual solo en living (hecho) y dormitorio.** Cocina, baño y balcón van reales.

## Material disponible

18 fotos curadas en `project-context/SantiaPropiedades/Propiedades/Brandsen 5120/`
(nombradas por el curador: `Categoría - N.jpg`, 8192x6144).

Hallazgo de continuidad importante: **hay tres pisos distintos** y eso condiciona los cortes.

| Ambiente | Piso | Consecuencia |
|---|---|---|
| Living / pasillo | baldosa terracota con motivo floral | base del recorrido |
| Dormitorio | parquet espigado (madera oscura) | corta con el pasillo |
| Cocina / baño | baldosa clara veteada, formato chico | corta con el pasillo |

`Dormitorio - 2` es el **plano puente**: se ve la puerta abierta al pasillo y el cambio de
parquet a terracota en el umbral. Es la única foto del set que muestra dos pisos a la vez.

## Los 5 clips

Orden de recorrido = orden de la edición final.

### Clip 1 — Living + staging ✅ YA HECHO
Frames en `assets/drafts/higgsfield/`: `b5120_START_169.jpg` → `b5120_END_169.png`.
Prompt ya entregado (muebles saliendo del piso en 3 grupos, dolly contenido).

### Clip 2 — Balcón (cierra el bloque living)
- **Base:** `Balcón - 1.jpg` (desde el living mirando el ventanal).
- **Movimiento:** dolly de avance lento hacia el ventanal, terminando en la vista.
- **Sin staging.** Un solo frame + prompt de movimiento (no first/last).
- **Nota:** `Balcón - 3` y `4` son *parado en el balcón mirando afuera*. La vista es a
  contrafrente (techos, pared negra con alambre de púa) — honesta pero no es el punto
  fuerte. Sirven como plano corto de apoyo, no como remate.

### Clip 3 — Cocina
- **Base:** `Cocina - 1.jpg` — el mejor del set: cuenta la cocina entera tipo galera,
  luz natural difusa de la ventana al fondo como punto de fuga, verticales derechas,
  sin espejos, mucho piso.
- **Movimiento:** dolly de avance por el eje de la cocina hacia la ventana, mesada
  barriendo el borde derecho.
- **Limpieza previa (Higgsfield):** el teléfono de pared con cable enrulado es lo único
  que ensucia. Opcional — aporta carácter de época.
- **Descartadas:** `Cocina - 2` (oscura y cálida, reflejo quemado en alacena),
  `Cocina - 8` (crepuscular azul, reflejo del artefacto en el vidrio),
  `Cocina - 9` (detalle de la pileta de lavadero manchada — es la peor parte de la cocina).

### Clip 4 — Baño
- **Base:** `Baño - 1.jpg` — muestra bañera + lavatorio + bidet de una, y **no tiene
  espejos en cuadro**, lo que elimina el riesgo de que el modelo alucine en los reflejos.
- **Movimiento:** paneo suave / avance corto. Clip breve (el baño es el ambiente más
  débil del set).
- **Limpieza previa (Higgsfield):** subir exposición y neutralizar el amarillo, y recortar
  la franja velada del primer plano izquierdo.
- **Descartadas:** `Baño - 3` (aplique encendido en cuadro, zona quemada + espejos),
  `Baño - 2` (hotspot quemado + espejos), `Baño - 4` (buena exposición pero solo la
  esquina inodoro/bidet, y tiene el rollo de papel usado).

### Clip 5 — Dormitorio + staging
- **Frames:** `Dormitorio - 1.jpg` (vacío, ventana panorámica con vista a la ciudad y
  parquet espigado) como primer frame → versión con staging como último frame.
- **Staging a generar** (Nano Banana, mismo criterio que el living): cama de dos plazas con
  respaldo, dos mesas de luz con veladores, **y un cuadro sobre la pared derecha** (hoy
  completamente vacía en el recorte 16:9). Nada más: el dormitorio es chico y sobrecargarlo
  lo hace ver más pequeño.
- **Movimiento:** mismo lenguaje que el living — los muebles salen del piso, **pero el
  cuadro aparece EN la pared** (no sube desde el piso: está colgado). Es el último beat,
  después de la cama y las mesas de luz. Dolly contenido.
  - Redacción para el prompt: `the framed picture appears on the right-hand wall, fading
    into place already hanging` — o bien `pressing out from the wall surface`. **No** usar
    "rising up out of the floor" para el cuadro, que contradice su posición.
  - Cuidado: el cuadro es el único elemento con contenido interno inventado. En el prompt
    conviene dejarlo genérico y neutro (arte abstracto suave, sin texto, sin caras) —
    cualquier detalle fino ahí es zona de fabricación.
- **`Dormitorio - 2`** (placard + puerta al pasillo) queda como **plano puente** opcional
  para la transición al pasillo, sin staging.

## Orden de la edición final

```
Living (staging)  →  Balcón  →  Cocina  →  Baño  →  Dormitorio (staging)
   clip 1             clip 2     clip 3     clip 4      clip 5
```

Justificación: sigue el recorrido físico real (entrás, living a la izquierda que da al
balcón, después cocina al frente, después el ala de baño y dormitorio a la derecha), y
**cierra con el dormitorio**, que con la ventana panorámica y el parquet es el segundo
ambiente más vendible después del living amoblado.

`Pasillo - 1` y `Dormitorio - 2` quedan como material de transición para la edición, no
como clips propios.

## Trabajo previo a las generaciones de video

1. **Igualar color entre ambientes.** El set está fotografiado en momentos distintos: la
   cocina es diurna neutra, el baño sub-expuesto y amarillo, `Cocina - 8` crepuscular azul.
   Sin igualar, el recorrido parece grabado en dos días. Corregir exposición y temperatura
   antes de generar.
2. **Limpieza de objetos vía Higgsfield** (Martin pidió no retoque manual): rollo de papel
   usado, esponja azul, manchas más visibles. `nano_banana` a **1 credit por imagen**.
   Cada limpieza pasa por el gate de `higgsfield-preflight`.
3. **Recortar todos los frames a 16:9** (los originales son 4:3). El recorte centrado es el
   que mejor reparte: conserva mobiliario y piso, sacrifica pared vacía. Verificado en el living.

## Verificación

- Cada frame recortado: confirmar 16:9 exacto con `ffprobe` y **mirarlo** antes de generar.
- En los pares first/last (dormitorio): medir que no haya salto de brillo entre frames
  (el script `grade_check.py` del living midió 9→6 niveles sobre 255; mismo criterio acá).
- Cada generación de video pasa por el gate de `higgsfield-preflight` con estimación real
  de credits vía `higgsfield generate cost`.
- Al final: unir los 5 clips y ver el recorrido completo buscando saltos de color,
  cambios de hora del día, y que los cortes entre pisos distintos no chirríen.

## Riesgo abierto

El "muebles saliendo del piso" con first+last frame **puede salir como disolvencia** — con
los dos extremos en reposo el modelo no tiene evidencia de la trayectoria. Aplica al living
(clip 1) y al dormitorio (clip 5). Si falla, el camino no es un modelo más caro sino plates
intermedios encadenados en clips cortos (un evento por clip). Los clips 2, 3 y 4 no tienen
este riesgo: son movimiento de cámara puro sobre un solo frame.

## Costos estimados (credits, Higgsfield)

Saldo actual: **196**.

| Ítem | Cant. | Unit. | Total |
|---|---|---|---|
| Staging dormitorio (Nano Banana) | 1-2 | 1 | 1-2 |
| Limpiezas baño/cocina (Nano Banana) | 2-3 | 1 | 2-3 |
| Clips de video | 4 | 12-25 | 48-100 |

Total estimado **~50-105 credits** según modelo de video (a definir en cada gate).
El clip del living no está contado: su prompt está listo pero aún no se generó.
