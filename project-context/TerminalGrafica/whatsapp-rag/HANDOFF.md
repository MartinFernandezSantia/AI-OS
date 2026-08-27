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
  Catalogo-TG-v2.xlsx        ← LA FUENTE ÚNICA
  plans/
    rediseno-excel-motor-cotizacion.md   ← el plan madre (por qué, decisiones, fases)
    visor-chunks.md                       ← el plan del visor + la ampliación de ingesta
  visor/                     ← app Next 16, la herramienta de trabajo
    lib/{xlsx,parse,chunk,tokens}.ts      ← lógica pura (la reusa la ingesta)
    lib/{embeddings,db,actions}.ts        ← server-only: ingesta
    scripts/*.mjs                          ← edición quirúrgica del .xlsx (ver abajo)
```

Referencia (NO tocar, es el bot anterior): `../whatsapp-rag-lite/`.

## Estado: qué está hecho

**El Excel** (`Catalogo-TG-v2.xlsx`) — 6 hojas visibles + `_listas` oculta.
31 productos, 11 materiales (24 tramos), 4 colecciones, 46 casos de prueba.
Las reglas de la hoja Instrucciones reproducen **39/39** de los precios que calculó el cliente,
más 7 casos nuevos del motor (verificados a mano contra la fórmula y las escalas).

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

Salida actual: **7 chunks · 7.822 chars · ~1.956 tokens**, uno por colección+material.

## Estado: qué falta

1. ~~Configurar `.env.local`~~ — **hecho**, Martín ya lo cargó (`BOT_DB` + `GEMINI_API_KEY`).
   Recordar: **Claude no puede crear ni leer archivos `.env*`** (deny rule).
2. ~~Probar la ingesta contra la base real~~ — **hecho**: el camino completo
   (preview → embeddings → escritura) se ejercitó contra `bot.rag_catalog`. El gotcha del
   `search_path` de pgvector quedó arreglado en `db.ts` (ver "Cosas que cuestan sangre").
3. **Fase 3 — el workflow de n8n.** ← siguiente: el BUILD. El plan está escrito y
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
   - **PENDIENTE antes del flow: RE-INGESTAR** desde el visor. El chunk cambió
     (7.986 chars vs 7.822) y `bot.rag_catalog` todavía tiene la versión vieja, sin
     `escala` ni `es_base` en la metadata.
4. **Fase 4 — medir.** Correr los 46 casos contra el bot y ver el % de aciertos. Si Flash Lite
   no llega, subir de tier es decisión de datos. Los 7 del motor son los más exigentes:
   el LLM tiene que hacer floor + dos orientaciones él solo.
5. **Fase 5 — producción.** Firewall + Chatwoot + WhatsApp.

## Decisiones ya tomadas (no reabrir sin motivo)

| Tema | Decisión |
|---|---|
| Fuente de datos | El Excel, única. Se van `bot.product`, `bot.variant`, `job_variant*`. |
| Dashboard (`catalog-curator`) | Se retira como vía de carga. |
| Quién calcula | **El LLM**, con instrucciones precisas y datos correctos. No motor determinista. |
| Un material por producto | "Vinilo UV montado en corrugado" es UN material, no una composición. |
| Unidad del chunk | **Colección + material** (7 chunks). Las otras dos se generan para comparar. |
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

**Si el .xlsx está abierto en LibreOffice, no escribirlo.** Existe `.~lock.<archivo>#`
mientras está abierto; chequearlo antes de aplicar cualquier script, o el próximo guardado del
usuario pisa el cambio. LibreOffice además reescribe el archivo al guardar: renumera estilos y
agrega `theme1.xml` + `docProps`. Es normal, no rompe nada.

**Los conteos hay que verificarlos, no estimarlos.** Varias veces en esta sesión la intuición
falló (los productos únicos eran 31, no ~19; el 6x3 no era una excepción de la tabla, solo
faltaba probar la orientación rotada). Los scripts de verificación están en el scratchpad;
si no están, se rehacen rápido leyendo el .xlsx con Node.

## Preguntas abiertas

**El guardarraíl de precios: propuesta en el plan, falta el OK de Martín.** Reemplazo del
`{P1}`: el agente emite un DESGLOSE estructurado (material, modo, medida, rinde, tramo,
total) y un nodo Code lo re-calcula determinísticamente contra la metadata del chunk
(escala + geometría) + sanity floor (negativo, mínimo, redondeo, orden de magnitud). En v1
el fallo se MUESTRA en el chat de prueba, no se corrige en silencio. Detalle y opciones
descartadas en `plans/workflow-n8n-v1.md`.

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
cd project-context/TerminalGrafica/whatsapp-rag/visor
pnpm install
pnpm test        # 96 tests (incluye e2e-tmp.test.ts contra el .xlsx real, no commiteado)
pnpm dev         # http://localhost:3000
pnpm build

# editar el .xlsx (SIEMPRE dry run primero, y con el archivo cerrado)
node scripts/<script>.mjs            # dry run
node scripts/<script>.mjs --apply    # escribe
```

Nota: `pnpm --dir <ruta> test` funciona; `pnpm --dir <ruta> vitest` no (falla con EACCES).
El cwd del shell se resetea entre llamadas: usar rutas absolutas.
