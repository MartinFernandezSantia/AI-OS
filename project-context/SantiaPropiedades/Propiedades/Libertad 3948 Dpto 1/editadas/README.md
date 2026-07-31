# Libertad 3948 Dpto 1 — fotos con amoblamiento virtual

Generado 2026-07-30 con Higgsfield `nano_banana_2` (Nano Banana Pro), `aspect_ratio 16:9`,
`resolution 2k`, 2 créditos por pasada. Prompts completos en la skill
`amoblamiento-virtual`, `references/prompts-aprobados.md`.

El depto se entrega **sin amoblar**. El staging es ilustrativo → el aviso debería aclarar
"imágenes con amoblamiento virtual".

## Ganadoras

| Archivo | Origen | Versión | Notas |
|---|---|---|---|
| `comedor.png` | `IMG_20260726_152452.jpg` | v3 | Mesa de 4 + mueble bajo + cuadro colgado + plantas. La mejor de la serie. |
| `cuarto.png` | `IMG_20260726_153016.jpg` | v3 | Dormitorio simple + TV apagada sobre mueble bajo en la pared del fondo. Calefactor preservado. |

## Decisiones tomadas

- **Paredes: fidelidad total.** No se borran manchas ni marcas. Lo feo se tapa por
  composición (un mueble o una planta delante), nunca repintando.
- **Calefactor: se preserva.** Es una mejora real que suma al aviso.
- **Mesa de fórmica vieja y cable suelto: se sacan**, los reemplaza el amoblado nuevo.
- **TV**: solo en el cuarto, apagada y con pantalla negra mate.
- **Estilo**: IKEA / escandinavo, madera clara mate, tela gris-azul apagada. Los muebles
  nunca más saturados que las paredes y el piso de la foto.

## Pendiente

- Residuo de color: las dos aclararon la pared respecto del original (comedor ~+9 pts,
  cuarto ~+30 pts, medido en RGB). Se corrige con curvas, sin gastar créditos.
- El cuarto movió la perspectiva en las 3 pasadas — límite del modelo en un ambiente casi
  vacío. Si molesta, la alternativa es probar `IMG_20260726_153242.jpg` (el otro cuarto,
  con más quiebres de geometría) o publicarlo vacío.
- Reescalado a menos de 6000 px para ZonaProp: lo hace Martin con
  `tools/redimensionar-fotos.html`.

## Descartadas (no repetir)

`libertad3948_comedor_v1/v2` y `libertad3948_cuarto_v1/v2` en `assets/drafts/higgsfield/`.
Motivos en el historial de `references/prompts-aprobados.md`.
