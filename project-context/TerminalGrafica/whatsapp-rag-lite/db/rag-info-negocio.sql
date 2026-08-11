-- Bot RAG lite — índice vectorial de la INFO DEL NEGOCIO (horario, dirección, pago, envíos, plazos…).
-- Habilita la SEGUNDA tool del agente: consultar_info_negocio (PGVector Vector Store, modo tool).
--
-- FUENTE DE VERDAD de los DATOS: bot.info_negocio (pares clave/valor curados a mano,
-- ../whatsapp-automation/db/info-negocio.sql). Esta tabla es SOLO el índice vectorial: la puebla
-- scripts/rag-ingest.ts --info leyendo bot.info_negocio y embebiendo cada `valor`. Para actualizar la
-- info: editás bot.info_negocio y re-corrés la ingesta (--info) para re-embeber.
--
-- MISMO formato LangChain que bot.rag_catalogo (text/metadata/embedding) y MISMO modelo de embeddings
-- (gemini-embedding-001, Google AI Studio) — si difiere el modelo, los vectores no son comparables.
-- Idempotente. Aplicar en el SQL Editor (como owner/admin). Reversible: drop abajo.

create extension if not exists vector with schema extensions;

-- Formato LangChain/PGVector: columnas id, text, metadata, embedding (los defaults del nodo).
create table if not exists bot.rag_info_negocio (
  id        uuid primary key default gen_random_uuid(),
  text      text  not null,                 -- el `valor` de la fila: frase autónoma que lee y parafrasea el agente
  metadata  jsonb not null default '{}',    -- {clave}  (horario_semana, direccion, pago, envio, …)
  embedding extensions.vector               -- SIN dimensión fija: la que devuelva el modelo. Pocas filas → seq scan, sin índice.
);
comment on table bot.rag_info_negocio is 'RAG lite: embeddings de bot.info_negocio (info operativa del negocio). Poblada por scripts/rag-ingest.ts --info.';

-- El nodo PGVector de query conecta con la cred bot_readonly → necesita SELECT.
-- La ingesta (script) escribe con una cred admin (DATABASE_URL) o aplicando el SQL como owner.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'bot_readonly') then
    grant usage on schema bot to bot_readonly;
    grant select on bot.rag_info_negocio to bot_readonly;
    raise notice 'Grant SELECT de bot.rag_info_negocio otorgado a bot_readonly.';
  else
    raise notice 'Rol bot_readonly no existe: sin grants (si n8n conecta como owner ya accede).';
  end if;
end $$;

-- =============================================================================
-- Sanity (tras poblar con rag-ingest.ts --info):
--   select count(*) from bot.rag_info_negocio;                          -- ≈ 11 (excluye filas 'COMPLETAR')
--   select metadata->>'clave', vector_dims(embedding)                   -- misma dim en todas las filas
--     from bot.rag_info_negocio order by 1;
--
-- Rollback:  drop table if exists bot.rag_info_negocio;
-- =============================================================================
