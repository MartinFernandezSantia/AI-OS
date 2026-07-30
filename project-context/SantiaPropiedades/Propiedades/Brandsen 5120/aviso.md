# Brandsen 5120 — Aviso ZonaProp

Depto 2 ambientes en alquiler. Villa Primera, Mar del Plata.
Redactado 2026-07-30. **Sin publicar.**

## Título

```
Departamento 2 ambientes 45 m² luminoso con balcón, Villa Primera
```

Sin cochera, el diferencial pasa a ser la combinación de luminosidad, balcón y barrio.
"Luminoso" y "balcón" son de los términos más buscados en 2 ambientes de alquiler. El barrio
pesa más que "Mar del Plata" a secas, porque todos los avisos dicen Mar del Plata y el que
busca filtra por barrio.

## Descripción

~460 caracteres, tres párrafos cortos.

```
Departamento de 2 ambientes de 45 m² en Villa Primera, muy luminoso y con balcón propio.
Contrafrente y orientación este: sol de mañana y silencio, sin ruido de calle.

Living comedor con salida al balcón, dormitorio, baño completo, cocina equipada y lavadero
independiente. Tiene calefacción y está listo para entrar a vivir.

El edificio cuenta con ascensor y encargado. Se alquila sin amoblar. Escribinos y
coordinamos la visita.
```

El primer párrafo carga lo decisivo: es lo único que ZonaProp muestra sin expandir. Lo demás
que sabemos del departamento (los 3 m² semicubiertos, los accesos adaptados, el detalle del
barrio) está en los campos del portal, que es donde el interesado lo busca — repetirlo en
prosa alarga sin agregar.

## Campos del portal

| Campo | Valor |
|---|---|
| Superficie total | 45 m² |
| Superficie cubierta | 42 m² |
| Superficie semicubierta | 3 m² |
| Ambientes | 2 |
| Dormitorios | 1 |
| Baños | 1 |
| Cocheras | 0 |
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

- Cargó `cocheras: 0` con `garageCoverage: "Cubierta"`. **No tiene cochera** (confirmado por
  Martin 2026-07-30): el campo `garageCoverage` es el que sobra y se ignora. El aviso no la
  menciona.
- Verificar `buildingFloors: 2` con `departmentsPerFloor: 14`. Es una combinación rara para
  un edificio con ascensor; puede que estén invertidos. No afecta al texto (ninguno de los
  dos se menciona) pero sí a los campos del portal.
