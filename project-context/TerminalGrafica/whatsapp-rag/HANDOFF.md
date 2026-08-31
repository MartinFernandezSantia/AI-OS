# Handoff — WhatsApp RAG (bot que cotiza)

> Archivo compartido y sobrescrito entre sesiones. Sin fechas: refleja el estado actual.
> Al terminar una sesión, actualizalo — no lo dupliques ni le agregues secciones por fecha.

## Qué es esto en una línea

Rediseño del bot de WhatsApp de Terminal Gráfica: el Excel pasa a ser la fuente única y el
bot **calcula** precios en vez de recitar precios cerrados.

## Por qué existe

Martín le mostró el bot anterior al cliente (TG) y **no quedó conforme**. Trajo un Excel que
armó él con Claude (Opus vía Cowork) y le funcionaba 80-90% de las veces, y con eso está
contento. Dos problemas con lo que había:

1. **La carga por dashboard no va.** Para carga masiva el cliente se maneja mejor con una
   planilla. Es cierto.
2. **El bot no cotizaba.** Daba precio por unidad y abría un abanico de opciones. Lo que se
   quiere: piden 250 stickers 5x5 → un número → listo.

Se salva RAG + firewall. Todo lo demás estaba en discusión.

## Dónde está todo

```
project-context/TerminalGrafica/whatsapp-rag/
  HANDOFF.md                 ← este archivo
  Catalogo-TG-v3.xlsx        ← LA FUENTE ÚNICA (la base está al día: 62 chunks)
  Catalogo-TG-v2.xlsx        ← el anterior, con los 31 productos. Referencia, no se toca
  Catalogo_WhatsApp_Terminal_Grafica (1).xlsx  ← entrega del cliente, por única vez
  n8n/                       ← Fase 3: EMPEZAR ACÁ
    README.md                            ← el flow, el auditor, las trampas, los casos de humo
    build-flow.mjs                       ← EL BUILDER: Excel + prompt → flow JSON (con los tests)
    test-auditor.mjs                     ← test de los nodos Code contra el JSON emitido
    casos-conversacionales.md            ← 40 casos que el Excel NO puede probar (repreguntas,
                                           multi-producto, no-inventar, derivación). Interno:
                                           se corren a mano contra el chat, no van al cliente
    armar-prompt.mjs                     ← plantilla + Excel → prompt (con gate de tokens)
    prompt-final.txt                     ← generado: el prompt que ve el modelo
    flows/cotizador-v1.json              ← generado: lo que se importa en n8n
  plans/
    rediseno-excel-motor-cotizacion.md   ← el plan madre (por qué, decisiones, fases)
    workflow-n8n-v1.md                    ← el plan de la Fase 3 (trim, auditor, acuerdos)
    system-prompt-v1.md                   ← LA PLANTILLA del prompt (esto se edita)
    visor-chunks.md                       ← el plan del visor + la ampliación de ingesta
  visor/                     ← app Next 16, la herramienta de trabajo
    lib/{xlsx,parse,chunk,tokens}.ts      ← lógica pura (la reusa la ingesta)
    lib/{embeddings,db,actions}.ts        ← server-only: ingesta
    scripts/*.mjs                          ← edición quirúrgica del .xlsx (ver abajo)
      datos-*.mjs / cargar-*.mjs           ← los DATOS separados del escritor: se revisan sin leer código
      cargar-casos-cobertura.mjs           ← corrige cantidades + agrega casos (idempotente por Pedido)
      quitar-precio-descripcion.mjs        ← saca precios literales de las descripciones
      pendientes-cliente.mjs               ← qué del Excel del cliente falta cargar (y por qué)
      podar-pendientes.mjs                 ← deja en la copia del cliente solo lo que falta decidir
      describir-colecciones.mjs            ← la descripción que encabeza TODOS los chunks de una colección
      volcar-hoja.mjs                      ← HOJA="Productos" … vuelca una hoja como texto
```

Referencia (NO tocar, es el bot anterior): `../whatsapp-rag-lite/`.

## El catálogo del cliente ya está cargado

El cliente trajo un Excel propio (armado con Claude, sin nuestro esquema). Se lo normalizó
HACIA el nuestro: de ahí salieron los datos y los aprendizajes, no al revés. Plan y
decisiones en `plans/normalizar-catalogo-cliente.md`.

**`Catalogo-TG-v3.xlsx` es ahora la fuente única.** Tiene los 31 productos del v2 más los
68 del cliente: 99 productos, 73 materiales, 13 colecciones, 132 casos de prueba. Incluye la
tarifa de `Vinilo y lona UV` ($21.000 → $22.000 el m², confirmada por TG el 18/08/2026).

✅ **La base está al día**: Martin re-ingestó el 31/08. Los 62 chunks incluyen los 7
materiales nuevos, la descripción del escaneo sin su precio literal y la línea de unidad
de cobro para las medidas continuas. Verificado en vivo, no deducido.

Los scripts leen el archivo con `CATALOGO=Catalogo-TG-v3.xlsx node <script>` (sin la
variable apuntan al v2, que quedó de referencia).

**Qué destapó la carga**: tres bugs del auditor, todos de la misma forma — el modelo
declaraba bien y el auditor interpretaba mal. Detalle en "Estado: qué falta" § *El catálogo
del cliente, cargado*. La lección que vale para lo que venga: **la relación entre lo que
pide el cliente y la unidad de cobro es un dato del catálogo**, no algo que el prompt deba
despejar — esa apuesta ya había fallado con los pliegos en la Fase 4.

## Estado: qué está hecho

**El Excel** (`Catalogo-TG-v3.xlsx`) — 6 hojas visibles + `_listas` oculta.
99 productos, 73 materiales, 13 colecciones, **132 casos de prueba** (los 73 materiales con
al menos un caso; antes eran 93 casos y 36 materiales cubiertos). Los 31 productos originales
(11 materiales, 24 tramos, 4 colecciones) más los 68 que trajo el cliente.
Las reglas de la hoja Instrucciones reproducen **39/39** de los precios que calculó el cliente,
más 7 casos nuevos del motor (verificados a mano contra la fórmula y las escalas).

**Tres modos de cobro**, derivados del PREFIJO de la columna `Unidad` del material:
`pliego` (rinde geométrico), `m2` (superficie) e `item` (la unidad de cobro es un ítem).
`otro` es el bucket de error: un gate rompe el build si algún material cae ahí.

