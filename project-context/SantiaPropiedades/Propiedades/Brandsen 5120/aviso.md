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

~1.100 caracteres. El mínimo técnico de ZonaProp son 150, pero el aviso rinde mejor completo:
el algoritmo premia densidad de información y el interesado descarta lo que no responde sus
dudas.

```
Departamento de 2 ambientes de 45 m² en Villa Primera, muy luminoso y con balcón propio.
Es contrafrente con orientación este, así que recibe sol de mañana y se mantiene
silencioso, sin el ruido de la calle. Tiene cocina equipada, lavadero independiente y
calefacción: está listo para entrar a vivir.

La distribución aprovecha bien los metros. Living comedor amplio con salida directa al
balcón, dormitorio con placard, baño completo, cocina separada y lavadero aparte. Que el
lavadero sea independiente es un detalle que se agradece todos los días y que no suele
aparecer en departamentos de esta superficie.

Los 3 m² semicubiertos del balcón suman lugar real para desayunar o tomar aire sin achicar
los ambientes interiores. La orientación este y la condición de contrafrente hacen que el
departamento tenga muy buena luz natural durante toda la mañana.

El edificio cuenta con ascensor y encargado, y tiene accesos adaptados para personas con
movilidad reducida. Villa Primera es una zona residencial tranquila y arbolada, con
comercios, transporte y servicios a pocas cuadras, y buena conexión con el centro.

Se alquila sin amoblar. Escribinos y coordinamos la visita en el horario que te quede
cómodo.
```

El primer párrafo carga todo: es lo único que ZonaProp muestra sin expandir. El resto queda
colapsado detrás de "ver más", así que ahí van los argumentos de refuerzo, no los datos
decisivos.

**Ojo con el placard**: lo puse en el segundo párrafo porque es lo esperable, pero no vino en
el JSON del martillero. Si el dormitorio no tiene, sacá esas dos palabras antes de publicar.

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
- **¿El dormitorio tiene placard?** La descripción lo da por hecho. Si no tiene, sacar la
  mención antes de publicar.
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
