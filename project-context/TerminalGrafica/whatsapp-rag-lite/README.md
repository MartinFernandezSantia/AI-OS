# whatsapp-rag-lite

Variante **RAG lite** del bot de WhatsApp de Terminal Gráfica: reemplaza la búsqueda
léxica/IDF del v10 por retrieval semántico con embeddings (Google `gemini-embedding-001`
vía OpenRouter) + pgvector. **Experimento paralelo al v10, no lo reemplaza.**

Diseñado con Fable. Plan completo en [`plans/rag-lite-bot.md`](plans/rag-lite-bot.md).

## Estructura

```
lib/catalog/       chunkRAG() + helpers autocontenidos (types, keys, effective, loader) + tests
scripts/           rag-ingest.ts (ingesta) · rag-query.ts (consulta CLI)
db/                rag-embeddings.sql (pgvector + tabla + RPC bot.match_productos)
n8n/flows/         faq-bot-rag-lite.json (agente + memoria + PGVector tool + Embeddings + salida estructurada + Verificador)
plans/             el plan del experimento
```

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
- **Sin montos** en la respuesta.
- **Salida estructurada** (nodo `Salida · Agente`, `outputParserStructured`): el agente no
  devuelve solo texto sino un objeto `{ respuesta, etapa, productos_ofrecidos[], motivo,
  afirmaciones[] }`. `productos_ofrecidos` lleva `nombre_catalogo` (exacto como vino de la
  búsqueda) + `nombre_mostrado` + `atributos` (de UNA fila) + `cantidad` (si el cliente la dijo).
- **Agente Verificador** (2º agente, `outputParserStructured` + tool `consultar_catalogo_real`
  = `postgresTool` que relee `bot.rag_catalogo` por nombre): audita `productos_ofrecidos` contra
  el catálogo real y marca fallas: `producto_inventado`, `fusion_variantes` (atributos que no
  viven juntos en una fila real), `no_trabajado` (lista de cosas que la imprenta NO hace, arranca
  con *fotocopias*, ampliable), `dato_no_corroborable`. Devuelve `{ aprobado, fallas[], resumen }`.
  Veredicto para el log; **todavía no bloquea** (no re-rutea ni corrige, solo alerta).
- **Preguntar para converger** (etapa "falta info"): sin tope fijo de recomendados; si el pedido
  abarca muchas variantes, el agente pregunta por los ejes faltantes más decisivos, **máximo 3
  por mensaje**, para cerrar la info en la menor cantidad de vueltas.
- **Palabras del cliente**: el mensaje usa el término del cliente; el `nombre_catalogo` exacto va
  solo en la salida estructurada (interno). La cantidad se registra pero no filtra la búsqueda.
- Un Code final (**Preparar Respuesta**) extrae `output.respuesta` → el chat muestra solo el
  mensaje limpio; `auditoria` (Agente) y `verificacion` (Verificador) quedan en el item, visibles
  en la ejecución.
- Sin firewall. **Con memoria** (10 turnos/sesión) y flujo por etapas; el agente decide cuándo
  invocar la tool.