**MOTOR DE MEDIDA LIBRE** (pedido del cliente, revierte con motivo el "el bot no calcula
geometría" del plan madre): el bot cotiza CUALQUIER medida, no solo las del catálogo.
- La geometría es DATO en Materiales (3 columnas nuevas: `Área útil ancho/alto (cm)`,
  `Separación (cm)`): troquelado/medio corte 28x44 sep 0,3 · solo impresión 31x46 sep 0.
  Se carga UNA vez por material, en su primera fila. Los m2 las dejan vacías.
- `Piezas por unidad de cobro` se VACIÓ en los 14 productos pliego: el rinde se CALCULA
  (visor para las referencias, bot para medidas libres). La columna queda solo para
  unidades no geométricas (bobina, plancha); si se carga, gana sobre el cálculo.
- La fórmula de encaje vive en Instrucciones PARTE 1 (base del system prompt): dos
  orientaciones, floor((útil+sep)÷(pieza+sep)) por eje, la mejor. Rinde 0 → consulta.
- Los 31 productos quedan como "Medidas de referencia" (anclas RAG + sugerencias).

**El visor** (`visor/`) — corre con `pnpm dev` en `visor/`. Sube el .xlsx, lo parsea en el
browser y muestra los bloques de texto que va a leer el bot. Tres estrategias comparables por
tab. Con `.env.local` configurado, **también ingesta** a `bot.rag_catalog`.
- `lib/geometria.ts`: la función pura de encaje (misma fórmula, testeada contra los 7
  rindes históricos). `rindeEfectivo`: columna cargada > calculado > null.
- Los chunks pliego publican área útil + separación + "Se cotiza CUALQUIER medida"; los m2,
  la conversión. Encabezado: "Medidas de referencia:". `meta.geometria` en los pliego.
- **Avisos** en la UI (caja ámbar): material pliego sin geometría ni rinde, drift
  columna-vs-cálculo, pieza que no entra (rinde 0).

Salida actual: **62 chunks · 48.120 chars**, uno por colección+FAMILIA de material (las
presentaciones del mismo producto —100/500/1000 tarjetas, los 5 plastificados— van juntas
en un chunk con su tabla de precios; sin agrupar, tarjetas daba 14 chunks casi idénticos
compitiendo entre sí en el retrieval). El bot lee 5 por turno (`topK`), no los 62.

**Mirá los chunks generados, no solo los tests.** Tres errores que salían al texto que lee
el cliente pasaron los 152 tests en verde y se vieron recién al leer un volcado: el plural
de la unidad decía "2 a 100 unidads", una colección no existía en su hoja (el chunk salía
con el título pelado) y otra tenía una descripción que ya no nombraba lo que contenía.

## Estado: qué falta

1. ~~Configurar `.env.local`~~ — **hecho**, Martín ya lo cargó (`BOT_DB` + `GEMINI_API_KEY`).
   Recordar: **Claude no puede crear ni leer archivos `.env*`** (deny rule).
2. ~~Probar la ingesta contra la base real~~ — **hecho**: el camino completo
   (preview → embeddings → escritura) se ejercitó contra `bot.rag_catalog`. El gotcha del
   `search_path` de pgvector quedó arreglado en `db.ts` (ver "Cosas que cuestan sangre").
3. ~~**Fase 3 — el workflow de n8n.**~~ — **CORRIENDO EN DEV.** Workflow `EXZDlxFBcTPqMYez`
   en `n8n.terminalgrafica.cloud`, credenciales cableadas, probado en vivo contra la base
   real. **Empezar por [`n8n/README.md`](n8n/README.md)**: tiene el flow, el contrato de la
   salida estructurada, el auditor, los casos de humo y las trampas.

   1. ~~**RE-INGESTAR desde el visor**~~ — **hecho el 31/08**: 62 chunks en la base.
   2. ~~Importar el flow y cablear 2 credenciales~~ — **hecho**: Google Gemini(PaLM) API
      (la MISMA para chat y embeddings) y BOT_DB. **Ojo: son 2, no 3** — el chat quedó en
      Gemini nativo, no OpenRouter (ver el README).
   3. ~~Smoke test de retrieval y los 4 casos de humo~~ — **hecho**, más 13 casos del
      catálogo nuevo.

   **Sincronizar el flow después de tocar el Excel o el builder.** Se regenera con
   `node n8n/build-flow.mjs` y se sube — por la UI o por el MCP. Quedarse con el flow viejo da
   errores que **parecen del catálogo y son del flow**: eso costó una sesión entera
   persiguiendo un `modo desconocido` que ya estaba arreglado en el repo.

   **Subir un cambio de texto sin re-mandar 43 KB de flow** (corrige la nota vieja que decía
   que `setNodeParameter` no existe — SÍ existe y es la vía cómoda): `update_workflow` con
   `{ type: "setNodeParameter", nodeName, path, value }`, donde `path` es un JSON Pointer.
   Los dos que se tocan seguido:
   - prompt del sistema → nodo `Agente`, path `/options/systemMessage`
   - schema de la salida → nodo `Salida · Agente`, path `/inputSchema` (es un STRING con JSON
     adentro, no un objeto)

   **El texto se saca del JSON emitido, nunca se re-tipea.** Es la regla de "no editar el JSON
   a mano" aplicada al MCP: transcribir 8 KB de prompt a mano es una desincronización esperando
   pasar. Volcarlo a un archivo del scratchpad con Node y copiarlo de ahí, y después verificar
   con `get_workflow_details` que lo que quedó vivo es lo que emitió el builder.

   Estado del build: **13 nodos**, prompt ~2.531 tokens, auditor verde contra **132/132
   casos del Excel** + 11 rindes históricos. `node n8n/build-flow.mjs` re-genera todo;
   `--test` corre solo los tests. `node n8n/test-auditor.mjs` prueba los nodos Code
   (30+ escenarios de cableado, fallback y aviso) contra el JSON ya emitido.

   **Los casos van en PIEZAS, como escribe el cliente.** Hasta el 31/08 la hoja cargaba la
   Cantidad ya convertida a unidades de cobro ("100 tarjetas" con Cantidad 1 = un paquete),
   y con eso la división piezas→paquetes —el bug del $54.000.000— no la ejercía NINGÚN caso:
   la esquivaban por construcción. El gate ahora le pasa `paquete` a `cotizar()` igual que
   producción, y un gate espejo aborta el build si ese pase desaparece.

   **Los 4 casos de humo** (los 93 completos están en la hoja `Casos de prueba`):

   | Escribir en el chat | Total | Qué ejercita | Si falla, mirar |
   |---|---|---|---|
   | `250 stickers 3x3` | $6.600 | camino pliego completo | $5.130 = buscó el tramo por PIEZAS (250 → 101+) en vez de por PLIEGOS (3 → tramo 2-10) |
   | `100 stickers en vinilo UV 5x5` | $14.000 | m2 + mínimo facturable | 0,25 m2 < mínimo 0,5 → se cobran 0,5 × $28.000. Es el mínimo DEL MATERIAL, no el de trabajo |
   | `10 stickers 3x3` | $4.000 | mínimo por trabajo | crudo da $2.500. Mirar también CÓMO lo presenta: como cantidad ("por ese precio te llevás hasta 104"), nunca "precio mínimo" ni "es chico" |
   | `1 lona de 90x60` | $8.600 | redondeo | 0,54 m2 × $16.000 = $8.640 → múltiplo de $100 MÁS CERCANO. $8.700 = redondeó hacia arriba |

   En los 4, además del número: que **no** aparezca `⚠ auditoría:` pegado al mensaje, que
   `cotizaciones` NO venga vacío (un total en el texto sin desglose es un precio que llegó
   al cliente sin poder auditarse — el auditor lo marca solo), y que el retrieval haya
   traído el chunk del material correcto.

   **Los 5 casos de humo del catálogo nuevo** (verificados en vivo el 30/08; el número mal
   de la derecha es lo que daba ANTES del arreglo):

   | Escribir en el chat | Total | Qué ejercita | Si falla |
   |---|---|---|---|
   | `1000 tarjetas doble faz` | $54.000 | paquete: piezas → unidades de cobro | $54.000.000 = multiplicó en vez de dividir; mirar si el chunk trae `paquete` |
   | `500 volantes A6` | $12.000 | el mismo bug fuera de tarjetas | $6.000.000. Alcanza a 20 líneas de precio: perforados, sobres, talonarios, membretadas |
   | `250 tarjetas simple faz` | (deriva) | paquete cerrado, sin cantidades intermedias | si cotiza, se rompió la división exacta: TG no vende 250 |
   | `el pack de 4 libros de medicina` | $99.000 | un producto que se LLAMA pack | si deriva, alguien le cargó `Piezas por paquete`: el cliente pide UNO |
   | `5 plastificados A4` | $11.000 | ítem suelto — NO se divide | $2.200 = dividió algo que se cobra de a uno |

   **Los 4 de la carga del 31/08** — **VERIFICADOS EN VIVO el 31/08, los 4 en verde**:

   | Escribir en el chat | Total | Qué ejercita | Si falla |
   |---|---|---|---|
   | `escaneo de 3 metros de planos` | $24.000 | metro lineal como modo `item` | si deriva por "modo desconocido", el flow quedó viejo: `modoDe` cambió en los dos lados |
   | `1 cartel de PVC espumado de 100x150 cm` | $69.000 | m² por encima del mínimo | $23.000 = se quedó en el mínimo de medio m² |
   | `10 planchas A4 de stickers` | $14.000 | la escala del material combinado | $19.000 = usó el tramo de 1, que solo aplica a una plancha sola |
   | `1 lona 2x0,85 con roll up` | $65.200 | precio cerrado, sin medida | si pide medida, se cargó como m² en vez de material propio |

   **La batería de LA CANTIDAD DECLARADA** — correr ESTA después de tocar el schema, el prompt
   o el chunk. Es la única que ejercita el paso donde el modelo puede adulterar el input, y el
   gate de 132 casos no lo cubre (le pasa las piezas correctas del Excel, no lo que declara el
   modelo). Verificada en vivo el 31/08, 9/9 en verde:

   | Escribir en el chat | Total | `cantidad` que DEBE declarar | Si falla |
   |---|---|---|---|
   | `una lona de 3x1` | $48.000 | `1` — la lona, no los m² | `3` → $198.000, el triple: el modelo aplicó la fórmula del chunk y el auditor la volvió a aplicar |
   | `2 lonas de 1,5x2` | $96.000 | `2` — el control: prueba que no declara `1` mecánicamente | si declara 1, se pasó de largo y ahora ignora la cantidad real |
   | `100 stickers en OPP brillo troquelado de 7x7` | $16.800 | `100` piezas, no 6 pliegos | $4.000 = declaró pliegos y el auditor volvió a dividir. Cobra de MENOS, sin hallazgo |
   | `cuanto sale escanear 2,45 metros de planos?` | $19.600 | `2.45` — decimales, no `1` | $8.000 = declaró "un trabajo" |
   | `1000 tarjetas doble faz` | $54.000 | `1000` piezas, no 1 paquete | $54.000.000 si multiplica |
   | `Necesito 100 stickers en opp` (SIN medida) | — | `[]` + repregunta | si cotiza, volvió a inventar la medida de referencia del chunk |

   Los 3 primeros son los que se rompieron de verdad. En todos: mirar `cotizaciones[].cantidad`
   en la salida CRUDA del Agente, no solo el total — el total puede estar mal con la aritmética
   perfecta.

   El plan está escrito y
   **revisado punto por punto con Martín** (los prompts quedaron acordados; ver la
   sección "Revisión acordada" del plan): **`plans/workflow-n8n-v1.md`**. Decisiones
   nuevas de la revisión: opción BASE por colección (columna nueva en el Excel + aviso
   del visor al ingestar si falta), mínimo presentado como CANTIDAD, saludo combinable,
   coherencia-con-historial diferida al Verificador v2. Resumen:
   - Flow mínimo (~10 nodos): Chat Trigger + Agente (OpenRouter flash-lite) + Simple
     Memory + tool PGVector sobre `bot.rag_catalog` + salida estructurada con DESGLOSE
     del cálculo + auditor determinista. Sin debounce, sin firewall, sin Chatwoot.
   - **Trim resuelto en el plan**: prompt nuevo ≈ 1,9–2,1k tokens (borrador completo en el
     plan, sección por sección qué se va del viejo de ~5,2k). Verificador y Corrector SE
     RETIRAN en v1 (eran guardrail de política de canal; re-evaluar en Fase 5).
   - Los parámetros (mínimo, redondeo) y la PARTE 1 de Instrucciones se **inyectan al
     system prompt al construirlo** con un builder nuevo (`n8n/build-flow.mjs`) que lee el
     Excel y tiene gate de tokens (>3k falla).
   - Prerequisito del build: agregar la ESCALA del material a `meta` del chunk
     (`chunk.ts`) y re-ingestar — el auditor la necesita.
   - **HECHOS los pasos 1 y 2 del build.** (1) Columna `Material base` en Colecciones
     (dropdown contra Materiales_lista, C2:C35) con las 4 bases marcadas, vía
     `visor/scripts/material-base-colecciones.mjs`. Ojo: apareció un lock huérfano de
     LibreOffice de WINDOWS (`C:/Users/marti/...`) con el archivo cerrado; se verificó
     sin proceso vivo y se borró antes de escribir. (2) El visor ya la usa: el chunk de
     la base lo dice en el texto y en `meta.es_base`, y `meta.escala` publica los tramos
     + `minimo_facturable` para el auditor. 2 avisos nuevos (colección multi-material sin
     base; base que apunta a un material que no usa). 110 tests en verde.
   - ~~PENDIENTE antes del flow: RE-INGESTAR~~ — **hecho**. El chunk había cambiado
     (8.767 chars vs 7.822); `bot.rag_catalog` ya tiene la versión con `escala` y
     `es_base` en la metadata.
   - **Gotcha que encontró Martín, ya arreglado**: el chunk decía "es la opción base de
     la colección", pero el título junta los dos ejes con un guion (`Stickers con forma
     — Papel autoadhesivo…`) y "la colección" se quedaba sin referente: el bot puede
     leerla como el título entero y la frase se vuelve una tautología. Ahora cada chunk
     multi-material declara `Colección: X. Material: Y.`, nombra la colección entre
     comillas y lleva a sus hermanos (el base los lista; los no base apuntan al base),
     así el bot puede sugerir alternativas aunque el retrieval traiga un solo chunk.
     Moraleja para chunks futuros: **el bot solo ve el `text` del embedding** — nada de
     deícticos ("la colección", "este material") sin su referente escrito al lado.
4. **Fase 4 — medir. CERRADA (31/08): los 132 del Excel contra el bot vivo → 130/132
   (98,5%).** Ejecuciones 536-667, auditadas con UN SELECT vía `leer-bot-log` (la Parte 2 de
   la Fase 5). Cero fallbacks, cero hallazgos del auditor, la cantidad declarada vino
   correcta en TODOS los casos (decimales del escaneo incluidos; el pack de libros declaró 1).
   Los 2 fallos son de ELECCIÓN de material, no de aritmética ni de cantidad:
   - **#53 `1 banner roll-up 85x200`** → eligió `Lona 2x0,85 m con porta banner roll up`
     ($65.200) en vez de `Banner roll-up` ($38.000). **Huele a DUPLICADO del catálogo**:
     85x200 cm y 2x0,85 m son el mismo producto físico, uno con el precio viejo del v2 y
     otro con el precio cerrado que trajo el cliente. Preguntarle a TG cuál vale y retirar
     el otro del Excel — mientras convivan, el precio depende de qué chunk gane el retrieval.
   - **#72 `1 talonario x10`** → eligió `Anotadores personalizados en negro` ($4.000) en vez
     de `Talonarios x10` ($54.000): leyó "x10" como parte de la medida. `10 talonarios de
     factura` (#51) salió perfecto, así que es la fraseología del caso, no el producto.
   Procedimiento para repetir la tanda (cuando se toque chunk/prompt/schema): extraer los
   casos del Excel (hoja `Casos de prueba`, SIN las notas entre paréntesis del Pedido),
   lanzar por MCP `execute_workflow` en tandas de a 6 con ~18s entre tandas (así el rate
   limit del MCP no corta: esta vez pasaron los 132), y auditar con el SELECT del lector.
   Scripts de la corrida en el scratchpad (extraer-casos / auditar-tanda); se rehacen rápido.
5. **Fase 5 — producción, dividida en partes (acordado con Martín):**
   1) `bot.log` en el flow actual → 2) cerrar Fase 4 con el SELECT → 3) info del negocio de
   vuelta al bot (el cotizador quedó sin `consultar_info_negocio`) → 4) sacar la cola de
   debug del Responder → 5) ingreso Chatwoot (F1+F2 del caparazón del lite, adaptados) →
   6) egreso (F3+F4) → 7) guardrails de canal (Verificador v2, diferido de v1) →
   8) WhatsApp real + go-live. Cada parte se prueba en vivo antes de seguir.

   **Parte 1 — HECHA y verificada en vivo (31/08).** El flow pasó a **16 nodos**:
   `Responder → Armar Log → Log Turno → Entregar`.
   - **Armar Log** (Code) arma la fila: `products` = cotizaciones **CRUDAS** del Agente (la
     cantidad TAL COMO LA DECLARÓ — el dato que ni el auditor ni el gate ven), `prices` =
     detalle del auditor, `verification` = hallazgos, `signals` = `{via, fallo_parser}`,
     `state` = 'ok' o la via cruda, `execution_id`.
   - **Log Turno** (Postgres INSERT en `bot.log`, `onError: continue`): un fallo de log no
     corta la respuesta. **Entregar** re-emite el mensaje del Responder — el Chat Trigger
     muestra el ÚLTIMO nodo, así que el terminal no puede ser el INSERT.
   - Gate de cableado nuevo en el builder (verificado EN ROJO antes de confiar en él) y la
     cadena del log ejercitada en todos los escenarios de `test-auditor.mjs`.
   - Verificado leyendo las filas DE VUELTA de la base (ejecuciones 533/534 → filas 76/77),
     no solo el `success` del INSERT. El camino `fallo_parser` quedó cubierto solo por el
     harness — en vivo no se puede forzar a demanda.
   - **Workflow lector `leer-bot-log (dev)`** (`lThuFmf27HkM5dAR`): webhook GET
     (`?limit=N&session=S&desde=<exec>&hasta=<exec>`) + SELECT compacto sobre `bot.log`
     (execution_id, state, via, products, precios, hallazgos, msg recortado). Es LA
     herramienta de auditoría: una tanda = 1 llamada, no 132.
     **Cómo usarlo sin quemar contexto**: publicarlo un momento (`publish_workflow`),
     `curl` al webhook desde la máquina local (estamos en AR, el geo-block no corta) con
     `-o archivo.json`, y despublicarlo. El webhook necesita `responseMode: lastNode` +
     `responseData: allEntries` (ya quedó así) — sin eso devuelve "Workflow was started" o
     solo la primera fila. Queda NO publicado por defecto.
   - **Ojo al auditar**: `bot.log` conserva filas del bot LITE viejo (ids ≤ 75, `signals`
     con `etapa`/`latencia_ms`). Las del cotizador se distinguen por `signals.via`.
   - La credencial viva de Postgres en n8n es **`BOT DB` (`bxPpuXnXEZpEvGIL`)**; el id viejo
     del builder ("Bot Readonly DB") ya no existe y el MCP lo rechaza. El builder quedó
     corregido. De paso se sincronizó `Auditar Cotización` (el vivo no tenía el manejo de
     `fallo_parser` que el repo ya emitía — otra vez el flow viejo).

   **Parte 3 — HECHA y verificada en vivo (31/08): `consultar_info_negocio` de vuelta.**
   El flow pasó a **18 nodos**: 2ª tool PGVector sobre `bot.rag_business_info` + su
   sub-nodo de embeddings (mismo modelo/credencial que el otro — cada PGVector necesita el
   suyo). La tabla ya estaba poblada y curada del bot lite (9 fichas: horario, dirección,
   pagos/seña, envíos, urgentes, plazos, redes, canal informativo) — verificado con SELECT
   antes de cablear, para no caer en el `[]` en verde. La fuente sigue siendo
   `bot.business_info`; **decisión: se reusa tal cual por ahora**, mover la info a una hoja
   del Excel queda para cuando TG quiera editarla él.
   - Prompt: DOS tools + regla de info AUTORITATIVA (afirmar tal cual, responder solo lo
     preguntado). ~2.751 tokens (techo 3.000).
   - Gate nuevo del trío (tabla schema-cualificada + embeddings conectados + prompt que
     nombra la tool), verificado EN ROJO. El fallo típico acá es silencioso.
   - Probado en vivo: dirección, envíos (afirma la política, no deriva), pagos/seña, y el
     COMBO cotización+horario en un turno (usó las dos tools: $6.600 + horario). Regresión
     0: batería de la cantidad 5/5 tras el cambio de prompt.
   - **Hallazgo del vivo, ya arreglado**: preguntado "¿hasta qué hora están hoy?" el bot
     respondía "hoy hasta las 20 hs" — y NO SABE QUÉ DÍA ES (un sábado sería mentira).
     Regla nueva en el prompt: no adivinar el día, dar el horario completo. Si algún día se
     quiere que sepa la fecha, hay que inyectarla por expresión de n8n, no por texto
     horneado (el build fija la fecha del build, no la del turno).

   **Parte 5 — CONSTRUIDA y subida (31/08): la variante Chatwoot, ingreso F1+F2.**
   `build-flow.mjs` ahora emite DOS flows: el de chat (18 nodos) y
   `flows/cotizador-v1-chatwoot.json` (**37 nodos** entonces; hoy 43 con el egreso de la
   parte 6, workflow `3vNAAe0sr7sMgPUa` en n8n, **INACTIVO — no activar hasta la parte 8**:
   comparte el path `chatwoot` con el bot lite activo, un solo flow por vez).
   - **Decisión de Martín: la memoria es el HISTORIAL DE CHATWOOT.** La variante saca la
     Simple Memory; el adaptador (que hereda el nombre "Cuando llega un mensaje" para no
     tocar el medio) emite `historialTexto` y el `text` del Agente lo antepone al mensaje
     nuevo. El log y todo el medio quedan idénticos por copia profunda.
   - F1+F2 portados VERBATIM del lite: webhook (path `chatwoot` — compartido con el bot
     lite ACTIVO: un solo flow activo por vez), HMAC, Filtro (WhatsApp entrante sin humano,
     firma válida), Firewall Tier-1 con fail-open LOGUEADO a `bot.errors`, ¿Tiene Texto?,
     Wait 15s, Get Historial, Decidir (debounce/idempotencia/ráfaga NFC/CAP/reply citado),
     Switch Ruteo. El `process` va DIRECTO al medio (Tier-2 queda para la parte 7).
   - Gate de 10 cableados de la variante (Memoria ausente, adaptador completo, HMAC con
     `$env`, firewall, NFC, cadena del log), verificado EN ROJO. 12 tests nuevos en
     `test-auditor.mjs`: Decidir y adaptador contra historiales sintéticos de Chatwoot.
   - Subido por MCP en 5 tandas de operaciones (esqueleto SDK + addNode/addConnection
     generados DESDE el emitido) y verificado con un **diff programático** vivo-vs-emitido
     (37 nodos, 37 conexiones, credenciales y settings — el diff normaliza los comentarios
     del jsCode: los rulers difieren en largo al tipear por MCP, el código debe ser
     idéntico). Ese diff ya pagó: cazó un Responder que transcribí resumido.
   - **Credenciales vivas, horneadas en el builder**: Chatwoot API Token
     `2e8slhNsviye1WE7` y Gemini `ql7KStbm6WaYEaSJ` (los ids del builder del lite estaban
     viejos, mismo caso que BOT_DB).
   - **Lo que NO se pudo probar**: el e2e real. El HMAC exige la firma del secret y el
     canal es el webhook de Chatwoot — se prueba recién al switchear (desactivar el lite,
     activar este) con un WhatsApp real, después de la parte 6.
   - **Pregunta para TG que dejó el port**: el enlatado del CAP del lite decía "Rodríguez
     Peña 3865, Mar del Plata" y `bot.business_info` dice "Dorrego 3365" — direcciones
     DISTINTAS, una es vieja. El enlatado nuevo no afirma ninguna ("pasá por el local")
     hasta que TG confirme cuál es.

   **Parte 6 — CONSTRUIDA y subida (31/08): el egreso F3+F4, la respuesta vuelve a Chatwoot.**
   La variante pasó a **43 nodos** (workflow `3vNAAe0sr7sMgPUa`, sigue INACTIVO hasta la
   parte 8): `Entregar → Preparar Envio → Enviar Mensaje → Chequear Envio → ¿Se Entregó?
   → [no] Label Envío Fallido → Actualizar Entrega`.
   - **Diferencia clave con el lite**: allá el INSERT y el cierre del log eran dos nodos de
     fases distintas; acá `Log Turno` YA insertó la fila ANTES del envío, así que el cierre
     es **Actualizar Entrega**: un UPDATE por `execution_id` que **mergea** `signals` con
     `||` (via y fallo_parser del INSERT sobreviven) sumando
     `entregado`/`latencia_ms` (desde el `_t0` del adaptador)/`chatwoot_message_id`
     (+`envio_detalle` si falló), y pisa `state='envio_fallido'` SOLO si no se entregó.
   - **La entrega se decide por el `id` que devuelve Chatwoot, NUNCA por el status HTTP**
     (el caso real del lite 2026-07-29: un 503 logueado como éxito). `Enviar Mensaje` va con
     retry 3 + `onError: continue` + `alwaysOutputData` para que el fallo LLEGUE al chequeo.
   - `Actualizar Entrega` es terminal y el cliente ya fue atendido → si el UPDATE falla,
     **crashea** (`onError: stopWorkflow`): un cierre que falla en silencio es el bug de
     julio otra vez. Y el crash lo asienta el **Error Workflow `tg-bot-error`**
     (`bZFVbSBHJKFtO1Hh`), que ahora está seteado en los settings de la variante (el MCP lo
     soporta: op `setWorkflowSettings.errorWorkflow`).
   - 8 gates nuevos del egreso (verificados EN ROJO) + 8 tests nuevos en `test-auditor.mjs`
     (Chequear Envio con id en raíz/anidado/503/error/sin-id; los parámetros del UPDATE
     evaluando el queryReplacement REAL del emitido con mocks).
   - **GOTCHA CARO cazado por el diff, no por los gates**: el builder defaultea al Excel
     VIEJO (`Catalogo-TG-v2.xlsx`, 46 casos, tope $600k) — el vigente es
     **`CATALOGO=Catalogo-TG-v3.xlsx`** (132 casos, tope $1.8M). Un build sin `CATALOGO=`
     emite desde el v2 EN VERDE (los gates corren contra el mismo Excel equivocado).
     Ahora el builder **ABORTA sin `CATALOGO=`**. Correr siempre:
     `CATALOGO=Catalogo-TG-v3.xlsx node n8n/build-flow.mjs`.
   - El diff se actualizó (scratchpad `diff-cw-v2.mjs`, pásale el dump del vivo como arg):
     además de comentarios de jsCode normaliza el orden de claves y los DEFAULTS que
     `update_workflow` quita al re-guardar (toolName = nombre del nodo, columnNames
     estándar, modelName de embeddings) — equivalencia probada en vivo por el flow de chat.
     Veredicto final: **el vivo calca al emitido, 43 nodos, 44 conexiones, credenciales,
     settings y errorWorkflow idénticos**.
   - **Lo que NO se pudo probar** sigue igual que la parte 5: el e2e real necesita el
     switch (desactivar el lite, activar este) + un WhatsApp real → parte 8.

   **Parte 7 — CONSTRUIDA y subida (31/08): guard Tier-2; el Verificador v2 NO vuelve.**
   La variante pasó a **52 nodos**: el `process` del Switch Ruteo ahora pasa por
   `Guardrails Tier-2` (LLM guard jailbreak + off-topic del lite, +1 llamada flash-lite
   por turno) antes del adaptador.
   - Cableado EXACTO del lite: violación real → `bot.firewall_strike` (SQL decide el
     escalado) → refusal enlatado o silencio; caída del modelo-guard → **fail-open
     LOGUEADO** a `bot.errors` (`model_error` — el fail-open mudo era el agujero);
     `Router Fail` mapea `topicalAlignment→offtopic` (bug H2 del lite: sin el mapeo el
     strike rebota MUDO contra el enum). Strike con `onError: stopWorkflow`.
   - **Única adaptación de fondo**: el prompt del guard decía "una imprenta que NO da
     precios" (el lite no cotizaba) — ahora dice que cotiza del catálogo, considera
     jailbreak "alterar precios o descuentos" y aclara que pedir precio/regatear es
     consulta NORMAL, nunca jailbreak. Gate dedicado a eso (si vuelve el texto viejo por
     copy-paste, el build aborta).
   - **Decisión (en `decisions/log.md`): el Verificador/Corrector v2 queda AFUERA.** El
     agujero que cubría (números sin respaldo en el mensaje) ya no existe: contrato {P1} +
     auditor determinista + Responder que deriva. La info operativa es autoritativa por
     tool, y el confident-wrong se caza OFFLINE desde `bot.log` (la vía ya decidida con
     TG: sin humano en Chatwoot). Guardrails de canal = Tier-1 + regex + Tier-2 + CAP.
   - 8 gates nuevos (2 verificados en rojo — ojo: un sabotaje que deja el substring intacto
     NO prueba nada, el primero mío falló así) + 4 tests del Router Fail y los params del
     Strike en `test-auditor.mjs`. Diff final: **el vivo calca al emitido, 52 nodos, 55
     conexiones** (el diff ahora también normaliza `onError` ausente = `stopWorkflow`, otro
     default que el server quita al re-guardar).
   - Igual que las partes 5 y 6: el comportamiento real del guard (¿flaggea? ¿deja pasar lo
     normal?) solo se ve con tráfico real en la parte 8 — el lite ya lo corrió semanas en
     prod con estos mismos prompts/thresholds, así que el riesgo es bajo.

   **Parte 4 — HECHA y verificada en vivo (31/08): la cola de debug ya no sale al cliente.**
   El Responder dejó de pegar `⚠ auditoría:` y `(marcadores sin precio: …)` al mensaje, en
   los DOS caminos (normal y fallback del parser). El rastro vive en `bot.log`
   (`verification.hallazgos` + `signals.via`) — por eso esta parte vino DESPUÉS del log:
   sacarla antes habría vuelto los fallos invisibles. `test-auditor.mjs` invirtió el
   invariante: ahora falla si un veredicto interno llega al mensaje, o si un turno con
   `!ok` pierde sus hallazgos. Verificado en vivo: `20 stickers 30x45` deriva con el
   mensaje LIMPIO y el hallazgo entero en el log; `1 lona 90x60` → $8.600 intacto.

### El catálogo del cliente, cargado (2026-08-30) — y los tres bugs que destapó

El Excel pasó a `Catalogo-TG-v3.xlsx` (el v2 no se toca) con los 61 productos que mandó
TG: 55 materiales, 8 colecciones, 79 casos de prueba. Tres cosas rompieron en el camino, y
las tres eran de la MISMA forma — el modelo declaraba bien y el auditor interpretaba mal.

1. **`modo desconocido`.** El auditor solo sabía `pliego` y `m2`; los 61 productos nuevos
   son de a ítem. Se agregó el modo `item` (unidad de cobro = un ítem), derivado del
   PREFIJO de la columna Unidad, con `otro` como bucket de error explícito.
2. **El paquete contado dos veces.** El cliente pide en piezas ("mil tarjetas"), el
   catálogo cobra por paquete. El modelo declaraba el material `…x1000` **con cantidad
   1000** y el auditor hacía 1000 × $54.000 = **$54.000.000** (leído en la ejecución 305).
   Lo atajaba el tope de sanity, pero por accidente: con un paquete más barato pasa el tope
   y llega al cliente. Ahora el catálogo aporta `paquete` y el auditor DIVIDE, exigiendo
   división exacta — TG vende paquetes cerrados, así que 150 tarjetas van a consulta, no se
   redondean a 2 paquetes. **Alcanzaba a 20 líneas de precio, no solo a las tarjetas**:
   perforados, volantes, hojas membretadas, sobres y talonarios tenían el mismo bug sin que
   nadie los hubiera probado.
3. **Un "pack" que no era un paquete.** Al cargar el dato le puse `paquete = 4` al
   `Pack 4 libros de medicina` leyendo su unidad `pack` como un empaque — y el bot empezó a
   DERIVAR un producto que sí está en el catálogo (el cliente pide "el pack", 1, y 1 no es
   múltiplo de 4). Regla que salió de ahí: **una unidad de conjunto sin número de piezas no
   es un paquete.** "paquete de 500 volantes" dice de qué y cuántas; "pack" no dice nada.

El dato del paquete se **deriva de la Unidad**, que ya trae el número en todo el catálogo;
la columna `Piezas por paquete` queda para lo que no se pueda leer así. Derivarlo evita el
error silencioso de cargar 500 en la unidad y 100 en la columna.

**Gates nuevos, porque estos datos se rompen en silencio** (un precio mal dividido sale
plausible y nadie lo nota): que toda unidad de conjunto diga cuántas piezas trae; que el
nombre no contradiga al paquete (`…x500` con unidad de 100 cobra 5 veces de menos); que un
paquete cargado tenga una unidad que lo respalde. Y `paquete` se sumó al **gate de
cableado**, que mira el código EMITIDO: borrar el pase deja el build en verde y rompe
producción — ya había pasado con `sin_minimo`.

Verificado en vivo tras la ingesta (13 ejecuciones leídas, no deducidas): 1000 tarjetas
$54.000 · 500 volantes $12.000 · 100 sobres $25.000 · 10 talonarios $54.000 · el pack
$99.000 y un libro suelto $30.000 · 5 plastificados A4 $11.000 sin dividir · 250 tarjetas
deriva · y los caminos viejos intactos (250 stickers $6.600 rinde 104, lona 90x60 $8.600).
Un turno con volantes + stickers cotizó los dos modos a la vez, cada uno con su cuenta.

**Pendiente que salió de las pruebas**: `500 tarjetas kraft` cotiza $88.000 = 5 × el x100,
porque en kraft solo existe el paquete de 100. La cuenta está bien, el precio no: en las
otras líneas 500 sale bastante menos que 5×100. **Falta pedirle a TG el precio de 500 y
1000 en kraft.**

### Los últimos 6 pendientes (2026-08-31) — y qué queda abierto

De las 179 líneas de la hoja "Lista de precios" del cliente, 99 ya cotizaban (su línea de
precio era un material nuestro), 37 él las marcó "no lo hace" y 31 "consultar". Quedaban
**11 pendientes reales**; entraron 6.

El cruce que produjo esos números está en `visor/scripts/pendientes-cliente.mjs`, y la copia
podada en `Catalogo-cliente-PENDIENTES.xlsx` (43 filas: los pendientes + las de consultar).
**No cruzar por nombre de producto**: nuestro catálogo guarda MATERIALES con su escala, así
que las 20 filas de stickers del cliente son una sola línea nuestra. Comparar nombres daba
123 falsos pendientes.

Lo que entró, con lo que Martin confirmó:

| Material | Precio | Detalle |
|---|---|---|
| Vinilo microperforado | $18.000/m² | mín. 0,5 m² |
| PVC espumado 3 mm con vinilo | $46.000/m² | mín. 0,5 m² |
| Impresión de planos lineal | $7.000/m² | mín. 0,5 m² |
| Escaneo de planos | $8.000 el metro **lineal** | 3 metros = $24.000 |
| Plancha A4 de stickers | $1.900 → $1.400 (2+) → $1.000 (101+) | material combinado |
| Lona 1,9x0,9 + porta banner 2 velas | $61.360 | precio cerrado |
| Lona 2x0,85 + roll up | $65.200 | precio cerrado |

Tres decisiones que vale la pena no reabrir:

- **La cobertura de planos NO se cargó.** El cliente listaba $13.000 el m² con 50% de
  cobertura, pero el porcentaje lo tiene que ver un empleado mirando el diseño. La
  descripción del producto se lo dice al bot para que derive a mail. Cargar un precio ahí
  haría que cotice algo que nadie puede calcular sin el archivo.
- **"metro lineal" es modo `item`, no `m2`.** Se cobra cantidad × precio, no ancho × alto.
  El prefijo dice "metro lineal" COMPLETO y no "metro" a secas: con el corto, "metro
  cuadrado" también caía en `item` y cobraba por cantidad algo que va por superficie. Lo
  atajó el test de "metro cuadrado", que ya existía por otro motivo.
- **Las lonas van como material propio**, no como una medida de Lona: el precio incluye la
  estructura y es cerrado. Lo dice la nota del propio cliente.

**Queda abierto — para preguntarle a TG:**

1. **Gigantografías** — la columna PRECIO está vacía y la línea apunta a "Lona Front Brillo
   $16.000 el m²", que ya es nuestra Lona. ¿Es lo mismo o algo distinto? Aunque el precio no
   cambie, hay un dato que sí falta y el bot debería tener: **ancho máximo 1,52 m en lona,
   1,48 m en vinilo**; más grande lleva empalme.
2. **Marco para fotos y photocall** — $34.000 el m², pero el material que describe (vinilo
   montado en corrugado) ya está a $30.000. ¿Adicional, o precio viejo?
3. **Imanes personalizados** — la escala está completa ($8.500 / $7.800 desde 4 / $7.200
   desde 11) pero Martin no confirmó la unidad y falta la medida. Además los troquelados con
   forma arrancan "desde $62.000 el medio m²": ¿otro material o consulta?

**Una decisión de negocio que dejó el aviso del visor:** una plancha A4 sola cotiza **$4.000**
en vez de $1.900, porque el mínimo por trabajo la levanta. ¿Una plancha suelta es un trabajo
entero (queda así) o un agregado como el laminado (marcar `Sin mínimo por trabajo` = sí)?

### El barrido conversacional (2026-08-31) — el bot dejaba al cliente sin respuesta

Se escribieron **40 casos conversacionales** (`n8n/casos-conversacionales.md`, herramienta
interna, NO va al Excel) porque la hoja `Casos de prueba` solo puede probar aritmética: sus
filas exigen material y precio, y el gate las corre contra el motor. Todo lo demás
—repreguntas, multi-producto, no-inventar, derivación— no tenía NINGÚN test.

Corridos 21 turnos. **Contenido: 17 de 18 medibles en verde.** Lo que apareció:

**1. El bot se quedaba MUDO en ~19% de los turnos (4 de 21).** El modelo contestaba en
prosa, el output parser la rechazaba (`Invalid JSON in model output`) y el Agente en
`stopWorkflow` mataba la ejecución: ni auditor ni Responder corrían, el cliente no recibía
NADA. Peor que un precio mal calculado — en WhatsApp real es escribir y que no te conteste
nadie. Pasa en los turnos que NO cotizan (repregunta: `cotizaciones` vacío, nada que
declarar), aunque no es determinístico: la misma forma de turno a veces sale bien.
- **Dos defensas, cada una a una mitad del problema:**
  1. `autoFix: true` en el output parser (+ nodo `Modelo · Corrector`, que el autoFix EXIGE):
     reintenta con el LLM y **recupera el turno**. Medido después de prenderlo: **9 de 9
     turnos recuperados, 0 perdidos** (contra 4 de 21 antes). En las ejecuciones se ve el
     mecanismo: `Modelo · Corrector` corre y `Salida · Agente` marca 3 sub-runs en vez de 1.
  2. `onError: continueRegularOutput` + fallback en el Responder: si aun así falla, **sale un
     mensaje**. Es el piso, no el arreglo.
- El fallo NO se tapa: sigue como hallazgo de auditoría y como `via` en la salida, que es lo
  que hay que contar. Sin ese rastro el arreglo vuelve el problema invisible (la ejecución
  sale verde y un turno perdido se ve igual que uno bueno).
- Gotcha leído en la ejecución 359: el item del Agente fallado es SOLO `{ error: "<msg>" }`.
  El texto que el modelo escribió queda en el sub-run del parser y **no viaja**, así que no
  se puede reenviar aunque sea una repregunta perfecta.

**2. Dos mensajes distintos, no uno.** `CONSULTA` dice "esto no lo puedo cotizar" y manda a
TG trabajo real; `FALLA_TECNICA` dice "se me cayó algo, probá de nuevo". Mandar el primero
ante un fallo nuestro le miente al cliente sobre la causa y le deriva a mail algo que el bot
resuelve bien al reintentar.

**3. El bot negaba lo que no está en el catálogo.** "No realizamos tazas personalizadas":
buscó bien (el "buscá antes de negar" funcionó) pero al no encontrar negó igual. La regla
cubría el ANTES de buscar, no el después. Que algo no esté en el catálogo significa que el
BOT no lo tiene a la vista, no que el negocio no lo haga.

**4. `esMedidaContinua` — la unidad de cobro que es una MEDIDA.** El bot cobró $8.000 por
escanear 2,45 metros en vez de $19.600: el modelo declaró `cantidad: 1` porque para él 2,45
metros es UN trabajo, y el auditor no pudo verlo (1 × $8.000 cierra solo). **Cobrar de menos
en silencio es peor que derivar: nadie se entera.** El chunk de esos materiales ahora dice en
qué unidad va la cantidad. Los 2 casos que había usaban cantidades ENTERAS, así que el gate
no distinguía "3 metros" de "3 piezas" — el paso que se rompe quedaba afuera por
construcción. Hoy matchea un solo material (Escaneo de planos); la función existe para que
el próximo entre solo.

**Lo que TG pidió y ya está**: al derivar a mail para AVANZAR, el mensaje suma "el precio
final lo confirmamos cuando recibimos el archivo y verificamos que sea realizable". Hacen
falta DOS condiciones —el mail Y que el turno haya cotizado— y la segunda se aprendió
midiendo: con solo el mail se pegaba en consultas de PLAZOS, donde no hay ningún precio.

**Un hallazgo nuevo, sin resolver** (ejecución 379, `250 stickers` sin medida): el modelo
repreguntó por la medida Y AL MISMO TIEMPO declaró una cotización de 250 stickers 5x5 por
$15.400 — una medida que el cliente nunca dio. No llegó ningún precio al cliente (el mensaje
no tenía marcador, no había dónde inyectarlo) y el auditor lo marcó solo: *"hay 1
cotización(es) pero el mensaje no tiene ningún marcador {Pn}"*. El guardrail funcionó, pero
el modelo está inventando una medida al declarar. Vale un caso conversacional propio.

**Los 19 que faltaban, corridos (ejecuciones 387-406).** La familia 6 —"buscá antes de
negar", la que nació del fallo real— salió **7/7**: el bot buscó en el catálogo en todos los
casos y no negó ninguno. Los sinónimos no obvios entraron solos: "araña" → `Porta banner tipo
X`, "carnet" → `Plastificado carnet`, "anillado" → Encuadernación. La derivación (familia 5)
y el mínimo (familia 8) también verdes, con la aritmética correcta contra el Excel (porta
banner $32.000 = caso 127; 4 ojalillos $4.000 = caso 68 × 4; plastificado A4 $2.200 = caso
68; 5 recetarios $20.000). Los dos guardrails dispararon bien solos: 1000 stickers de 2x2
METROS → fuera de rango, y 1 talonario → no múltiplo del paquete de 10.

### El modelo hace la cuenta que le toca al auditor (2 cobros mal, RESUELTO)

Tres fallas medidas en vivo, una misma causa: **el modelo convierte la cantidad a la unidad
de cobro, y el auditor la vuelve a convertir.** El error queda invisible porque la aritmética
cierra sola — lo único mal es el input, y el input no tiene contra qué compararse.

| Ejec. | Pedido | Declaró | Salió | Debía | Dirección |
|---|---|---|---|---|---|
| 412 | 100 stickers 7x7 | `6` (pliegos) | $4.000 | $16.800 | cobra de MENOS |
| 422 | una lona de 3x1 | `3` (m2) | $198.000 | $66.000 | cobra el TRIPLE |
| — | 2,45 m de planos | `1` ("un trabajo") | $8.000 | $19.600 | cobra de MENOS |

**La causa raíz era una instrucción mía mal escrita.** El schema decía *"cantidad: EN LA
UNIDAD DE COBRO que declara el catálogo"*, y el chunk de stickers dice, en mayúsculas,
*"Precio según CANTIDAD DE PLIEGOS A3 (no de piezas)"*. El modelo obedeció al pie de la letra.
El caso del metro lineal, que motivó aquel texto, no era una excepción a "declarar lo que dijo
el cliente" — era un ejemplo de ella (el cliente DICE "2,45 metros").

Arreglado en las tres capas que le hablan al modelo, porque las tres decían lo mismo mal:
- **schema** (`build-flow.mjs`): "lo que pidió el cliente, EN SUS PALABRAS y sin convertir".
- **prompt** (`system-prompt-v1.md`): la regla, con los 4 ejemplos (piezas / paquete / m2 /
  medida continua).
- **chunk** (`visor/lib/chunk.ts`): el ejemplo de la cuenta ahora cierra con *"vos declarás
  las 200 piezas, no 2 pliegos A3"*, y el de m2 aclara que la fórmula es para entender el
  precio, no para aplicarla. El ejemplo existe para que el bot no lea el tramo en piezas —
  se queda, pero mostrar la cuenta invitaba a hacerla.

Verificado en vivo (ejecuciones 423-425): lona 3x1 → $66.000 · stickers+lona → $6.600 y
$32.000 · **2 lonas de 1,5x2 → cantidad 2, $96.000** (o sea que distingue piezas de m2, no
declara 1 mecánicamente). Sin regresión en pliego, item, paquete y mínimo.

**Por qué el gate de 132 casos no lo agarra, y no puede.** Alimenta al motor con las piezas
correctas leídas del Excel; nunca con lo que el modelo declara. El caso 13 del Excel ES este
pedido y da $16.800 en verde. Es el mismo agujero que [[tests-fixtures-mienten]]: el paso que
se rompe queda afuera por construcción. **Esta clase de bug solo aparece corriendo el bot de
verdad y leyendo la ejecución.**

### El patrón que dejó el barrido: el modelo INVENTA la medida que falta

No es un caso aislado — es **el** hallazgo, y aparece en 3 de los 19 turnos nuevos más el que
ya estaba anotado (ejecución 379):

| Ejecución | El cliente dijo | El modelo declaró |
|---|---|---|
| 387 | `hacen porta banners tipo araña?` | 90x190, cantidad 1 → cotizó $32.000 |
| 391 | `colocar ojalillos en una lona que ya tengo` | cantidad **4** → cotizó $4.000 |
| 400 | `100 stickers en OPP` | 5x5 → cotizó $8.400 |
| 379 | `250 stickers` | 5x5 → (sin marcador, no salió) |

Los cuatro son la MISMA falla: falta un dato para cotizar, el prompt dice "preguntá SOLO eso",
y el modelo en vez de preguntar rellena con la medida de referencia del chunk y cotiza.

**RESUELTO — y la causa no era el modelo, era el chunk.** Leyendo el retrieval de la 400: de
los 5 chunks que trajo, **4 encabezan sus "Medidas de referencia" con 5x5**, y cada una viene
con la cuenta ya resuelta de ejemplo. El chunk decía "se cotiza CUALQUIER medida" y nunca
decía de DÓNDE sale esa medida, así que el modelo agarraba la primera que veía. No elegía:
tomaba lo único concreto que tenía delante. El chunk ahora dice *"La medida la da SIEMPRE el
cliente: si no la dijo, preguntala"*, en pliego y en m2 (no en item, donde la medida ya viene
cerrada). Verificado en vivo tras re-ingestar (ejecución 411): `Necesito 100 stickers en opp`
→ **pregunta la medida**, `cotizaciones: []`, ningún precio. Mismo mensaje que antes cotizaba
$8.400 de una medida inventada.

Queda como lección general: cuando el bot "elige mal", mirar primero QUÉ le llegó en el
retrieval. Tres de los cuatro bugs de esta sesión estaban en el texto del chunk, no en el
prompt ni en el modelo.

**Es peor que el mudo**, porque acá el cliente SÍ recibe un precio — uno de un trabajo que no
pidió. El auditor no puede verlo: 4 ojalillos a $1.000 cierra perfecto, la aritmética está
bien. Solo falla la premisa, y la premisa no está en ningún lado para comparar.

La contramedida no puede ser aritmética. Dos caminos, sin decidir:
1. **Prompt**: hoy dice "para cotizar necesitás producto, medida y cantidad", pero no prohíbe
   explícitamente TOMAR esos datos del catálogo. La medida de referencia del chunk está ahí
   justamente para orientar, y el modelo la usa como si fuera el pedido.
2. **Contrato de salida**: un campo que declare de DÓNDE salió cada medida (`del_cliente` vs
   `de_referencia`), para que el auditor pueda rechazar lo que el cliente nunca dijo. Más caro
   pero verificable — hoy no hay forma de auditarlo.

Un matiz que lo hace ambiguo: en 387 el porta banner tipo X **tiene una sola medida** en el
catálogo, así que "90x190" no es una invención sino el único producto posible. En 391 y 400 sí
lo es. Puede que la regla correcta sea "solo si el material tiene UNA medida".

**Detalle menor (ejecución 399)**: `carpeta institucional` preguntó "¿sin laminar o laminado?"
— el caso 2.4 esperaba que fuera directo a la base sin abrir la opción. No es grave (pregunta,
no cotiza dos), pero es justo lo que TG pidió no hacer.

## El MCP de n8n — Claude YA VE las ejecuciones

`https://n8n.terminalgrafica.cloud/mcp-server/http`, cableado en `.mcp.json` del repo.
OAuth 2.1 con registro dinámico: **lo autentica Martín** desde `/mcp` (se abre el browser),
Claude no puede hacerlo solo. Scopes que ofrece: `workflow:read/write/execute`,
`execution:read`, `credential:read`, `dataTable:read/write`, `project:read`, `tag:read`.

Esto **retira la restricción** que arrastraba el proyecto ("Claude no ve las ejecuciones,
pedile el dato a Martín"): con `execution:read` se leen el retrieval, la salida estructurada
y el veredicto del auditor directo de la ejecución. Donde más pesa es en la Fase 4 — 132 casos
que si no habría que copiar a mano.

La lección de fondo NO cambia: sin la ejecución a la vista, no afirmar qué pasó. En el bot
viejo eso ya salió mal dos veces (Claude dedujo, el dato lo desmintió).

Dos avisos: el dominio está tras el **geo-block solo-AR de Cloudflare** (desde fuera de AR
da 403), y si al autorizar se pueden elegir scopes, con `workflow:read` + `execution:read`
(+ `workflow:write` si se quiere importar sin UI) alcanza — no hace falta `credential:read`.

## Decisiones ya tomadas (no reabrir sin motivo)

| Tema | Decisión |
|---|---|
| Fuente de datos | El Excel, única. Se van `bot.product`, `bot.variant`, `job_variant*`. |
| Dashboard (`catalog-curator`) | Se retira como vía de carga. |
| Quién calcula | **El LLM**, con instrucciones precisas y datos correctos. No motor determinista. |
| Un material por producto | "Vinilo UV montado en corrugado" es UN material, no una composición. |
| Unidad del chunk | **Colección + FAMILIA de material** (62 chunks). Las otras dos se generan para comparar. |
| Ingesta | Desde la app, no CLI. Reemplazo total en una transacción. |
| Canal v1 | Chat Trigger de n8n. Sin Chatwoot ni WhatsApp hasta la Fase 5. |
| Alcance del catálogo | Solo las 39 filas de Lista de precios. Papelería NO entra. |
| Sinónimos | No se agregan todavía. Probar con nombre + descripción. |
| Medidas libres | **El bot SÍ calcula geometría** (pedido del cliente; revierte el plan madre). Las medidas del catálogo son referencias, no un menú. |
| El rinde | Se CALCULA desde la geometría del material. La columna solo para unidades no geométricas; cargada gana sobre el cálculo (con aviso de drift). |
| La fórmula de encaje | Vive en Instrucciones (→ system prompt), NO repetida por chunk. El chunk lleva los datos: área útil, separación, unidad, escala. |

## Cosas que cuestan sangre si no se saben

**El bug caro no está en el cálculo: está en lo que el modelo DECLARA.** Es el patrón que
más veces mordió, con 5 casos medidos y 4 modos de cobro distintos. La forma siempre es la
misma: el modelo hace una conversión que le toca al auditor (o rellena un dato que falta), el
auditor opera sobre ese input adulterado, **y la aritmética cierra perfecto**. La ejecución
sale verde, `hallazgos: []`, y el precio está mal.

| Pedido | Declaró | Salió | Debía |
|---|---|---|---|
| 100 stickers 7x7 | `6` (los pliegos) | $4.000 | $16.800 |
| una lona de 3x1 | `3` (los m2) | $198.000 | $66.000 |
| 2,45 m de planos | `1` ("un trabajo") | $8.000 | $19.600 |
| 100 stickers en OPP (sin medida) | 5x5 inventado | $8.400 | preguntar |
| 250 stickers (sin medida) | 5x5 inventado | — | preguntar |

**El auditor no puede detectarlo, por diseño.** Re-calcula el total desde el catálogo, que es
justo lo que hace bien; lo que no tiene es contra qué comparar la PREMISA. `6 pliegos × $2.800`
es tan válido como `100 piezas ÷ 18`. No hay campo que diga qué pidió el cliente.

**Y el gate de 132 casos tampoco, tampoco por diseño**: alimenta al motor con las piezas
correctas leídas del Excel, nunca con lo que el modelo declara. El caso 13 del Excel *es* el
pedido de los stickers 7x7 y da $16.800 en verde. Es [[tests-fixtures-mienten]] de nuevo — el
paso que se rompe queda afuera por construcción. **Esta clase de bug SOLO aparece corriendo el
bot de verdad y leyendo la ejecución.** Cuando se toque el schema, el prompt o el chunk, hay
que probar en vivo los cuatro modos: pliego, m2, paquete y medida continua.

**Antes de culpar al prompt o al modelo, leé el CHUNK que trajo el retrieval.** Tres de los
cuatro bugs de la sesión del 31/08 estaban en el texto del chunk:
- El bot cotizaba stickers de 5x5 sin que nadie diera medida. Causa: de los 5 chunks que traía
  el retrieval, **4 encabezan sus "Medidas de referencia" con 5x5**, cada una con la cuenta ya
  resuelta de ejemplo. No elegía — tomaba lo primero concreto que veía.
- El chunk decía "se cotiza CUALQUIER medida" sin decir de DÓNDE sale esa medida.
- El chunk m2 daba la fórmula (`m2 = ancho x alto ÷ 10.000`) sin decir que NO hay que aplicarla.

La regla general: **mostrarle la cuenta al modelo lo invita a hacerla.** Los ejemplos del chunk
existen por una buena razón (que no lea el tramo en piezas), así que se quedan — pero cada uno
tiene que cerrar diciendo qué NO hay que hacer con él. En `chunk.ts` eso vive en
`MEDIDA_LA_DA_EL_CLIENTE`, la coda de `ejemploCadena()` y la línea de m2.

**Un texto ambiguo en el schema se paga en pesos.** La descripción de `cantidad` decía "EN LA
UNIDAD DE COBRO que declara el catálogo" mientras el chunk decía, en mayúsculas, "Precio según
CANTIDAD DE PLIEGOS A3 (no de piezas)". El modelo obedeció al pie de la letra: es lo que hacen.
La regla correcta es una sola y no admite matices — **lo que dijo el cliente, sin convertir** —
y el caso del metro lineal, que parecía una excepción, era el mismo principio ("2,45 metros" es
lo que dice el cliente). Cuando una descripción necesita un "pero si…", probablemente esté mal
la regla, no el ejemplo.

**Los casos del gate se cargan como escribe el CLIENTE, no ya convertidos.** Es la lección
más cara de la sesión, y es la de "los fixtures mienten" otra vez: mientras la hoja cargaba
"100 tarjetas" con Cantidad 1 (un paquete), el paso que convierte piezas→paquetes no lo
ejercía ningún test, y ese es el bug del $54.000.000 que sí vive en producción. Mismo patrón
con el escaneo: los 2 casos usaban metros ENTEROS, así que no distinguían "3 metros" de "3
piezas". **Si el caso viene pre-masticado, el test aprueba un camino que el cliente nunca
recorre.**

**Un fallo que el cliente no ve es peor que uno que ve.** Dos de esta sesión: el bot mudo
(la ejecución moría, cero respuesta) y el cobro de menos por medida continua ($8.000 en vez
de $19.600, sin hallazgo porque la cuenta cerraba sola). Los dos salieron a la luz probando
EN VIVO, no en el gate. Corolario para todo arreglo de este tipo: dejar rastro (`via`, un
hallazgo) o el arreglo vuelve el problema invisible — la ejecución sale verde y nadie sabe
si pasa una vez por día o cien.

**El tamaño del pliego sale del dato, no del código.** La columna `Unidad` del material dice
`pliego A3`. Estuvo hardcodeado en `chunk.ts` y se corrigió: si mañana entra un `pliego A4`,
el chunk lo dice solo.

**El modo se deriva por PREFIJO** (`modoDe()` en `parse.ts`). `pliego A3`, `pliego A4` y
`pliego doble` son todos modo pliego; `m2` y `m2 con laminado`, modo m2. Consecuencia: una
unidad nueva que se cobre distinto **no** debe llamarse empezando con `pliego` ni `m2`, o se
calcula con la fórmula equivocada sin ningún aviso. Y `metro cuadrado` ≠ `m2`: no matchea.

**El chunk se arma en el SERVER, desde las hojas crudas.** El cliente manda las hojas, no los
chunks: si mandara los chunks ya armados, cualquiera con la consola del browser podría
inyectar texto al catálogo del bot. No cambiar esto por comodidad.

**No usar TRUNCATE.** El rol `bot_curator` tiene `select/insert/delete` pero no es dueño de la
tabla, y TRUNCATE en Postgres exige propiedad — no se puede otorgar por grant. Se borra con
`delete` dentro de la transacción; mismo efecto.

**`type "vector" does not exist` al ingestar.** En Supabase pgvector vive en el schema
`extensions` y el search_path del rol (`"$user", public`) no lo incluye: el cast `::vector`
sin calificar no resuelve. Fix en `db.ts`: `set local search_path = public, extensions`
dentro de la transacción (muere con ella).

**El .xlsx se edita con scripts, no a mano.** `visor/scripts/*.mjs` hacen sustitución
quirúrgica sobre el ZIP (todos con dry run por defecto y `--apply` para escribir; el manejo
del ZIP y sharedStrings está compartido en `scripts/lib-xlsx.mjs`, que también chequea el
lock de LibreOffice). Verificado que dejan las demás hojas byte-idénticas. Detalles que
rompen si se ignoran:
- Las **filas vacías no existen** como `<row>`: el XML salta de `r="1"` a `r="3"`. Reindexar
  sin reconstruir los huecos aplasta todas las separaciones.
- Los offsets `nameLen`/`extraLen` del **local header difieren** de los del directorio central.
- Reusar los estilos que ya están en el archivo, no inventar nuevos.
- Los **tags self-closing** (`<c r="G2" s="11"/>`, `<row r="5"/>`) desalinean todo si un regex
  con `[\s\S]*?` no los contempla: se tragan el contenido hasta el próximo cierre. Ya mordió
  una vez (celda vacía intermedia en Materiales); `lib/xlsx.ts` quedó arreglado.

**La fórmula de encaje está DUPLICADA a propósito** en `visor/lib/geometria.ts` (la usa el
visor) y `visor/scripts/lib-xlsx.mjs` (la usan los scripts, que no importan TS). Si cambia
una, cambiar la otra — los tests del visor fijan los 7 rindes históricos.
La TERCERA (el nodo Code del bot) **no** es una copia a mano: `n8n/build-flow.mjs` la tiene
como un único string que evalúa para testear y emite dentro del nodo. Si cambia la fórmula,
son dos lugares a tocar, no tres — y los 132 casos del Excel avisan si se desalinean.

**El auditor tiene que reproducir la planilla, y el build lo verifica.** `build-flow.mjs`
corre los 11 rindes + los 132 casos de la hoja `Casos de prueba` antes de escribir el JSON;
si falla uno, no emite nada. Ese gate ya pagó: agarró que los materiales m2 (un solo tramo
`Desde 1`) dejaban afuera cualquier medida menor a 1 m2 — media lona no matcheaba ningún
tramo. Los tests se verificaron en rojo a propósito (rompiendo el redondeo y el encaje)
antes de darlos por buenos.

**Si el .xlsx está abierto en LibreOffice, no escribirlo.** Existe `.~lock.<archivo>#`
mientras está abierto; chequearlo antes de aplicar cualquier script, o el próximo guardado del
usuario pisa el cambio. LibreOffice además reescribe el archivo al guardar: renumera estilos y
agrega `theme1.xml` + `docProps`. Es normal, no rompe nada.

**Los conteos hay que verificarlos, no estimarlos.** Varias veces en esta sesión la intuición
falló (los productos únicos eran 31, no ~19; el 6x3 no era una excepción de la tabla, solo
faltaba probar la orientación rotada). Los scripts de verificación están en el scratchpad;
si no están, se rehacen rápido leyendo el .xlsx con Node.

## Preguntas abiertas

**El guardarraíl de precios: CONSTRUIDO** (opción B del plan, la recomendada). El agente
emite un DESGLOSE estructurado y el nodo Code lo re-calcula contra la metadata del chunk
(escala + geometría) + sanity floor. En v1 el fallo se MUESTRA en el chat de prueba, no se
corrige en silencio. Falta el visto bueno de Martín **viéndolo andar**, no en el papel.
Detalle y opciones descartadas en `plans/workflow-n8n-v1.md`.

**Los parámetros ya tienen casos** (10 stickers 3x3 → $4.000 por mínimo; 1 lona 90x60 →
$8.600 por redondeo). Ejecución definida en `plans/workflow-n8n-v1.md`: el builder los lee
del Excel (filas de Casos de prueba cuyo Pedido contiene `(activa el`) y los inyecta al
system prompt como ejemplos. NO van al chunk; la fuente única queda intacta.

**Preguntas nuevas del plan de Fase 3** (ver su última sección): ¿el mínimo por trabajo
aplica por producto o por pedido completo? (el plan asume por producto — confirmar con TG);
¿alcanza solo el mail como contacto en v1?; topK inicial 3.

**Lo que quedó abierto al cerrar el 31/08** (nada bloquea seguir):
- **Un caso que TG tiene que decidir**: `una carpeta institucional` hace repreguntar "¿sin
  laminar o laminado?" en vez de ir a la base. La colección Papelería comercial no tiene
  `Material base` marcado, así que el bot no tiene cuál elegir. O se le marca una base en el
  Excel, o se acepta que ahí pregunte.
- ~~**La cola de debug del Responder** sale al mensaje del cliente.~~ **HECHO (Parte 4)**:
  se retiró; el rastro está en `bot.log`.
- ~~**Los 132 casos del Excel nunca se corrieron completos contra el catálogo v3** en vivo.~~
  **HECHO con el log de la Fase 5: 130/132** (ver Fase 4). Quedan las 2 preguntas de
  elección de material (#53 banner roll-up duplicado → preguntar a TG; #72 "1 talonario
  x10" → fraseología). La decisión de esperar al log fue correcta: la tanda entera se
  auditó con un SELECT.
  Contexto de aquel intento por MCP (sirve como referencia del rate limit):
  Se intentó por MCP y se llegó a **97 lanzados, 28 auditados — 28/28 exactos** (stickers en
  los 4 materiales, etiquetas, vinilo UV con mínimo facturable, carteles; incluye el caso del
  redondeo). Ahí cortó el **rate limit del MCP**: cada caso cuesta 2 llamadas (ejecutar +
  leer), y con 8 en paralelo el servidor devuelve `Too many requests`.
  - **No es configurable, y se verificó de dónde sale**: n8n NO tiene rate limiting nativo en
    su API REST, y el Traefik de Dokploy no tiene ningún middleware de `rateLimit` (grep sobre
    `/etc/dokploy/traefik/` vacío). Queda el limiter de la capa MCP/OAuth de n8n, que no expone
    variable de entorno — habría que parchear el código. **Pegarle a `/api/v1/` NO lo esquiva**
    si algún día el límite pasa a estar en el proxy.
  - **Por qué esperar al log es mejor que un script**: con el firewall / `bot.log` escribiendo
    cada turno en Supabase, auditar los 132 pasa a ser **un SELECT**, no 132 lecturas por MCP.
    Y sirve igual en producción con clientes reales, no solo para correr la planilla.
  - Gotcha al diagnosticar desde el VPS: `curl` al dominio devuelve **403 por el geo-block
    solo-AR de Cloudflare** (la IP del datacenter no es argentina) — ese 403 no es un rate
    limit y ese test no mide nada. Es el mismo hairpin de [[tg-bot-prod-standup]].
- **Un archivo temporal sin borrar**: `visor/lib/__tests__/ver-chunk-stickers-tmp.test.ts`
  (y `visor/ver-chunk-tmp.test.ts` de la sesión anterior). No están commiteados. `rm` está
  denegado para Claude: los borra Martín.

**Nadie abrió el .xlsx para ver cómo quedó visualmente.** No hay LibreOffice en la máquina de
Claude; toda la validación fue estructural (ZIP íntegro, XML bien formado, contenido correcto,
e2e del visor). El aspecto — anchos de columna, las 3 columnas nuevas de Materiales, los 7
casos nuevos — está sin revisar. Al abrirlo, chequear también que los desplegables de
Productos sigan funcionando.

## Comandos

```bash
# el flow de n8n (desde project-context/TerminalGrafica/whatsapp-rag/)
node n8n/build-flow.mjs           # tests + emite flows/cotizador-v1.json
node n8n/build-flow.mjs --test    # solo los 132 casos + rindes, no escribe
node n8n/test-auditor.mjs         # los nodos Code contra el JSON emitido
node n8n/armar-prompt.mjs         # solo el prompt: regenera prompt-final.txt y mide

cd project-context/TerminalGrafica/whatsapp-rag/visor
pnpm install
pnpm test        # 164 tests (los *-tmp.test.ts contra el .xlsx real no se commitean)
pnpm dev         # http://localhost:3000
pnpm build

# editar el .xlsx (SIEMPRE dry run primero, y con el archivo cerrado)
node scripts/<script>.mjs            # dry run
node scripts/<script>.mjs --apply    # escribe
```

Nota: `pnpm --dir <ruta> test` funciona; `pnpm --dir <ruta> vitest` no (falla con EACCES).
El cwd del shell se resetea entre llamadas: usar rutas absolutas.
