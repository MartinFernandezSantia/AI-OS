# Prompts aprobados — estilo de la casa

Los dos prompts que produjeron las imágenes que Martin aprobó (Libertad 3948 Dpto 1,
jul-2026). Copiar y adaptar **solo los sustantivos** de la foto nueva: qué artefactos hay,
de qué color es la pared, qué piso, qué pared es la larga.

Modelo: `nano_banana_2` · `--aspect_ratio "16:9"` · `--resolution "2k"` · foto 4:3 original.

Resultados: `Propiedades/Libertad 3948 Dpto 1/editadas/comedor.png` y `.../cuarto.png`.

---

## 1. Comedor (v3) — el que resolvió el color de pared

Contexto: cocina comedor con mesada y mueble de madera roja a la izquierda, puerta panelada
al fondo, piso de granito. Ambiente CON anclas visuales → preservó bien la geometría.

```
This is a photograph of a real apartment. Your ONLY task is to add furniture into it. This is a photo edit, not a new render. Every pixel not covered by new furniture stays identical to the source photograph.

WALL COLOUR IS THE TOP PRIORITY. The walls in this photograph are a dull, cool, slightly dirty pale grey-white, unevenly lit, darker and greyer towards the left and in the corners, brighter towards the upper right. Reproduce that exact wall tone and that exact uneven shading, pixel for pixel. Do NOT repaint the walls. Do NOT make them whiter, cleaner, warmer, brighter or more uniform. Do NOT lift the shading or even out the gradient across them. Every existing stain, grey smudge, scuff, patch of uneven repaint, the small dark hole low on the left wall and the marks near the skirting are real features of this apartment and must all stay exactly where they are at exactly their current strength. The wall must look like the same painted surface as in the source photograph, same hue, same value, same dirt.

DO NOT CHANGE THE CAMERA. Keep the exact same camera position, eye height, lens angle and field of view. The vanishing lines of the floor, walls and ceiling stay exactly where they are. Do not re-compose, re-frame, shift the viewpoint or straighten anything.

DO NOT CHANGE LIGHT OR GRADE. Keep the original exposure, white balance and contrast exactly. Do not brighten the shadows, do not apply any colour grade, do not change the light temperature.

PRESERVE THE ARCHITECTURE. Keep the white PANELLED door exactly as photographed: it has recessed rectangular panels with visible mouldings and a raised frame, plus its existing lever handle and keyhole below it. Keep those panels, that relief and that handle exactly as they are; do not turn it into a flat smooth door and do not replace the handle. Keep the speckled granite terrazzo floor and every grout line, the terrazzo skirting, the light switch and power outlets, and the kitchen counter with the dark red wooden cabinet at the far left. The left wall and the back wall are solid plaster: do not add any window, door, opening, niche, recess or vent to them.

ADD ONLY THIS FURNITURE, in affordable Scandinavian flat-pack style, as if a young family already lives here. Centre-left on the open floor: a plain rectangular dining table with a perfectly straight flat top and square edges, in pale matte ash wood, with four chairs whose legs are pale light wood and whose seats are upholstered in muted dark grey-blue matte fabric. Space the four chairs clearly apart so every individual leg is separately visible and no leg merges into another chair or into the table legs. On the table, a plain light linen runner across the middle and one low ceramic bowl holding a few oranges. Against the right-hand wall: a low matte pale wood sideboard, holding a small potted green plant, a short stack of two or three books lying flat, and a plain ceramic bowl. On the left-hand wall near the kitchen counter, one small framed picture HANGING flat on the wall with abstract muted shapes and absolutely no text, letters, words or numbers. One taller potted green plant standing on the floor in the left corner.

Keep every new surface matte and desaturated, never more saturated or more contrasted than the walls and floor already in the photo, and lit by the same soft cool light already in the room. Every leg ends in a short dark contact shadow where it meets the floor plus a soft cast shadow following the existing light. Where furniture interrupts the floor tile grid, the grout lines continue in perfect alignment on the other side.

No people, no pets, no mirrors, no hanging plants, no patterned rugs, no television, no text anywhere. Do not draw any wall, corner or floor edge that is not already visible.
```

**Qué sigue fallando en esta versión:** residuo azulado en la pared (medido +18 en el canal
azul). Se corrige después con curvas, no con otra generación.

---

## 2. Cuarto (v3) — el que salvó el calefactor

Contexto: dormitorio casi vacío, calefactor de tiro balanceado en la pared derecha, puerta
de chapa con ventanita y reja. Ambiente SIN anclas → la geometría igual se movió, pero el
artefacto sobrevivió gracias a la zona prohibida.

