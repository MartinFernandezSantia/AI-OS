# Rediseño: Excel como fuente única + bot que cotiza

Estado: **plan aprobado, sin implementar**. Sesión 2026-08-25.
Sub-proyecto nuevo: `project-context/TerminalGrafica/whatsapp-rag/`.

---

## Por qué

El 2026-08-2x Martín le mostró el bot al cliente (TG). **No quedó conforme.** Trajo un
Excel que armó él junto a Claude (Opus 5, vía Cowork): instrucciones adentro del archivo +
datos de productos, y conversaba con Claude para obtener precios y cálculos. **Le funcionó
entre 80% y 90% de las veces, y con eso está contento.**

Dos problemas concretos con lo que hay hoy:

1. **La carga por dashboard no va.** Formularios para cargar y actualizar muchos datos es
   engorroso. El cliente se maneja mejor contra un Excel, y es cierto: para carga masiva,
   la planilla gana.
2. **El bot no cotiza.** Hoy da precio por unidad y abre un abanico de opciones. Lo que se
   pide es: piden 250 stickers de 5x5 → un número → listo. Menos vueltas, menos preguntas.

Se salva **RAG + firewall**. Todo lo demás está en discusión — no tomar lo actual como
base a seguir y expandir, puede que haya que rehacerlo.

---

## Decisiones tomadas (cerradas en la sesión)

| Tema | Decisión |
|---|---|
| Fuente de datos | **El Excel, única.** Se van `bot.product`, `bot.variant`, `job_variant`, `job_variant_material`. |
| Dashboard | **Se retira** como vía de carga. |
| Materiales | Una hoja del Excel, curada **a mano** por Martín (SQL manual como punto de partida). |
| Sistema de presupuestos | **Desconectado.** No se toca. La idea de integrarlo se descarta: limita y complica. |
| Materiales por producto | **Uno solo.** "Vinilo UV montado en corrugado" es UN material, no una composición. Si hace falta otra combinación → se crea otro material. |
| Quién calcula | **El LLM**, con instrucciones precisas y datos correctos en el chunk. No motor determinista (todavía). |
| Ingesta v1 | **Script CLI local** contra el .xlsx. Drive/cron y pantalla de subida quedan para después. |
| Canal v1 | **Chat Trigger + memoria de n8n.** Sin Chatwoot ni WhatsApp — para testear rápido. |
| Catálogo de la v1 | **Solo las 39 filas de Lista de precios.** No se agregan productos desde otras hojas. Modos `pliego` y `m2` únicamente. |
| `Cant.` y `PRECIO` | **Se sacan del producto.** El producto es el framework (medida + material + conversión); la cantidad la pone el cliente y el precio lo calcula el bot. Las 39 filas quedan como casos de prueba. |
| Sinónimos | **No se agregan todavía.** Probar primero con nombre + descripción, que deberían alcanzar. Se suman solo si el RAG falla. |
| Upsell | **Dentro de la descripción**, mejor acomodado. Ver cómo lo toma el bot antes de darle columna propia. |
| Info del negocio | **Fuera de alcance por ahora.** Sigue en `bot.business_info`. |
| Materiales sin troquelar | **Entran** a la hoja Materiales aunque ningún producto los use hoy. |
| Piezas por pliego | **Precalculado en el chunk** (opción A). El bot no calcula geometría: lee el número y hace `ceil(cantidad ÷ piezas)`. Medidas fuera de tabla → "consultanos". |
| Validación del Excel | **Fuera de alcance.** Happy path primero. Se arregla sobre la marcha. |
| System prompt | **No se toca todavía.** Primero acomodar el Excel, después el workflow. |

### Sobre que calcule el LLM

Martín: *"tengo la teoría de que el LLM puede hacer cálculos y puede hacer las cosas bien,
pero necesita instrucciones precisas y datos correctos."* El precedente es directo: el
cliente le pasó el mismo Excel a Opus con instrucciones adentro y anduvo 80-90%.

Objeción registrada y **retirada**: Gemini 3.1 Flash Lite es más chico que Opus y la cadena
de cálculo tiene varios pasos (dividir, redondear arriba, buscar tramo, multiplicar,
redondear a $100, chequear mínimo). Queda como **riesgo a medir**, no como bloqueante.

El colchón: al cerrar el pedido se deriva a mail con disclaimer — el número del bot es
orientativo, la confirmación es humana. Ej:

> Te paso un estimado: **$15.400**. Para confirmarlo y cerrar el pedido escribinos a
> [mail], que ahí verificamos que el trabajo se pueda hacer tal cual y te pasamos el
> total definitivo.

---

## Modelo de datos (3 capas)

