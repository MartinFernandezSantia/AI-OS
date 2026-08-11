# whatsapp-rag-lite

Variante **RAG lite** del bot de WhatsApp de Terminal Gráfica: reemplaza la búsqueda
léxica/IDF del v10 por retrieval semántico con embeddings (Google `gemini-embedding-001`
vía OpenRouter) + pgvector. **Experimento paralelo al v10, no lo reemplaza.**

Diseñado con Fable. Plan completo en [`plans/rag-lite-bot.md`](plans/rag-lite-bot.md).

## Estructura

```
lib/catalog/       chunkRAG() + price-display.ts (precios, testeado) + helpers + tests
scripts/           rag-ingest.ts (ingesta) · rag-query.ts (consulta) · build-flow.mjs (genera el flow)
db/                rag-embeddings.sql (pgvector + tabla) · rag-decisiones.sql (log de decisiones)
n8n/flows/         faq-bot-rag-lite.json + -chatwoot.json + -uso-llm.json (GENERADOS por build-flow.mjs — no editar a mano)
plans/             los planes del experimento
```

El flow se regenera con `pnpm flow:build` (fuente de verdad = `scripts/build-flow.mjs`).

`lib/catalog` es una **copia autocontenida** de los helpers del repo `whatsapp-automation`
(el dashboard de curación). El export del catálogo se lee, por defecto, del contexto
compartido `../whatsapp-automation/db/export-actualizado-catalogo.json` (override con `--export`).

## Cómo se usa

Requiere `pnpm install`. Env: `GEMINI_API_KEY` (API key de Google AI Studio, para ingesta/consulta)
y `DATABASE_URL` (`--apply`/consulta).

1. **DDL** — aplicar `db/rag-embeddings.sql` en el SQL Editor de Supabase (extensión vector +
   tabla `bot.rag_catalogo` en formato LangChain).
2. **Ingesta** — `pnpm rag:ingest --dry` (imprime los chunks, sin API/DB) para revisarlos;
   `pnpm rag:ingest` genera `rag-embeddings-data.sql` (truncate+insert) para aplicar; o
   `pnpm rag:ingest --apply` upsertea directo. Reingesta = correr de nuevo (idempotente).
3. **Consulta** — `pnpm rag:query "sirve para plotear un plano a1?"` (flags `--medicina` /
   `--inmobiliarias` para el guard de nicho).
4. **Workflow** — importar `n8n/flows/faq-bot-rag-lite.json`. En la UI: (a) en **Embeddings
   (Google Gemini)** elegir la credencial **Google Gemini(PaLM) API** con tu key de Google AI
   Studio, modelo `models/gemini-embedding-001` (el MISMO de la ingesta); (b) en **buscar_catalogo**
   (PGVector) el Table Name va **schema-cualificado: `bot.rag_catalogo`** (si va solo `rag_catalogo`
   consulta `public` y devuelve `[]` en verde), Column Names id/embedding/text/metadata, sin
   Metadata Filter. El chat sigue en OpenRouter. Probar desde el chat de test del Chat Trigger.

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
- **Memoria de decisiones** (`bot.rag_decisiones`, DDL en `db/rag-decisiones.sql`) — lazo cerrado
  escritura + lectura:
  - **Escritura** (`Log Decisión`, al final): por cada mensaje del bot guarda `session_id`, mensaje
    final, `estado`, `productos` recomendados, `precios` y el veredicto. **Si el Verificador modificó
    el mensaje, `productos`/`precios` quedan EN BLANCO** (no es fiable qué sobrevivió). `onError=
    continue` (un fallo de log no rompe la respuesta); **Responder** re-emite el mensaje al chat.
  - **Lectura** (`Leer Decisiones` → `Contexto Previo`, al inicio del turno): trae las últimas
    decisiones OK de la sesión y antepone al system prompt un bloque con **qué productos ya recomendó
    el bot** — así el agente da continuidad con datos estructurados, no solo infiriendo del texto.
  - Es una memoria estructurada sobre Postgres (misma tabla); swappable por Redis si se quiere TTL.
    Requiere el DDL + INSERT para el rol del bot (mismo que escribe `bot.decisiones` en el v10).
- **Salida estructurada** (nodo `Salida · Agente`, `outputParserStructured`): el agente no
  devuelve solo texto sino un objeto `{ respuesta, etapa, productos_ofrecidos[], motivo,
  afirmaciones[] }`. `productos_ofrecidos` lleva `nombre_catalogo` (exacto como vino de la
  búsqueda) + `nombre_mostrado` + `atributos` (de UNA fila) + `cantidad` (si el cliente la dijo).
- **Agente Verificador** (2º agente, `outputParserStructured`, **SIN tool**): audita
  `productos_ofrecidos` contra el catálogo real y marca fallas: `producto_inventado`,
  `fusion_variantes` (atributos que no viven juntos en una fila real), `no_trabajado` (**Regla 0
  autoritativa**: pisa la existencia en catálogo, así un sinónimo tramposo —ej. *fotocopias*— no
  excusa ofrecerlo; lista ampliable), `dato_no_corroborable`. Devuelve `{ aprobado, accion,
  fallas[], resumen }` con `accion` ∈ aprobar/corregir/regenerar. Prompt con Fable + `prompt-master`.
  - **Pre-fetch batch, sin loop agéntico**: en vez de una tool que el modelo llama producto por
    producto (una inferencia nueva re-mandando todo el contexto cada vez, ~2k tok/producto), un
    nodo **Traer Catálogo Real** (postgres) trae de UNA query las filas reales de los productos
    afirmados y **Armar Verificación** las inyecta en el prompt → el Verificador audita en **UNA
    sola pasada**. N vueltas al modelo → 1. Mismo patrón que `Buscar Precios`.
  - **Match EXACTO (`= any`, no substring)**: trae SOLO las filas necesarias (nada de basura por
    `LIKE`) y, clave, un nombre que el Agente inventó/escribió mal **no trae fila** → `Armar
    Verificación` lo detecta (compara nombres afirmados vs filas devueltas) y se lo pasa al
    Verificador como `producto_inventado`. El propio match hace de anti-alucinación de nombres.
- **Remediación** (`Leer Veredicto` → `Ruteo Acción` switch):
  - **aprobar** → sale directo.
  - **corregir** (fallas que se arreglan editando texto) → **Corrector** (agente LLM sin tools,
    barato: saca/reformula sin re-buscar ni agregar) → `Aplicar Corrección`.
  - **regenerar** (solo grave: producto equivocado / no relacionado) → vuelve al **Agente
    principal** con feedback (respuesta anterior + fallas) y rehace. **Loop acotado a 3**
    (`¿Reintentar? (máx 3)` corta por `$runIndex`; al 4º intento cae al Corrector).
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
