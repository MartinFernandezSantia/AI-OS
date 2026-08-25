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

**VA (curado, listo para producción):**
- **Lista de precios** — 39 filas de producto en 4 colecciones. La única realmente curada.
- **Pliegos A3** — escalas por pliego, geometría (área imprimible, separación), tabla de
  piezas por pliego.
- **Escalas por unidad** — sobres oficio inglés + carpetas A4 (laminadas / sin laminar).
- **Colecciones** — las que usa Lista de precios.

**NO VA:** Instrucciones (es guía de armado), Productos (sin curar), Lista maestra (sin
curar), Presupuestos (crudo), Productos reales.

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

### Hueco detectado: falta Papelería comercial

Las 4 colecciones en Lista de precios son Stickers con forma (20), Stickers para exterior
(6), Carteles y vidrieras (8), Banners y lonas (5).

**Papelería comercial no está.** Tarjetas, sobres, carpetas, talonarios, hojas membretadas
viven en la hoja "Productos", que se descarta por no estar curada. Pero sobres y carpetas
**sí tienen escalas** en "Escalas por unidad" (confirmadas con el sistema el 19/08).

→ Hay que decidir: se migran esos productos a Lista de precios con `Modo = unidad`, o
Papelería queda fuera de la v1. **Pendiente de Martín.**

---

## Plan de trabajo

### Fase 1 — Acomodar el Excel (primero, antes que nada)

1. **Hoja Materiales nueva.** Martín saca los materiales con SQL manual del sistema de
   presupuestos, los cura a mano, los pega. Cada material: nombre, unidad de cobro, precio
   o escala por cantidad, mínimo.
2. **Lista de precios apunta a Materiales.** La columna `Línea de precio` pasa a ser un
   dropdown contra la hoja Materiales (ya funciona así hoy con validación de datos).
3. **Resolver Papelería comercial** — migrar con `Modo = unidad`, o dejar fuera de v1.
4. **Consolidar las escalas.** Hoy viven en 3 lugares (Pliegos A3, Escalas por unidad, y
   las tarifas por m² dentro de Lista de precios). Decidir si se unifican en la hoja
   Materiales o quedan separadas por modo.

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
