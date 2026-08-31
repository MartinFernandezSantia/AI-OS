# Casos nuevos de cobertura — qué cubre cada uno y por qué

Los 93 casos existentes de la hoja `Casos de prueba` solo ejercitan 36 de los 73 materiales
del catálogo (medido el 2026-08-31 con `visor/scripts/datos-casos-cobertura.mjs`, corriendo
`cotizar()` — copiado literal de `n8n/build-flow.mjs` — contra el Excel real). Este archivo
agrega 37 casos: uno por cada material que hoy no tiene ninguno. Con eso, los 73 quedan con
al menos un caso.

Todos los precios se calcularon con el motor, no a mano. Corrida de verificación:
**37/37 OK** (ver el reporte de la sesión). Ninguno cae en "Derivar a consulta": las medidas
y cantidades elegidas son cotizables con el catálogo tal cual está hoy.

## Modo `pliego` (2 materiales) — medidas NUEVAS, no repetidas

`OPP brillo` y `OPP plata, holográfico, cristal o mate` son las versiones "sin cortar" (planchas
sin troquelar) de dos materiales que sí tienen casos por su versión troquelada. Ninguno de los
dos tenía un caso propio. Ambos comparten la geometría "solo impresión" (31×46 cm, sin
separación) — la misma que usa `Papel autoadhesivo solo impresión`.

Medida elegida: **8×8 cm**. La única medida ya declarada para estos materiales (en Productos,
"Medidas de referencia") es 5×5 cm ("Stickers en OPP brillo/holográficos sin cortar"); 8×8 no
aparece ni ahí ni en ningún caso existente.

| Material | Rinde (8×8, geo 31×46/0) | Tramo (100 piezas → 7 pliegos) | Total |
|---|---|---|---|
| OPP brillo | 15 | 1-9 pliegos → $2.400 | 7 × $2.400 = **$16.800** |
| OPP plata/holográfico/cristal/mate | 15 | 1-9 pliegos → $2.600 | 7 × $2.600 = **$18.200** |

## Modo `m2` (1 material) — medida nueva

`Vinilo y lona UV con blanco o barniz` no tenía ningún caso. Su único producto de referencia
(`Cartel adhesivo con blanco o barniz`) declara 50×70 cm. Elegí **60×80 cm** (0,48 m² → redondea
al mínimo facturable de 0,5 m²): 0,5 × $26.000 = **$13.000**.

## Modo `item` (34 materiales) — cada uno con su propio caso

En modo `item` la medida no determina el precio (salvo donde el material se cobra por
paquete cerrado), así que la regla de "medida nueva" no aplica — alcanza con que el pedido
suene natural. Elegí cantidades que un cliente real pediría por WhatsApp (ni triviales de 1
en materiales que se cobran por lote, ni exageradas).

**Tarjetas 9×5 — 11 materiales** (de las 14 variantes, 3 ya tenían caso: simple faz x100,
doble faz x500, simple faz encapsuladas x1000):

| Material | Cantidad | Precio |
|---|---|---|
| simple faz encapsuladas x100 | 100 | $16.500 |
| doble faz x100 | 100 | $16.500 |
| doble faz encapsuladas x100 | 100 | $18.700 |
| kraft simple faz x100 | 100 | $17.600 |
| kraft doble faz x100 | 100 | $24.200 |
| simple faz x500 | 500 | $28.000 |
| simple faz encapsuladas x500 | 500 | $38.000 |
| doble faz encapsuladas x500 | 500 | $45.000 |
| simple faz x1000 | 1000 | $42.000 |
| doble faz x1000 | 1000 | $54.000 |
| doble faz encapsuladas x1000 | 1000 | $59.000 |

Cada material se vende por paquete cerrado (paquete = 100/500/1000, derivado de la Unidad);
pedir exactamente la cantidad del paquete da `unidades_cobradas = 1` y el precio del tramo tal
cual está en Materiales.

**Papelería con paquete cerrado (2 materiales)**:
- `Sobres impresos x100` → 100 sobres = $25.000 (1 paquete).
- `Perforado x500` → 500 perforados = $4.000 (1 paquete). Sin medida: es un servicio, no una
  pieza con tamaño.

