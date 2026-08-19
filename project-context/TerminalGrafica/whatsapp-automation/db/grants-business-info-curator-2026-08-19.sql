-- =============================================================================
-- GRANT: bot_curator cura la info del negocio desde el dashboard · 2026-08-19
-- =============================================================================
-- La sección "Negocio" del catalog-curator edita bot.business_info (pares key/value) y, al guardar,
-- reingesta esa info al RAG (bot.rag_business_info) corriendo como bot_curator vía CURATOR_DATABASE_URL.
-- Hoy bot_curator NO tiene nada sobre ninguna de las dos tablas (business_info era owner-only; a
-- rag_business_info solo la LEE bot_runtime). Este script le da lo justo.
--
-- La reingesta usa DELETE + INSERT (no TRUNCATE): TRUNCATE exige owner y no se cubre con un grant.
-- RLS de ambas tablas combina policies por OR, así que curator_rag no toca la runtime_select de bot_runtime.
--
-- Aplicar en el SQL editor del Supabase correspondiente (TESTING primero, después PROD), como owner/admin.
-- Idempotente. Espeja el bloque 4 de whatsapp-rag-lite/db/schema-bot.sql (fuente de verdad).
-- =============================================================================

-- Fuente: editar la info del negocio (RW).
grant select, insert, update, delete on bot.business_info to bot_curator;
drop policy if exists curator_all on bot.business_info;
create policy curator_all on bot.business_info for all to bot_curator using (true) with check (true);

-- Destino: reingestar la info al RAG (delete+insert, no truncate).
grant select, insert, delete on bot.rag_business_info to bot_curator;
drop policy if exists curator_rag on bot.rag_business_info;
create policy curator_rag on bot.rag_business_info for all to bot_curator using (true) with check (true);

-- Verificación:
--   select table_name, privilege_type from information_schema.role_table_grants
--    where table_schema='bot' and table_name in ('business_info','rag_business_info') and grantee='bot_curator';
--   select tablename, polname from pg_policies
--    where schemaname='bot' and tablename in ('business_info','rag_business_info');
