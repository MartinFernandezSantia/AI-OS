# whatsapp-rag-lite

Variante **RAG lite** del bot de WhatsApp de Terminal Gráfica: reemplaza la búsqueda
léxica/IDF del v10 por retrieval semántico con embeddings (Google `gemini-embedding-001`
vía OpenRouter) + pgvector. **Experimento paralelo al v10, no lo reemplaza.**

Diseñado con Fable. Plan completo en [`plans/rag-lite-bot.md`](plans/rag-lite-bot.md).

## Estructura

```
lib/catalog/       chunkRAG() + price-display.ts (precios, testeado) + loader + types + tests
scripts/           rag-ingest.ts (ingesta catálogo + --info) · rag-query.ts (consulta) · build-flow.mjs (genera el flow)
db/                schema-bot.sql (schema greenfield: catálogo 2 tablas + rag_* + log + roles/RLS) · auditoria-rag-lite.sql (queries)
n8n/flows/         faq-bot-rag-lite.json + -chatwoot.json (GENERADOS por build-flow.mjs — no editar a mano)
plans/             los planes del experimento
```

El flow se regenera con `pnpm flow:build` (fuente de verdad = `scripts/build-flow.mjs`).

`lib/catalog` es la lógica de chunk/precios que consume el export. El export del catálogo lo
genera `../whatsapp-automation/db/curador-export.sql` (lee `bot.product` + `bot.variant` + public);
se lee por defecto de `../whatsapp-automation/db/export-catalogo.json` (override con `--export`).

## Cómo se usa

Requiere `pnpm install`. Env: `GEMINI_API_KEY` (API key de Google AI Studio, para ingesta/consulta)
y `DATABASE_URL` (`--apply`/consulta).

1. **DDL** — aplicar `db/schema-bot.sql` en el SQL Editor de Supabase: crea el schema greenfield
   completo (catálogo `bot.product`/`bot.variant`, vectores `bot.rag_catalog`/`bot.rag_business_info`,
   fuente `bot.business_info`, log unificado `bot.log`, `bot.errors`, roles `bot_runtime`/`bot_curator`,
   grants + RLS). Requiere el enum `bot.accion` + firewall ya aplicados (whatsapp-automation, NO greenfield).
   La info del negocio necesita `bot.business_info` (pares `key`/`value`) poblada — es la fuente de verdad.
2. **Ingesta** — catálogo: `pnpm rag:ingest --dry` (imprime los chunks, sin API/DB) para revisarlos;
   `pnpm rag:ingest` genera `rag-embeddings-data.sql` (truncate+insert) para aplicar; o
   `pnpm rag:ingest --apply` upsertea directo. Info del negocio: `pnpm rag:ingest:info --apply` lee
   `bot.business_info` y llena `bot.rag_business_info` (o sin `--apply` genera `rag-info-negocio-data.sql`).
   Reingesta = correr de nuevo (idempotente). Editaste `bot.business_info` → re-corré `rag:ingest:info`.
3. **Consulta** — `pnpm rag:query "sirve para plotear un plano a1?"` (flags `--medicina` /
   `--inmobiliarias` para el guard de nicho).
4. **Workflow** — importar `n8n/flows/faq-bot-rag-lite.json`. En la UI: (a) en **AMBOS** sub-nodos
   **Embeddings (Google Gemini)** —el de `buscar_catalogo` y el de `consultar_info_negocio`— elegir la
   credencial **Google Gemini(PaLM) API** con tu key de Google AI Studio, modelo
   `models/gemini-embedding-001` (el MISMO de la ingesta); (b) en **buscar_catalogo** (PGVector) el
   Table Name va **schema-cualificado: `bot.rag_catalog`** (si va solo `rag_catalog` consulta `public`
   y devuelve `[]` en verde), Column Names id/embedding/text/metadata, sin Metadata Filter; (c) en
   **consultar_info_negocio** lo mismo con Table Name `bot.rag_business_info`. El chat sigue en
   OpenRouter. Probar desde el chat de test del Chat Trigger.

## Tests