```
MATERIALES  →  nombre · unidad de cobro (pliego/m²/unidad) · escala por cantidad · mínimo
                                    ↑ referenciado por
PRODUCTOS   →  lo que el bot ofrece · UN material · regla de conversión · datos propios
                                    +
PARÁMETROS  →  mínimo por trabajo $4.000 · redondeo a $100
```

**El producto no es un pack.** "250 stickers 3x3 = $6.600" no es un producto de catálogo,
es *una consulta ya resuelta*. El producto es "sticker 3x3 en papel autoadhesivo", y 250
es lo que pidió el cliente. Las filas actuales de Lista de precios son **ejemplos
precalculados del motor**, no SKUs.

**Cómo cotiza** (modo pliego): cantidad pedida ÷ piezas por pliego → redondear hacia
arriba → buscar el tramo de la escala para *esa cantidad de pliegos* → multiplicar →
redondear a $100 → aplicar mínimo.

Modo m²: (ancho × alto × cantidad) ÷ 10.000 → aplicar mínimo facturable 0,5 m² → por la
tarifa $/m² → redondear.

---

## Qué se salva del Excel actual

Analizado con lectura directa del .xlsx (9 hojas).

**VA:**
- **Lista de precios** — 39 filas en 4 colecciones. **La única fuente de verdad de qué
  productos existen.**
- **Pliegos A3** — escalas por pliego + geometría (área imprimible, separación) + tabla de
  piezas por pliego. Alimenta a los 20 productos en modo `pliego`.
- **Colecciones** — las 4 que usa Lista de precios.

**NO VA:** Instrucciones (guía de armado), Productos (sin curar), Lista maestra (sin
curar), Presupuestos (crudo), Productos reales, **Escalas por unidad** (sus escalas son de
sobres y carpetas, que no están en Lista de precios → ningún producto de la v1 las usa).

**Cambio ya hecho por Martín:** se eliminó la columna `Tamaño` ("3x3 cm") de Lista de
precios — redundante con `Ancho (cm)` + `Alto (cm)`.

### Hallazgo: `Modo` ya es el discriminador de columnas

Verificado sobre las 39 filas:

| Modo | Filas | Columnas que usa | Columnas vacías |
|---|---|---|---|
| `pliego` | 20 | Piezas por pliego · Pliegos · $/pliego | m2 facturados · $/m2 |
| `m2` | 19 | m2 facturados · $/m2 | Piezas por pliego · Pliegos · $/pliego |

Esto **valida el requisito de chunk disperso**: la ingesta lee `Modo` y emite solo las
columnas con dato. El chunk de stickers habla de pliego; el de lonas habla de m² y no
menciona pliego. Ninguna columna vacía contamina el embedding.

Y valida el **esquema dinámico**: la ingesta lee los headers del Excel, no un shape fijo.
Si el cliente agrega "Gramaje" o "Plazo de entrega", entra sola — sin ALTER TABLE, sin
deploy, sin intervención de Martín. Era exactamente el problema del modelo actual.

### Alcance congelado: solo lo que está en Lista de precios

Las 4 colecciones son Stickers con forma (20), Stickers para exterior (6), Carteles y
vidrieras (8), Banners y lonas (5). **39 filas, dos modos (`pliego` y `m2`). Eso es todo
el catálogo de la v1.**

**Papelería comercial NO entra.** Tarjetas, sobres, carpetas, talonarios y hojas
membretadas están en la hoja "Productos" (sin curar), y sobres/carpetas tienen escalas
confirmadas en "Escalas por unidad" — pero **no se migran**. Decisión explícita de Martín:
no se agregan productos desde otras hojas por más que haya precios disponibles en ellas.

**Regla de alcance:** Lista de precios es la única fuente de verdad de qué productos
existen. Se puede modificar la **estructura** (orden de columnas, nombres, cuáles se
conservan); **no se agrega contenido**. El cliente re-cura la hoja más adelante y ahí
podrá sumar lo que quiera — incluida Papelería, si decide.

Consecuencia para el diseño: el modo `unidad` **no existe en la v1**. El parser solo
necesita soportar `pliego` y `m2`. Que aparezca un tercer modo es un cambio futuro, no un
requisito de ahora.

---

## Plan de trabajo

### Fase 1 — Acomodar el Excel (primero, antes que nada)

