# Brandsen 5120 — Aviso ZonaProp

Depto 2 ambientes en alquiler. Villa Primera, Mar del Plata.
Redactado 2026-07-30. **Sin publicar.**

## Título

```
Departamento 2 ambientes 45 m² con cochera cubierta, Villa Primera
```

La cochera es el diferencial: en 2 ambientes de alquiler es lo que menos abunda y lo que
más filtra búsquedas. El barrio pesa más que "Mar del Plata" a secas, porque todos los
avisos dicen Mar del Plata y el que busca filtra por barrio.

## Descripción

```
Departamento de 2 ambientes de 45 m² en Villa Primera, con cochera cubierta propia y
balcón. Contrafrente y orientación este: muy luminoso a la mañana y silencioso, sin ruido
de calle. Cocina equipada, lavadero independiente y calefacción, listo para entrar a vivir.

La distribución es living comedor con salida al balcón, dormitorio, baño completo, cocina
y lavadero aparte. Los 3 m² semicubiertos del balcón suman al uso diario sin achicar los
ambientes interiores.

El edificio tiene ascensor y encargado, y accesos adaptados para personas con movilidad
reducida. Cochera cubierta incluida, algo que no abunda en dos ambientes de esta categoría.

Se alquila sin amoblar. Coordinamos la visita cuando te quede cómodo.
```

El primer párrafo carga todo: es lo único que ZonaProp muestra sin expandir.

## Campos del portal

| Campo | Valor |
|---|---|
| Superficie total | 45 m² |
| Superficie cubierta | 42 m² |
| Superficie semicubierta | 3 m² |
| Ambientes | 2 |
| Dormitorios | 1 |
| Baños | 1 |
| Cocheras | 1 (cubierta) |
| Antigüedad | 35 años |
| Orientación | Este |
| Disposición | Contrafrente |
| Luminosidad | Alta |
| Pisos del edificio | 2 |
| Deptos por piso | 14 |
| Expensas | $120.000/mes |
| Precio | $600.000/mes |
| Ambientes adicionales | Balcón, cocina, lavadero, living comedor |
| Servicios | Ascensor, encargado |
| Extras | Calefacción, cocina equipada, termotanque |
| Facilidades | Acceso para discapacitados |

## Pendiente

- **Confirmar el barrio.** Villa Primera está deducido de avisos reales en Brandsen 4000 y
  6300 (ambos Villa Primera), así que el 5120 cae en el medio. No está verificado contra
  cartografía oficial del municipio. Que lo confirme el martillero.
- **Piso de la unidad** — no vino en el JSON.
- **Plazo de contrato y requisitos de garantía** — ZonaProp los premia en la descripción.
- **Elegir el staging del living** (v1 o v2, en `assets/drafts/higgsfield/`) y enderezarlo.
- Staging o retoque del resto de los ambientes.

## Decisiones de redacción

- **La antigüedad no va en la descripción**, solo en el campo del portal. Ponerla en el
  texto resta y no suma búsquedas.
- **"14 deptos por piso" tampoco.** Densidad alta juega en contra; en el campo va igual
  porque suma score.
- **Las expensas no se esconden.** $600.000 + $120.000 = $720.000 reales, y son el 20% del
  total. El aviso entra por debajo del filtro de $700.000, pero el interesado se entera al
  abrir: ocultarlo genera consultas que no cierran.

## Correcciones al JSON del martillero

- Cargó `cocheras: 0` con `garageCoverage: "Cubierta"`. **Sí tiene cochera** (confirmado por
  Martin) — el aviso la incluye porque es el diferencial principal.
