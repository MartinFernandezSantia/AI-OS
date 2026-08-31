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
  Catalogo-TG-v3.xlsx        ← LA FUENTE ÚNICA (la base va una carga atrás: ver abajo)
  Catalogo-TG-v2.xlsx        ← el anterior, con los 31 productos. Referencia, no se toca
  Catalogo_WhatsApp_Terminal_Grafica (1).xlsx  ← entrega del cliente, por única vez
  n8n/                       ← Fase 3: EMPEZAR ACÁ
    README.md                            ← el flow, el auditor, las trampas, los casos de humo
    build-flow.mjs                       ← EL BUILDER: Excel + prompt → flow JSON (con los tests)
    test-auditor.mjs                     ← test de los nodos Code contra el JSON emitido
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
68 del cliente: 99 productos, 73 materiales, 13 colecciones, 93 casos de prueba. Incluye la
tarifa de `Vinilo y lona UV` ($21.000 → $22.000 el m², confirmada por TG el 18/08/2026).

⚠ **La base está una carga atrás**: los 7 materiales que entraron el 31/08 (ver *Los últimos
6 pendientes*, abajo) todavía no se ingestaron. Martin re-ingesta al empezar la próxima
sesión — hasta entonces el bot no los ve.

Los scripts leen el archivo con `CATALOGO=Catalogo-TG-v3.xlsx node <script>` (sin la
variable apuntan al v2, que quedó de referencia).

**Qué destapó la carga**: tres bugs del auditor, todos de la misma forma — el modelo
declaraba bien y el auditor interpretaba mal. Detalle en "Estado: qué falta" § *El catálogo
del cliente, cargado*. La lección que vale para lo que venga: **la relación entre lo que
pide el cliente y la unidad de cobro es un dato del catálogo**, no algo que el prompt deba
despejar — esa apuesta ya había fallado con los pliegos en la Fase 4.

## Estado: qué está hecho

**El Excel** (`Catalogo-TG-v3.xlsx`) — 6 hojas visibles + `_listas` oculta.
99 productos, 73 materiales, 13 colecciones, 93 casos de prueba. Los 31 productos originales
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

   1. **RE-INGESTAR desde el visor** — ⚠ **PENDIENTE**. La base tiene los 55 chunks de la
      ingesta del 30/08 (con `escala`, `es_base`, `sin_minimo`, `variantes` y `paquete` en
      la metadata), pero el Excel ya tiene **62**: faltan los 7 materiales cargados el 31/08.
      Hasta que se re-ingeste, el bot no cotiza microperforado, PVC, planos, escaneo, la
      plancha A4 ni las dos lonas con estructura.
   2. ~~Importar el flow y cablear 2 credenciales~~ — **hecho**: Google Gemini(PaLM) API
      (la MISMA para chat y embeddings) y BOT_DB. **Ojo: son 2, no 3** — el chat quedó en
      Gemini nativo, no OpenRouter (ver el README).
   3. ~~Smoke test de retrieval y los 4 casos de humo~~ — **hecho**, más 13 casos del
      catálogo nuevo.

   **Sincronizar el flow después de tocar el Excel o el builder.** Se regenera con
   `node n8n/build-flow.mjs` y se sube — por la UI o por el MCP (`update_workflow` con
   `updateNodeParameters`; `setNodeParameter` NO existe). Quedarse con el flow viejo da
   errores que **parecen del catálogo y son del flow**: eso costó una sesión entera
   persiguiendo un `modo desconocido` que ya estaba arreglado en el repo.

   Estado del build: **12 nodos**, prompt ~2.029 tokens, auditor verde contra **93/93
   casos del Excel** + 11 rindes históricos. `node n8n/build-flow.mjs` re-genera todo;
   `--test` corre solo los tests. `node n8n/test-auditor.mjs` prueba los nodos Code
   (23 escenarios de cableado) contra el JSON ya emitido.

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

   **Los 4 de la carga del 31/08** (verificados contra el motor, NO todavía en vivo —
   esperan la re-ingesta):

   | Escribir en el chat | Total | Qué ejercita | Si falla |
   |---|---|---|---|
   | `escaneo de 3 metros de planos` | $24.000 | metro lineal como modo `item` | si deriva por "modo desconocido", el flow quedó viejo: `modoDe` cambió en los dos lados |
   | `1 cartel de PVC espumado de 100x150 cm` | $69.000 | m² por encima del mínimo | $23.000 = se quedó en el mínimo de medio m² |
   | `10 planchas A4 de stickers` | $14.000 | la escala del material combinado | $19.000 = usó el tramo de 1, que solo aplica a una plancha sola |
   | `1 lona 2x0,85 con roll up` | $65.200 | precio cerrado, sin medida | si pide medida, se cargó como m² en vez de material propio |

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
4. **Fase 4 — medir.** Correr los 93 casos contra el bot y ver el % de aciertos. Si Flash Lite
   no llega, subir de tier es decisión de datos. Los 7 del motor son los más exigentes:
   el LLM tiene que hacer floor + dos orientaciones él solo.
