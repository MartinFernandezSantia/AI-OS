-- =============================================================================
-- Observabilidad — tabla de errores de ejecución del bot de WhatsApp Terminal Gráfica
-- =============================================================================
-- Preparada por Claude, APLICA MARTIN (regla: yo preparo, vos aplicás).
-- Colocar como migración timestamped en el repo del quote-system, p.ej.
--   supabase/migrations/2026072X<HHMMSS>_bot_errores.sql
--
-- Para qué: el workflow tg-bot-error (Error Trigger) registra acá toda falla
-- inesperada del flujo principal (un nodo que explota, DB caída, etc.). Hoy esas
-- fallas son SILENCIOSAS: el cliente no recibe respuesta y nadie se entera.
-- Con esto quedan OBSERVABLES:
--   select * from bot.errores order by created_at desc;
-- El execution_url abre la ejecución fallida en n8n para ver qué mensaje/cliente
-- la disparó (el conversation_id no viene en el payload del Error Trigger).
--
-- Escribe UN nodo Postgres (Log Error) con la MISMA cred que los Log del flujo
-- principal (Bot Readonly DB). INSERT directo (no via función), igual que
-- bot.decisiones — por eso NO se habilita RLS acá.
-- =============================================================================

create schema if not exists bot;

create table if not exists bot.errores (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  workflow_nombre text,
  nodo_fallido    text,
  mensaje         text,
  stack           text,
  execution_id    text,
  execution_url   text,
  modo            text
);

-- NO habilitar RLS: el nodo Log Error hace INSERT directo con la cred de n8n
-- (igual que bot.decisiones). RLS sin policy cortaría el insert.

-- --- Grants (condicionales, mismo patrón que las demás migraciones) ----------
-- Si n8n conecta como 'postgres' (owner) no hace falta ningún grant.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'bot_readonly') then
    grant usage  on schema bot     to bot_readonly;
    grant insert on bot.errores    to bot_readonly;
    raise notice 'Grant INSERT de bot.errores otorgado a bot_readonly.';
  else
    raise notice 'Rol bot_readonly no existe: sin grants. Si n8n conecta como postgres/owner ya tiene acceso.';
  end if;
end $$;

-- =============================================================================
-- Sanity check (tras aplicar): insertar y leer una fila de prueba
--   insert into bot.errores (workflow_nombre, nodo_fallido, mensaje)
--     values ('test', 'nodo x', 'error de prueba');
--   select * from bot.errores order by created_at desc limit 1;
--   delete from bot.errores where workflow_nombre = 'test';
-- =============================================================================