**Sin medida ni paquete — precio por unidad o precio plano (32 materiales restantes)**: todos
los demás modo `item` sin cobertura. Cantidades pensadas para no caer en el mínimo por trabajo
donde no corresponde y para sonar a pedido real:

| Material | Pedido | Total |
|---|---|---|
| Recetarios en negro | 5 recetarios | $20.000 |
| Recetarios en color | 5 recetarios | $22.500 |
| Impresión color A4 doble faz | 50 impresiones | $30.000 |
| Impresión color A3 | 10 impresiones | $12.000 |
| Impresión blanco y negro A3 | 5 impresiones | $3.000 |
| Impresión en papel ilustración | 20 impresiones | $16.000 |
| Impresión en opalina | 15 impresiones | $13.500 |
| Anillado metálico wire-o | 5 anillados | $16.000 |
| Encuadernación abrochada | 10 encuadernaciones | $20.000 |
| Encuadernación fresada | 3 encuadernaciones (tramo 2+) | $15.000 |
| Plastificado oficio | 1 plastificado | $2.400 |
| Troquelado y corte a medida | 20 troquelados (exento de mínimo) | $1.000 |
| Numerado correlativo | 20 numerados | $100.000 |
| Libros de medicina | 1 libro (Guyton) | $30.000 |
| Pack 4 libros de medicina | 1 pack | $99.000 |
| Anotadores personalizados en negro | 5 anotadores | $20.000 |
| Posters A3 y A2 | 2 posters | $3.200 |
| Porta banner tipo X | 1 porta banner | $32.000 |
| Cartelería en plástico corrugado A3 | 1 cartel de seguridad | $10.500 |
| Cartas y menús plastificados | 4 cartas | $10.400 |
| Impresión color más plastificado | 1 cartel de precios | $4.800 |

Notas sobre algunas elecciones:
- **`Numerado correlativo`** cuesta $5.000 **por unidad** en el Excel (sin escala por
  volumen). Con cantidades grandes el total crece rápido — probé 500 primero y dio
  $2.500.000, que además hubiera INFLADO `TOPE_MAGNITUD` del auditor (se deriva como
  `max(casos) × 8`, así que un caso nuevo carísimo relaja el sanity floor para todo el
  catálogo). Bajé a 20 unidades ($100.000): sigue siendo un pedido plausible (numerar 20
  entradas o comprobantes) sin ese efecto colateral. **Vale la pena preguntarle a TG si
  $5.000 por unidad es el precio real** — parece alto comparado con el resto de las
  terminaciones (anillado $2.400-3.200, laminado $330), pero no me corresponde corregirlo
  sin confirmar.
- **`Troquelado y corte a medida`** está marcado "Sin mínimo por trabajo" (terminación, no
  trabajo completo) y cuesta $50/unidad — con 1 sola unidad el total redondeado da $100, un
  número que no comunica bien qué se cobró. Subí a 20 unidades ($1.000) para que el caso sea
  más representativo de un pedido real.
- **`Porta banner tipo X`** reutiliza la medida 90×190 de su único producto de referencia.
  Es modo `item`: la medida no entra en el cálculo (no hay escala por m² para este material),
  así que repetirla no vuelve a probar nada ya probado — solo hace el pedido más natural.

## Verificación

Corrida contra `datos-casos-cobertura.mjs` real (no una copia), con `cotizar()` idéntico al
del builder:

```
=== RESULTADO: 37 OK / 0 FAIL de 37 casos ===
Materiales únicos en el archivo de datos: 37
Materiales con más de un caso nuevo (debería ser 0): 0

Total materiales en el catálogo: 73
Cubiertos ANTES (93 casos existentes): 36
Cubiertos DESPUÉS (93 + 37 nuevos): 73
Sin cubrir (debería ser 0): []
```

## Pendiente si Martín decide cargar esto al Excel

Este archivo son DATOS, no una escritura. Falta un script `cargar-*.mjs` (patrón
`visor/scripts/lib-xlsx.mjs`) que anexe estas 37 filas a la hoja `Casos de prueba`, con dry
run por defecto y `--apply` para escribir — igual que el resto de `scripts/*.mjs`. No lo
escribí porque la tarea pedía dejar los datos para revisión, no tocar el .xlsx.