5. **Fase 5 — producción.** Firewall + Chatwoot + WhatsApp.

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
cableado**, que mira el código EMITIDO: borrar el pase deja el build en 93/93 verde y rompe
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

## El MCP de n8n — Claude YA VE las ejecuciones

`https://n8n.terminalgrafica.cloud/mcp-server/http`, cableado en `.mcp.json` del repo.
OAuth 2.1 con registro dinámico: **lo autentica Martín** desde `/mcp` (se abre el browser),
Claude no puede hacerlo solo. Scopes que ofrece: `workflow:read/write/execute`,
`execution:read`, `credential:read`, `dataTable:read/write`, `project:read`, `tag:read`.

Esto **retira la restricción** que arrastraba el proyecto ("Claude no ve las ejecuciones,
pedile el dato a Martín"): con `execution:read` se leen el retrieval, la salida estructurada
y el veredicto del auditor directo de la ejecución. Donde más pesa es en la Fase 4 — 93 casos
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
son dos lugares a tocar, no tres — y los 93 casos del Excel avisan si se desalinean.

**El auditor tiene que reproducir la planilla, y el build lo verifica.** `build-flow.mjs`
corre los 11 rindes + los 93 casos de la hoja `Casos de prueba` antes de escribir el JSON;
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

**Nadie abrió el .xlsx para ver cómo quedó visualmente.** No hay LibreOffice en la máquina de
Claude; toda la validación fue estructural (ZIP íntegro, XML bien formado, contenido correcto,
e2e del visor). El aspecto — anchos de columna, las 3 columnas nuevas de Materiales, los 7
casos nuevos — está sin revisar. Al abrirlo, chequear también que los desplegables de
Productos sigan funcionando.

## Comandos

```bash
# el flow de n8n (desde project-context/TerminalGrafica/whatsapp-rag/)
node n8n/build-flow.mjs           # tests + emite flows/cotizador-v1.json
node n8n/build-flow.mjs --test    # solo los 93 casos + rindes, no escribe
node n8n/test-auditor.mjs         # los nodos Code contra el JSON emitido
node n8n/armar-prompt.mjs         # solo el prompt: regenera prompt-final.txt y mide

cd project-context/TerminalGrafica/whatsapp-rag/visor
pnpm install
pnpm test        # 110 tests (incluye e2e-tmp.test.ts contra el .xlsx real, no commiteado)
pnpm dev         # http://localhost:3000
pnpm build

# editar el .xlsx (SIEMPRE dry run primero, y con el archivo cerrado)
node scripts/<script>.mjs            # dry run
node scripts/<script>.mjs --apply    # escribe
```

Nota: `pnpm --dir <ruta> test` funciona; `pnpm --dir <ruta> vitest` no (falla con EACCES).
El cwd del shell se resetea entre llamadas: usar rutas absolutas.
