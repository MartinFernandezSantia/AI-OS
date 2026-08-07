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
n8n/flows/         faq-bot-rag-lite.json (agente + memoria + tool) · tool-buscar-catalogo.json (la tool RAG)
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
4. **Workflows** — importar PRIMERO `n8n/flows/tool-buscar-catalogo.json` (la tool RAG), después
   `n8n/flows/faq-bot-rag-lite.json` (el agente), y en el nodo `buscar_catalogo` seleccionar el
   workflow de la tool. Probar desde el chat de test del Chat Trigger (no toca Chatwoot ni WhatsApp).

## Tests

`pnpm test` — cubre `chunkRAG()` contra el export real + casos de borde.

## Decisiones (v0)

- Chunk **atómico por producto** (nombre + sinónimos + casos de uso + rubro + variantes).
- Embeddings a **1536 dims** (Matryoshka, truncado + L2-normalizado del lado del cliente).
- Guard de nicho = **filtro duro** en la RPC (no similitud).
- **Sin montos** en la respuesta (la tabla guarda el rango para activarlo después).
- Sin firewall. **Con memoria** (10 turnos/sesión) y flujo por etapas; el RAG es una **tool**
  (`buscar_catalogo`) que el agente decide cuándo invocar.
