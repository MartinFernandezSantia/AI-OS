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
n8n/flows/         faq-bot-rag-lite.json (agente + memoria + PGVector como tool + Embeddings)
plans/             el plan del experimento
```

`lib/catalog` es una **copia autocontenida** de los helpers del repo `whatsapp-automation`
(el dashboard de curación). El export del catálogo se lee, por defecto, del contexto
compartido `../whatsapp-automation/db/export-actualizado-catalogo.json` (override con `--export`).

## Cómo se usa

Requiere `pnpm install`. Env: `OPENROUTER_API_KEY` (ingesta/consulta) y `DATABASE_URL` (`--apply`/consulta).

1. **DDL** — aplicar `db/rag-embeddings.sql` en el SQL Editor de Supabase (extensión vector +
   tabla `bot.producto_embeddings` + RPC `bot.match_productos`).
2. **Ingesta** — `pnpm rag:ingest --dry` (imprime los chunks, sin API/DB) para revisarlos;
   `pnpm rag:ingest` genera `rag-embeddings-data.sql` (truncate+insert) para aplicar; o
   `pnpm rag:ingest --apply` upsertea directo. Reingesta = correr de nuevo (idempotente).
3. **Consulta** — `pnpm rag:query "sirve para plotear un plano a1?"` (flags `--medicina` /
   `--inmobiliarias` para el guard de nicho).
4. **Workflow** — importar `n8n/flows/faq-bot-rag-lite.json`. En la UI: (a) en **Embeddings
   (OpenRouter)** elegir una credencial tipo **OpenAI** con API key = tu key de OpenRouter y Base
   URL `https://openrouter.ai/api/v1`, modelo `google/gemini-embedding-001` (el MISMO de la ingesta);
   (b) en **buscar_catalogo** (PGVector) confirmar Table `rag_catalogo`, Schema `bot` y los Column
   Names. Probar desde el chat de test del Chat Trigger (no toca Chatwoot ni WhatsApp).

## Tests

`pnpm test` — cubre `chunkRAG()` contra el export real + casos de borde.

## Decisiones (v0)

- Chunk **atómico por producto** (nombre + sinónimos + casos de uso + rubro + variantes).
- Enfoque **nativo n8n**: el RAG es el nodo **PGVector Vector Store** como tool del agente, con un
  sub-nodo **Embeddings** — sin HTTP ni sub-workflow.
- Embeddings `google/gemini-embedding-001` (dim nativa, **el mismo modelo en ingesta y query** — si
  difieren, los vectores no son comparables). Tabla formato LangChain (`text`/`metadata`/`embedding`).
- Guard de nicho **blando** (nicho en metadata + lo maneja el prompt del agente).
- **Sin montos** en la respuesta.
- Sin firewall. **Con memoria** (10 turnos/sesión) y flujo por etapas; el agente decide cuándo
  invocar la tool.
