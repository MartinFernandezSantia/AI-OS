# Fase 3 — Workflow n8n v1 (plan)

> Sesión de planificación. Plan primero, build después. El build es la próxima sesión.
> Referencia (NO tocar): `../whatsapp-rag-lite/` — en particular `scripts/build-flow.mjs`,
> donde viven los prompts viejos que acá se recortan.

## Alcance v1 (ya acordado)

- Canal: **Chat Trigger de n8n**. Sin Chatwoot, sin WhatsApp (Fase 5).
- **Sin debounce y sin firewall** (vuelven en Fase 5).
- **Memoria interna de n8n** (Simple Memory), no Postgres: el bot se prueba directo
  desde el nodo de Chat.
- Se basa en el flow viejo como referencia de cableado (agente + tool PGVector +
  embeddings Gemini + salida estructurada), no de contenido.

## Arquitectura del flow (~10 nodos vs 22 del viejo)

```
Chat Trigger
   └─ Agente (AI Agent, systemMessage generado por el builder)
        ├─ Modelo: OpenRouter → gemini-3.1-flash-lite
        ├─ Memoria: Simple Memory (window ~10, sessionId del Chat Trigger)
        ├─ Tool buscar_catalogo: PGVector Vector Store → bot.rag_catalog (topK 3-4)
        │    └─ Embeddings Google Gemini: models/gemini-embedding-001 (MISMO que la ingesta)
        └─ Salida estructurada (desglose de cotización, ver guardarraíl)
   └─ Traer Escalas (Postgres: metadata del material declarado)
   └─ Auditar Cotización (Code: re-cálculo determinista + sanity)
   └─ Responder (mensaje del agente + veredicto visible en el chat de prueba)
```

Qué NO viaja del flow viejo: debounce/Decidir, firewall, Leer/Log Decisiones (bot.log),
Contexto Previo, Buscar/Insertar Precios (`{Pn}`), **Agente Verificador**, **Corrector**,
tool `consultar_info_negocio` (propuesta: fuera de v1, vuelve en Fase 5 — el set de 46
casos no la necesita y ahorra un sub-árbol entero).

Verificar al construir: el nodo PGVector contra la tabla ya existente `bot.rag_catalog`
(columnas `id/text/metadata/embedding` = defaults de LangChain; la creó la ingesta del
visor, no el nodo — smoke test de retrieval antes de nada).

---

## El TRIM — system prompt del agente

Punto de partida: prompt viejo ≈ 20.000 chars ≈ **5,2k tokens** (más Verificador 850 y
Corrector 350 ≈ 6,4k total). Objetivo **2k**, techo **3k**.

### Veredicto sección por sección (prompt viejo)

| Sección vieja | ~tokens | Veredicto | Motivo |
|---|---|---|---|
| Identidad ("asistente, no el negocio") | 250 | **ACHICA → 80** | La idea sobrevive en 2 líneas; muere la casuística. |
| Flujo 5 etapas | 520 | **ACHICA → 150** | Quedan 4 etapas. Muere la casuística de "categoría amplia" (impresiones/tarjetas): en el catálogo nuevo cotizar necesita medida + cantidad + material, y eso define solo qué repreguntar. |
| Trabajos (combos `[tN]`) | 290 | **SE VA** | No hay trabajos en las 39 filas. |
| Preguntar vs proponer | 390 | **ACHICA → integrado al flujo** | Sobrevive la regla madre (preguntá lo que falta, no listes de más) en 2 líneas de la etapa FALTA DATO. |
| Pedidos con varios productos | 180 | **ACHICA → 1 línea** | "Una búsqueda por pedido, cada uno por separado." |
| Qué preguntar según tipo (guía de papeles) | 680 | **SE VA** | Papeles, tarjetas, gramajes: nada de eso está en el catálogo v1 (stickers/etiquetas/carteles/lonas). |
| Guard de nicho (promo facultad) | 250 | **SE VA** | Sin productos de nicho en las 39 filas. |
| Info del negocio | 390 | **SE VA de v1** | Sin tool `consultar_info_negocio`. Queda 1 línea: lo que no sabés se confirma por mail. Vuelve en Fase 5. |
| Precios `{Pn}` (placeholders) | 500 | **SE VA entero** | El LLM ahora escribe números. Muere también "NUNCA des totales": **dar el total es el pedido del cliente**. Lo reemplazan "Cómo cotizar" + "Presentar el precio". |
| Cómo escribir para WhatsApp | 680 | **ACHICA → 250** | Quedan: ~100 chars objetivo / ~200 techo, máx 2 párrafos, listas con "•", negrita moderada, sin emojis. Mueren los ejemplos antes/después largos. |
| Reglas siempre | 860 | **ACHICA → 350** | Quedan: anclaje en la tool, no negar nada (salvo fotocopias, 1 línea), palabras del cliente, pedidos solo por mail/local, enojo→contacto, sin agregados no pedidos. Mueren los matices redundantes con el flujo. |
| Salida estructurada | 440 | **REDISEÑA → 200** | De auditoría de catálogo (`nombre_catalogo`/`[vN]`) a **desglose del cálculo** (ver guardarraíl). |
| **NUEVO: Cómo cotizar** | — | **ENTRA ≈ 650** | La PARTE 1 de la hoja Instrucciones, casi literal (ya validada: 39/39 + 7 casos). |
| **NUEVO: Parámetros + casos** | — | **ENTRA ≈ 160** | Inyectados por el builder desde el Excel. |

