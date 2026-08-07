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
n8n/flows/         faq-bot-rag-lite.json (GENERADO por build-flow.mjs — no editar a mano)
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
- **Registro de decisiones** (`bot.rag_decisiones`, DDL en `db/rag-decisiones.sql`): por cada
  mensaje del bot, el nodo **Log Decisión** guarda `session_id`, mensaje final, `estado`,
  `productos` recomendados, `precios` y el veredicto — un rastro durable de qué decidió el bot en
  cada turno (sobrevive aunque después se use Chatwoot). **Si el Verificador modificó el mensaje,
  `productos`/`precios` quedan EN BLANCO** (no es fiable qué sobrevivió a la edición). El INSERT
  tiene `onError=continue` (un fallo de log no rompe la respuesta); **Responder** re-emite el
  mensaje. Requiere aplicar el DDL + que el rol del bot tenga INSERT (mismo rol que escribe
  `bot.decisiones` en el v10).
- **Salida estructurada** (nodo `Salida · Agente`, `outputParserStructured`): el agente no
  devuelve solo texto sino un objeto `{ respuesta, etapa, productos_ofrecidos[], motivo,
  afirmaciones[] }`. `productos_ofrecidos` lleva `nombre_catalogo` (exacto como vino de la
  búsqueda) + `nombre_mostrado` + `atributos` (de UNA fila) + `cantidad` (si el cliente la dijo).
- **Agente Verificador** (2º agente, `outputParserStructured` + tool `consultar_catalogo_real`
  = `postgresTool` que relee `bot.rag_catalogo` por nombre): audita `productos_ofrecidos` contra
  el catálogo real y marca fallas: `producto_inventado`, `fusion_variantes` (atributos que no
  viven juntos en una fila real), `no_trabajado` (**Regla 0 autoritativa**: pisa la existencia en
  catálogo, así un sinónimo tramposo —ej. *fotocopias*— no excusa ofrecerlo; lista ampliable),
  `dato_no_corroborable`. Devuelve `{ aprobado, accion, fallas[], resumen }` con `accion` ∈
  aprobar/corregir/regenerar. Prompt reescrito con Fable + skill `prompt-master`.
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
