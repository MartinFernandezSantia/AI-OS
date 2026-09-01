-- =============================================================================
-- GRANT: bot_curator escribe bot.rag_catalog (ingesta desde el dashboard) · 2026-08-19
-- =============================================================================
-- El botón "Ingestar al bot" del catalog-curator reingesta el catálogo al RAG desde la app (arma el
-- export desde la DB, embebe con Gemini, y reescribe bot.rag_catalog) corriendo como bot_curator vía
-- CURATOR_DATABASE_URL. Hoy bot_curator NO tiene ningún privilegio sobre bot.rag_catalog (solo bot_runtime
-- la LEE). Este script le da lo justo para reescribirla.
--
-- La ingesta de la app usa DELETE + INSERT (no TRUNCATE): TRUNCATE exige ser owner y no se cubre con un
-- grant. Por eso NO damos truncate; delete alcanza. RLS de rag_catalog combina policies por OR, así que la
-- policy nueva curator_rag no toca la runtime_select de bot_runtime.
--
-- Aplicar en el SQL editor del Supabase correspondiente (TESTING primero, después PROD), como owner/admin.
-- Idempotente. Espeja el bloque 4 de whatsapp-rag-lite/db/schema-bot.sql (fuente de verdad).
-- =============================================================================

grant select, insert, delete on bot.rag_catalog to bot_curator;

drop policy if exists curator_rag on bot.rag_catalog;
create policy curator_rag on bot.rag_catalog for all to bot_curator using (true) with check (true);

-- pgvector vive en el schema `extensions`. La app inserta los embeddings con cast a extensions.vector;
-- sin usage sobre ese schema, bot_curator no puede referenciar el tipo → "type vector does not exist".
-- (bot_runtime ya lo tiene; a curator le faltaba.) Necesario también para la sección Negocio.
grant usage on schema extensions to bot_curator;

-- Verificación:
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema='bot' and table_name='rag_catalog' and grantee='bot_curator';
--   select polname from pg_policies where schemaname='bot' and tablename='rag_catalog';
