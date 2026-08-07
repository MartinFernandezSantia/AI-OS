-- Bot RAG lite (enfoque NATIVO n8n): tabla compatible con el nodo PGVector Vector Store.
-- Plan: plans/rag-lite-bot.md
--
-- El retrieval lo hace el nodo nativo "PGVector Vector Store" de n8n (modo tool del agente),
-- con un sub-nodo "Embeddings OpenAI" apuntando a OpenRouter (google/gemini-embedding-001).
-- IMPORTANTE: el modelo de embeddings de la INGESTA y el de la QUERY tienen que ser el MISMO
-- (misma familia), si no los vectores no son comparables. Los dos usan gemini-embedding-001.
--
-- Idempotente. Aplicar en el SQL Editor. NO usa RPC ni guard de nicho duro (el nicho va en
-- metadata y lo maneja el prompt del agente — guard blando). Reversible: drop abajo.

create extension if not exists vector with schema extensions;

-- Formato LangChain/PGVector: columnas id, text, metadata, embedding (los defaults del nodo).
create table if not exists bot.rag_catalogo (
  id        uuid primary key default gen_random_uuid(),
  text      text  not null,                 -- el chunk: lo que se embebe y ve el agente
  metadata  jsonb not null default '{}',    -- {producto_id, nombre_canonico, rubro, nicho, familias, precio_*}
  embedding extensions.vector               -- SIN dimensión fija: la que devuelva el modelo. No se indexa (catálogo chico → seq scan).
);
comment on table bot.rag_catalogo is 'RAG lite: chunks del catálogo + embeddings gemini-embedding-001 (via OpenRouter). Poblada por scripts/rag-ingest.ts.';

-- El nodo PGVector de query conecta con la cred bot_readonly → necesita SELECT.
-- La ingesta (script) escribe con una cred admin (DATABASE_URL) o aplicando el SQL como owner.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'bot_readonly') then
    grant usage on schema bot to bot_readonly;
    grant select on bot.rag_catalogo to bot_readonly;
    raise notice 'Grant SELECT de bot.rag_catalogo otorgado a bot_readonly.';
  else
    raise notice 'Rol bot_readonly no existe: sin grants (si n8n conecta como owner ya accede).';
  end if;
end $$;

-- =============================================================================
-- Sanity (tras poblar con rag-ingest.ts):
--   select count(*) from bot.rag_catalogo;                       -- ≈ 82
--   select metadata->>'nombre_canonico', vector_dims(embedding)  -- misma dim en todas las filas
--     from bot.rag_catalogo limit 3;
--
-- Rollback:  drop table if exists bot.rag_catalogo;
-- =============================================================================