**Presupuesto resultante ≈ 1,9–2,1k tokens** (~6,5k chars). El Verificador y el Corrector
aportan **0** en v1 (se retiran, ver abajo). El builder **falla el build si el prompt
supera 3k tokens** y avisa si pasa de 2k (estimador de `visor/lib/tokens.ts`).

### Estructura del prompt nuevo (borrador para el build)

Plantilla estática + 3 inyecciones desde el Excel (`{{...}}`):

```text
Sos el asistente de WhatsApp de Terminal Gráfica, una imprenta argentina. Atendés en
nombre del negocio (podés decir "nosotros") pero sos el asistente, no la empresa.
Castellano rioplatense (vos), cordial y directo, sin emojis.

Tenés MEMORIA de la conversación y UNA tool: buscar_catalogo — busca productos y
materiales del catálogo por significado; devuelve descripción, medidas de referencia,
geometría del material y su escala de precios.

## Flujo
1) SALUDO: si es el primer contacto, presentate en una línea y preguntá en qué podés
   ayudar. No llames la tool. No vuelvas a presentarte después.
2) COTIZAR: cuando tenés producto + medida + cantidad, llamá buscar_catalogo, elegí el
   material que corresponde y calculá con las reglas de abajo. Respondé con EL TOTAL.
3) FALTA DATO: para cotizar necesitás producto, medida y cantidad. Si falta algo,
   preguntá SOLO eso, corto y directo (máximo 2 preguntas). Mientras preguntás no
   listes opciones ni materiales que el cliente no pidió. El mensaje TERMINA en la
   pregunta, sin coletillas ("¿algo más?").
4) CIERRE / AVANZAR: si el cliente quiere hacer el pedido o mandar el archivo,
   derivalo al mail terminalgrafica@gmail.com o al local. Por este chat NO se toman
   pedidos ni se reciben archivos.
Si pide varios productos, tratá cada uno por separado: una búsqueda por pedido, y cada
producto se cotiza como un trabajo aparte (su mínimo y redondeo aplican por separado).

## Cómo cotizar
{{INSTRUCCIONES_PARTE_1}}

## Parámetros vigentes
{{PARAMETROS}}

Ejemplos (parámetros):
{{CASOS_PARAMETROS}}

## Presentar el precio
- Respondé el TOTAL final, formato $ argentino. Si ayuda, una línea de desglose:
  "250 stickers 5x5: $15.400 (7 pliegos)".
- Si el rinde da 0, la medida no entra, o el material no aparece en lo que devolvió la
  tool: NO inventes ni improvises un precio — decí que eso lo confirmás por mail.
- Los precios incluyen IVA. No prometas plazos de entrega ni envíos: se confirman por mail.

## Reglas duras
- TODO dato de catálogo (materiales, medidas, geometría, escalas, precios) sale de lo
  que buscar_catalogo devolvió EN ESTE turno. Sin resultado a la vista no afirmes ni
  niegues: ofrecé confirmarlo por mail.
- NUNCA afirmes que algo "no lo hacemos". Lo único que no se trabaja: fotocopias — y
  solo lo mencionás si el cliente pregunta por eso.
- Usá las palabras del cliente ("calcos", "stickers"), aunque el catálogo lo llame
  distinto. El nombre de catálogo es interno.
- No ofrezcas agregados ni alternativas que no pidió. Respondé lo que pidió.
- Cliente enojado o pide hablar con una persona: no insistas con el catálogo; pasale
  el mail y el local.

## Cómo escribir (WhatsApp, en un celular)
- Apuntá a ~100 caracteres; techo ~200, salvo listas. Sin preámbulos, sin repetir lo
  que el cliente dijo.
- Máximo 2 párrafos (un solo renglón en blanco en todo el mensaje). Para enumerar,
  cada opción en su renglón con "• ", sin renglones en blanco entre ítems.
- *Negrita* con moderación (producto o precio). Nada de #, títulos ni tablas.
- Cerrá con UNA pregunta corta solo si hace falta; nunca dos.

## Salida estructurada
Junto al mensaje devolvés el desglose de cada cotización del turno (ver schema):
material_catalogo EXACTO como vino de la tool, modo, medida, cantidad, rinde,
unidades cobradas, precio del tramo, si aplicaste mínimo o redondeo, y el total.
Si el turno no cotiza (saludo, repregunta), cotizaciones: []. Todo lo declarado tiene
que salir de la tool: este bloque existe para auditar tu cálculo.
```