1. **Hoja Materiales nueva.** No hace falta SQL del sistema de presupuestos: **los 7
   materiales que usa la v1 ya están en el Excel**, repartidos en dos lugares. La tarea es
   juntarlos en una hoja. Verificado sobre las 39 filas:

   | Modo | Material | Productos | Precio | Dónde está hoy |
   |---|---|---|---|---|
   | pliego | Papel autoadhesivo troquelado o medio corte | 13 | escala 5 tramos | Pliegos A3 |
   | pliego | OPP brillo troquelado | 4 | escala 3 tramos | Pliegos A3 |
   | pliego | OPP plata, holográfico, cristal o mate troquelado | 3 | escala 3 tramos | Pliegos A3 |
   | m² | Vinilo UV troquelado | 6 | $28.000/m² · mín 0,5 | Lista de precios (tope) |
   | m² | Vinilo y lona UV | 4 | $21.000/m² · mín 0,5 | Lista de precios (tope) |
   | m² | Vinilo UV montado en corrugado | 4 | $30.000/m² · mín 0,5 | Lista de precios (tope) |
   | m² | Lona | 5 | $16.000/m² · mín 0,5 | Lista de precios (tope) |

   **Ojo con la forma del precio:** los de `pliego` son **escalas por tramos** (1-1 $2.500,
   2-10 $2.200, 11-50 $2.000…); los de `m2` son **tarifa plana + mínimo facturable**. Si la
   hoja los unifica, las columnas tienen que servir para ambas formas.

   **Sobrantes a decidir** (existen en el Excel, ningún producto los usa):
   - `Papel autoadhesivo solo impresión`, `OPP brillo`, `OPP plata/holográfico/cristal/mate`
     — las versiones **sin troquelar**. Ningún producto de la v1 las referencia.
   - `Vinilo y lona UV con blanco o barniz` ($26.000/m²) — **caso aparte**: ningún producto
     lo usa, pero dos descripciones lo mencionan ("Consultá la opción con blanco o barniz").
     El bot podría necesitarlo para contestar aunque no cotice un producto con él.
2. **Lista de precios apunta a Materiales.** La columna `Línea de precio` pasa a ser un
   dropdown contra la hoja Materiales (ya funciona así hoy con validación de datos).
3. **Consolidar las escalas de los dos modos.** Las de `pliego` están en la hoja Pliegos A3;
   las de `m2` son las tarifas al tope de Lista de precios. Decidir si se unifican en la
   hoja Materiales (una escala por material) o quedan separadas por modo. Las de "Escalas
   por unidad" (sobres/carpetas) **no se tocan**: ningún producto de la v1 las usa.

### Fase 2 — Parser + ingesta CLI

5. Script que lee el .xlsx, detecta headers dinámicamente, y arma un chunk por producto
   con **solo las columnas con dato** + la escala de su material embebida.
6. Ingesta a `bot.rag_catalog` (la tabla se mantiene, es del RAG).

### Fase 3 — Workflow de test

7. Flow n8n mínimo: Chat Trigger + memoria + tool RAG. Sin Chatwoot, sin firewall todavía.
8. **System prompt nuevo** — recién acá. Partir de las instrucciones del Excel (las que ya
   funcionaron con Opus) + las reglas de cálculo. Objetivo 2k tokens, techo 3k.
9. Flujo de cierre: detectar intención de pedido → disclaimer + derivación a mail.

### Fase 4 — Medir antes de prometer

10. Set de casos con resultado conocido: **las 39 filas de Lista de precios ya son eso**
    (entrada + precio correcto). Correrlas contra el bot y medir el % de aciertos.
    Si Flash Lite no llega, subir de tier es una decisión de datos, no de intuición.

### Fase 5 — Producción

11. Enchufar firewall + Chatwoot + WhatsApp.
12. Recién ahí: Drive + cron, o pantalla de subida.

---

## Riesgos anotados

- **Aritmética de Flash Lite.** Medible en Fase 4. Mitigación si falla: subir de tier, o
  precalcular los tramos en el chunk para que el LLM solo lea y no divida.
- **Se pierde el guardrail de precios validados.** Hoy el LLM nunca tipea un número
  (escribe `{P1}`, un nodo determinista lo reemplaza y valida contra catálogo). Si ahora
  calcula, ese mecanismo no aplica igual. Decidir a conciencia qué reemplaza esa red — al
  menos un chequeo de sanidad (negativo, orden de magnitud absurdo) antes de enviar.
- **Doble fuente de verdad.** Mientras el dashboard siga vivo apuntando a `bot.product`,
  hay dos fuentes. Retirarlo de una, no dejarlo "por las dudas".

---

## Lo que NO se toca en este rediseño

- `bot.rag_catalog`, `bot.rag_business_info` — el RAG se queda.
- El firewall (`bot.blocklist`, `firewall_check`, `fw_log`) — se queda.
- `bot.log` — el log unificado se queda, es lo que permitió cazar los últimos 3 bugs.
- El sistema de presupuestos — **no se toca, queda desconectado.**