**La clave**: el TV va contra la pared del FONDO, no contra la del calefactor. En las dos
pasadas anteriores había un escritorio en la pared derecha y el modelo borró el calefactor
las dos veces.

```
This is a photograph of a real room. Your ONLY task is to add furniture into it. This is a photo edit, not a new render. Every pixel not covered by new furniture stays identical to the source photograph.

THE RIGHT-HAND WALL IS OFF LIMITS. No new object of any kind goes on the right-hand wall or in front of it. The dark grey balanced-flue gas heater mounted on that wall must remain in the finished image, unchanged and unobstructed: same dark grey body, same size, same position on the wall, same horizontal vent slots at the top, same wall bracket, same thin cable running from its bottom down to the floor. It is a real appliance included with the apartment and removing it or hiding it would be wrong. Nothing may overlap it, nothing may stand in front of it, and no furniture may be placed on that side of the room. Likewise keep the metal door and its small high window with security bars exactly as photographed: same door, same panel, same frame, same small window size and proportion, same bar spacing, same latch. Do not enlarge that window. What shows through its glass is featureless blown-out white and stays exactly that blown-out white at its current softness, with no landscape, sky, building or foliage invented behind it.

DO NOT CHANGE THE CAMERA. Keep the exact same camera position, eye height, lens angle and field of view. The vanishing lines of the floor, walls and ceiling stay exactly where they are. Do not re-compose, re-frame, shift the viewpoint or straighten anything.

DO NOT CHANGE COLOUR, LIGHT OR PAINT. The wall paint keeps exactly its current dull warm off-white tone with all its uneven shading. Do not repaint the walls, do not make them cleaner, whiter or more uniform, do not tint them blue, cool or grey. Every existing stain, grey smudge, scuff, chipped patch and dark mark near the skirting stays exactly where it is at its current strength, including the damaged patch low on the right-hand wall. The floor keeps exactly its current warm white ceramic tiles with grey grout, same tile size, same grid, same slightly dirty tone; do not tint it blue. Keep the original exposure, white balance and contrast; do not brighten shadows, do not apply any colour grade. The single power outlet on the back wall and the thin cable running to the floor stay as they are.

ADD ONLY THIS FURNITURE, in affordable Scandinavian flat-pack style, as if a young person already lives here.
- Against the long LEFT-hand wall: a single bed in pale matte light wood, made up with plain muted grey-blue bedding, two pillows and a soft folded throw at the foot.
- Beside the bed, against the same left wall: a small matte light wood bedside table holding a small switched-off table lamp and one book lying flat.
- Against the BACK wall, the one facing the foot of the bed: a low matte pale wood TV sideboard. On it a modern flat-screen television, SWITCHED OFF, with a completely black matte blank screen showing no image, no logo and no reflection, plus a small potted green plant beside it and a short stack of two books.
- One medium potted green plant standing on the floor in the corner where the left and back walls meet.
- On the left wall above the bed, one small framed picture hanging flat, with abstract muted shapes and absolutely no text, letters, words or numbers.

All wood is the same pale matte tone; all fabric is the same muted grey-blue family. Keep every new surface matte and desaturated, never more saturated or more contrasted than the walls and floor already in the photo, lit by the same hard pale daylight from the existing door window. Every leg ends in a short dark contact shadow where it meets the floor plus a soft cast shadow following that light. Where furniture interrupts the floor tile grid, the grout lines continue in perfect alignment on the other side.

The left wall and the back wall are solid plaster with no openings: do not add any window, door, opening, niche, recess, vent or skylight to them. No people, no pets, no mirrors, no hanging plants, no patterned rugs, no curtains, no text anywhere. Do not draw any wall, corner or floor edge that is not already visible.
```

**Qué sigue fallando en esta versión:** la perspectiva se movió (la puerta quedó menos
escorzada) y la pared se aclaró ~30 puntos. Es el límite del modelo en un ambiente vacío,
no del prompt — tres pasadas dieron el mismo patrón.

---

## Historial de lo que NO funcionó

| Intento | Qué pasó |
|---|---|
| Comedor v1 | Madera anaranjada y saturada = pegote evidente. Tapa de mesa deformada, patas de sillas fusionadas. Cuadro apoyado sobre el mueble (pose de showroom). |
| Comedor v2 | Buen color de muebles, pero repintó la pared (+25 pts) y le inventó una ventana. Puerta panelada → lisa. |
| Cuarto v1 | Render nuevo completo: repintó, viró el piso a celeste, agrandó la ventana, movió el calefactor. Culpable parcial: la palabra `blank wall`. |
| Cuarto v2 | Mejor color, pero **borró el calefactor** — había un escritorio pedido en esa misma pared. |