Las inyecciones, todas leídas del `.xlsx` al construir (fuente única intacta):

| Placeholder | Fuente | Cómo |
|---|---|---|
| `{{INSTRUCCIONES_PARTE_1}}` | Hoja Instrucciones | Filas entre `═══ PARTE 1` y `═══ PARTE 2`, literales (incluye los 2 ejemplos trabajados y la regla rinde-0). La PARTE 2 (cómo cargar) NO va al bot. |
| `{{PARAMETROS}}` | Hoja Parámetros | Las 3 filas como líneas ("Mínimo por trabajo: $4.000 — ningún trabajo se cobra menos…"). |
| `{{CASOS_PARAMETROS}}` | Hoja Casos de prueba | Las filas cuyo Pedido contiene `(activa el` (hoy: mínimo y redondeo), formateadas como ejemplo entrada→total. Convención a documentar en la PARTE 2 del Excel más adelante. |

### Verificador y Corrector: se retiran en v1

El Verificador viejo era un guardrail de **política de canal** (derivación prematura,
pedidos por chat, no_trabajado, fuera de rol): casi todos sus checks solo tienen sentido
con clientes reales en WhatsApp. En un chat de prueba interno no protegen nada y cuestan
una llamada LLM por turno. El Corrector existía para editar lo que el Verificador marcaba.

- v1: **fuera los dos** (−1,2k tokens, −2 llamadas LLM por turno).
- Fase 5: se re-evalúa el Verificador de política con el prompt nuevo como base (sus
  checks siguen siendo válidos para producción; `no_trabajado` ya queda cubierto en parte
  por la regla de fotocopias del prompt del agente).
- Lo que el Verificador NO cubría — que los números estén bien — lo cubre el guardarraíl
  nuevo, que es determinista, no otro LLM.

---

## El guardarraíl de precios (la pregunta abierta — propuesta)

Contexto: en el bot viejo el LLM nunca tipeaba números (`{P1}` + nodo determinista que
validaba contra catálogo). Ahora el LLM calcula y esa red no existe.

Opciones evaluadas:

- **A. Identidades internas del desglose** (nodo Code, sin catálogo): con la salida
  estructurada alcanza para verificar la aritmética — ceil/floor bien hechos,
  `total = unidades × tramo`, mínimo aplicado, redondeo al múltiplo. Barato; no detecta
  rinde o tramo EQUIVOCADOS (parámetros mal extraídos del chunk).
- **B. A + re-cálculo contra el catálogo**: un nodo Postgres trae la `metadata` del
  material declarado desde `bot.rag_catalog`, y el nodo Code re-ejecuta la fórmula
  completa (geometría → rinde → tramo → mínimo → redondeo) y compara total contra total.
  Detecta prácticamente todo lo detectable.
- **C. Verificador LLM que recalcula**: caro y con la misma falibilidad aritmética que
  el agente. Descartado.

**Recomendación: B.** No reabre la decisión "el LLM calcula": el LLM sigue siendo quien
interpreta el pedido, elige material y responde; el re-cálculo es una **auditoría** con
los mismos datos, no un motor de pricing frente al cliente. Y para la Fase 4 vale oro:
cuando un caso falle, el auditor dice *qué* falló (rinde mal ≠ tramo mal ≠ aritmética
mal), que es justo lo que decide si se sube de tier de modelo o se ajusta el chunk.

Detalle de B:

1. **Salida estructurada del agente** (reemplaza a la vieja): por cotización →
   `{ material_catalogo, modo, ancho_cm, alto_cm, cantidad, rinde, unidades_cobradas,
   precio_tramo, aplico_minimo, aplico_redondeo, total }`. Turnos sin cotización → `[]`
   (el auditor aprueba y no hace nada).
2. **Traer Escalas** (Postgres): `select metadata from bot.rag_catalog where
   metadata->>'material' = $1` por cada material declarado (mismo patrón que el viejo
   "Buscar Precios": re-consultar por lo declarado, no confiar en lo que el LLM dice
   haber leído).
3. **Auditar Cotización** (Code): re-calcula con la fórmula de encaje + escala + los
   Parámetros (que el builder hornea como constantes desde el Excel) y compara.
   Sanity floor incluido aunque el desglose venga vacío o roto: total > 0, total ≥ mínimo
   por trabajo, múltiplo del redondeo, tope de orden de magnitud (constante del builder,
   p.ej. $500.000: el caso más caro del catálogo hoy es $64.000).
4. **Al fallar, en v1**: NO se corrige en silencio — el chat de prueba muestra la
   respuesta del bot + el veredicto (`⚠ auditoría: rinde declarado 40, calculado 24`).
   Estamos midiendo, queremos VER los fallos. La política de producción (¿corregir?
   ¿derivar a mail?) se decide en Fase 5 con los datos de la Fase 4.

Prerrequisitos de B (cambios chicos, previos al build del flow):

- **Visor/ingesta**: agregar a `meta` del chunk la **escala** (tramos con
  desde/hasta/precio), el **mínimo facturable** y la **unidad** ya están / faltan los
  tramos — hoy `meta` lleva geometría pero no precios. Cambio en `chunk.ts` + re-ingestar.
- **Cuarta copia de la fórmula de encaje** (geometria.ts, lib-xlsx.mjs, y ahora inline en
  el nodo Code): riesgo de desalineación conocido y ya asumido dos veces. Mitigación
  igual que con `price-display.ts` en el bot viejo: el builder la emite desde un único
  string/función compartida en el script, y los 7 rindes históricos como test.

---

## Builder del flow

Mismo patrón que el bot viejo (`build-flow.mjs` genera el JSON importable), pero propio:

- `whatsapp-rag/n8n/build-flow.mjs` (`pnpm flow:build` desde `visor/` o raíz del
  sub-proyecto). Importa el lector del `.xlsx` (`visor/scripts/lib-xlsx.mjs`) y arma:
  1. El **system prompt** (plantilla + 3 inyecciones) → gate de tokens (>3k falla,
     >2k avisa).
  2. El **flow JSON** completo (`n8n/flows/cotizador-v1.json`) con el prompt embebido,
     el schema de salida y el código del auditor (con Parámetros horneados).
- El flow se reconstruye cuando cambian los parámetros del Excel → re-importar en n8n
  (mismo ciclo de trabajo que ya se usaba).
- Credenciales que pide el flow al importarlo: OpenRouter (chat), Google AI Studio
  (embeddings `gemini-embedding-001`), y `BOT_DB` (PGVector + Traer Escalas).

## Pasos del build (próxima sesión)

1. Visor: escala + mínimo a `meta` en `chunk.ts` (+ tests) y **re-ingestar**.
2. `n8n/build-flow.mjs`: prompt + flow + auditor + gate de tokens.
3. Importar en n8n, cablear credenciales, smoke test de retrieval (¿el nodo PGVector
   lee `bot.rag_catalog` tal como la creó el visor?).
4. Humo con 4 casos a mano por el Chat: 250 stickers 3x3 → $6.600 · 100 vinilo UV 5x5 →
   $14.000 (mínimo facturable) · 10 stickers 3x3 → $4.000 (mínimo por trabajo) · 1 lona
   90x60 → $8.600 (redondeo). Recién después, Fase 4 con los 46.

## Preguntas que quedan abiertas (para Martin / TG)

- **Mínimo por trabajo con varios productos**: ¿aplica por producto o por pedido
  completo? El plan asume POR PRODUCTO (cada producto = un trabajo). Confirmar con TG.
- **Contacto en v1** para "quiero hablar con una persona": sin tool de info, el prompt
  solo tiene el mail. ¿Alcanza para v1/test? (En Fase 5 vuelve `consultar_info_negocio`.)
- **topK** del retrieval: con 7 chunks, arrancar con 3 y ver en Fase 4 si el material
  correcto entra siempre.