`pnpm test` — cubre `chunkRAG()` contra el export real + casos de borde.

## Decisiones (v0)

- Chunk **atómico por producto** (nombre + sinónimos + casos de uso + rubro + variantes).
- Enfoque **nativo n8n**: el RAG es el nodo **PGVector Vector Store** como tool del agente, con un
  sub-nodo **Embeddings** — sin HTTP ni sub-workflow.
- Embeddings `gemini-embedding-001` de **Google AI Studio** (dim nativa, **el mismo modelo en
  ingesta y query** — si difieren, los vectores no son comparables). Ingesta por la API de Google;
  query por el nodo nativo Embeddings Google Gemini. Chat sigue en OpenRouter. Tabla formato
  LangChain (`text`/`metadata`/`embedding`).
- Guard de nicho **blando** (nicho en metadata + lo maneja el prompt del agente).
- **Info del negocio = segunda tool RAG** (`consultar_info_negocio`, tabla `bot.rag_business_info`).
  Datos operativos (horario, dirección, estacionamiento, pago/seña, envíos/retiro, plazos, urgentes,
  contacto, facturación, redes). Fuente de verdad = `bot.business_info` (pares key/value curados a
  mano, compartida con el v10); `rag:ingest:info` la vectoriza. Es info **autoritativa**: el agente la
  afirma sin anclar en `buscar_catalogo`. El Verificador NO marca la política oficial (no hay envíos /
  plazo por mail / urgentes coordinados) como `info_no_permitida`; sí marca plazos concretos inventados.
  La fila `factura` sigue en `COMPLETAR` → se excluye de la ingesta hasta que TG defina si facturan.
- **Estilo WhatsApp reforzado**: respuestas **< 200 caracteres** salvo cuando se listan opciones, y
  **máximo 2 párrafos** (un solo renglón en blanco) por mensaje.
- **Precios por placeholders** (el LLM nunca fija un precio): el chunk trae los precios en
  "Opciones:" como contexto (`[v1] Doble Faz ($15.000 el pack)`); el agente escribe `{P1}`,`{P2}` y
  declara `precios_solicitados` ({Pn}→nombre + `variante_ref` [vN] + cantidad). El nodo **Buscar
  Precios** (postgres) lee `metadata.precios` y **Insertar Precios** (Code terminal) reemplaza los
  `{Pn}` por el precio real (`precioDisplay`: unidad + tramo por cantidad, **sin totales**) y
  **valida** cualquier monto tipeado contra el catálogo (coincide → se acepta; no coincide → "a
  confirmar por mail"). Lógica en `lib/catalog/price-display.ts` (testeada); el Code de n8n inlinea
  una copia. Refrescar precios sin re-embeber: `pnpm rag:ingest --prices-only`.
  - **Tramos**: cantidad que cae en un hueco entre packs redondea **hacia arriba** al pack que la
    cubre (packs 100/500/1000, pide 300 → precio del de 500); por encima de todos, el más grande.
  - **Unidad sin duplicar**: `{Pn}` inyecta **SOLO el monto** ("$15.000"); la forma de cobro
    (el pack de N, por unidad, por m²…) la escribe el agente desde "Opciones:". Así su instinto de
    etiquetar la línea ("Pack de 100 doble faz: {P1}") queda correcto en vez de duplicar
    ("$15.000 el pack de 100 unidades el pack de 100"). El monto sigue siendo determinista/validado;
    solo el texto de la unidad pasa al agente. El nodo terminal colapsa cualquier eco residual.
- **Log unificado + memoria** (`bot.log`, DDL en `db/schema-bot.sql`) — **una fila por turno** que
  funde el viejo log operativo (`decisiones`) + la memoria del cerebro (`rag_decisiones`):
  - **Escritura** — `Log Decisión` (tras Insertar Precios) hace el **INSERT** del turno: `session_id`,
    las dos puntas `customer_message`/`bot_message`, `state`, `products`, `prices`, `verification`,
    `execution_id`. **Si el Verificador modificó el mensaje, `products`/`prices` quedan EN BLANCO**
    (no es fiable qué sobrevivió). En Chatwoot, `Log Turno` (fin del turno) hace **UPDATE** de ESA
    MISMA fila (match `execution_id`) con `action`, `signals` (entrega + `latencia_ms` plegada) y el
    `bot_message` realmente entregado. `onError=continue` (un fallo de log no rompe la respuesta).
  - **Lectura** (`Leer Decisiones` → `Contexto Previo`, al inicio del turno): trae de `bot.log` las
    últimas filas OK (`state='ok'` + `products`) de la sesión y antepone al system prompt un bloque
    con **qué productos ya recomendó el bot** — continuidad con datos estructurados, no solo el texto.
  - Roles: escribe/lee `bot_runtime` (INSERT+SELECT+UPDATE en `bot.log`, con RLS). El firewall
    auto-loguea vía `bot.fw_log` (`action` firewall_*, `resolution_level='firewall'`).
- **Salida estructurada** (nodo `Salida · Agente`, `outputParserStructured`): el agente no
  devuelve solo texto sino un objeto `{ respuesta, etapa, productos_ofrecidos[], motivo,
  afirmaciones[] }`. `productos_ofrecidos` lleva `nombre_catalogo` (exacto como vino de la
  búsqueda) + `nombre_mostrado` + `atributos` (de UNA fila) + `cantidad` (si el cliente la dijo).
- **Agente Verificador** (2º agente, `outputParserStructured`, **SIN tool**): guardrail de
  **política/rol** sobre la respuesta del bot. **NO mira el catálogo real** (no audita productos ni
  precios). Marca fallas: `no_trabajado` (**Regla 0 autoritativa**: pisa la existencia en catálogo,
  así un sinónimo tramposo —ej. *fotocopias*— no excusa ofrecerlo; lista ampliable),
  `info_no_permitida` (plazos/envíos/stock/toma de pedidos inventados; la política oficial vía
  `consultar_info_negocio` NO se marca), `derivacion_prematura`, `pedido_o_archivo_por_canal`,
  `fuera_de_rol`, `producto_no_declarado` (cruce respuesta-vs-auditoría: afirma datos de catálogo de
  un producto que no está en `productos_ofrecidos`; no valida contra el catálogo). **Armar
  Verificación** le pasa pedido + respuesta + auditoría en **UNA sola pasada** (sin tool, sin
  pre-fetch de catálogo → prompt corto y barato). Devuelve `{ aprobado, accion, fallas[], resumen }`
  con `accion` ∈ aprobar/corregir. Prompt con Fable + `prompt-master`.
- **Remediación** (`Leer Veredicto` → `Ruteo Acción` switch):
  - **aprobar** → sale directo.
  - **corregir** (cualquier falla) → **Corrector** (agente LLM sin tools, barato: saca/reformula
    sin re-buscar ni agregar) → `Aplicar Corrección`. Es la ÚNICA remediación: la respuesta nunca
    se rehace desde cero (regenerar ya no existe; cualquier acción que no sea aprobar cae a corregir).
  - El Agente principal además sabe por prompt que **no se hacen fotocopias** (línea A), para no
    afirmarlo de entrada.
- **Preguntar para converger** (etapa "falta info"): sin tope fijo de recomendados; si el pedido
  abarca muchas variantes, el agente pregunta por los ejes faltantes más decisivos, **máximo 3
  por mensaje**, para cerrar la info en la menor cantidad de vueltas.
- **Palabras del cliente**: el mensaje usa el término del cliente; el `nombre_catalogo` exacto va
  solo en la salida estructurada (interno). La cantidad se registra pero no filtra la búsqueda.
- **Preparar Respuesta** (punto único de convergencia) extrae `output.respuesta` → el chat muestra
  solo el mensaje limpio; `auditoria`, `verificacion` y `corregido` quedan en el item. Lee SOLO de
  su input: en n8n referenciar un nodo que no se ejecutó en la rama actual bloquea 300s.
- Sin firewall. **Con memoria** (10 turnos/sesión) y flujo por etapas; el agente decide cuándo
  invocar la tool.
