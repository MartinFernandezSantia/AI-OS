-- =============================================================================
-- BOT RAG LITE — SCHEMA GREENFIELD (schema `bot`)
-- =============================================================================
-- Plan: plans/rediseno-schema-greenfield.md (aprobado 2026-08-13).
-- Preparada por Claude, APLICA MARTIN (regla: yo preparo, vos aplicás).
--
-- NO hay producción todavía: el schema se crea de CERO (no migración). Colapsa la
-- pila de capas del catálogo (producto_meta/variante_meta/producto_item/familia/
-- grupo/vistas) a DOS tablas (bot.product + bot.variant) y unifica el log
-- (decisiones + rag_decisiones) en UNA tabla bot.log. RLS prendido en todo `bot`
-- como defensa en profundidad (la base está COMPARTIDA con quote-automation).
--
-- REQUIERE ya aplicado (NO son parte del greenfield, quedan como están):
--   · schema `bot` + enum `bot.accion` (whatsapp-automation/db/enum-accion-*.sql)
--   · firewall: bot.blocklist / bot.sender_estado / bot.injection_patterns +
--     funciones bot.firewall_check / bot.firewall_strike / bot.fw_log
--     (whatsapp-automation/db/firewall-tier1.sql, firewall-tier2-strike.sql).
--     Este archivo ACTUALIZA bot.fw_log al final (ahora loguea en bot.log).
--
-- Inglés = SOLO tablas y columnas. Los VALORES de token quedan en español:
--   · bot.sale_unit: unidad/hoja/pagina/plancha_a3/… (el COBRO map del bot no cambia)
--   · el jsonb metadata de rag_catalog: producto_id/nombre_canonico/precios
--   · rag_business_info.metadata: {clave}
--   · las CLAVES de fila de business_info (horario_semana, direccion, …)
--
-- Idempotente donde se puede (if not exists / drop-if / do-blocks guardados).
-- =============================================================================

begin;

create schema if not exists bot;
create extension if not exists vector with schema extensions;

-- =============================================================================
-- 0. ROLES
-- =============================================================================
-- bot_runtime: n8n / el bot. RENOMBRA al viejo bot_readonly (que mentía: este rol
--   también ESCRIBE el log). Conexión Postgres directa (pooler Supavisor).
-- bot_curator: el dashboard de curación (app standalone, otra sesión). NUEVO.
--   Conexión server-side directa (bot NO está expuesto por PostgREST).
-- El renombre PRESERVA la contraseña/LOGIN del rol viejo. Si no existe ninguno,
-- se crea NOLOGIN y Martin le da credenciales (alter role … with login password …).
do $roles$
begin
  if exists (select 1 from pg_roles where rolname = 'bot_readonly')
     and not exists (select 1 from pg_roles where rolname = 'bot_runtime') then
    alter role bot_readonly rename to bot_runtime;
    raise notice 'Rol bot_readonly renombrado a bot_runtime (credenciales preservadas).';
  elsif not exists (select 1 from pg_roles where rolname = 'bot_runtime') then
    create role bot_runtime nologin;
    raise notice 'Rol bot_runtime creado NOLOGIN — Martin: alter role bot_runtime with login password ''…'';';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'bot_curator') then
    create role bot_curator nologin;
    raise notice 'Rol bot_curator creado NOLOGIN — Martin: alter role bot_curator with login password ''…'';';
  end if;
end $roles$;

-- =============================================================================
-- 1. ENUMS
-- =============================================================================
-- sale_unit: valores en ESPAÑOL (el COBRO map de price-display.ts los mapea al texto
--   que ve el cliente; NO se tocan). 'pagina' cubre el viejo flag por_pagina.
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'sale_unit' and n.nspname = 'bot') then
    create type bot.sale_unit as enum
      ('unidad', 'hoja', 'pagina', 'm2', 'metro', 'trabajo', 'plancha_a3', 'hoja_a3');
  end if;
end $$;

-- resolution_level: cómo se resolvió el turno (inglés; se implementa de verdad).
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'resolution_level' and n.nspname = 'bot') then
    create type bot.resolution_level as enum ('firewall', 'canned', 'llm', 'escalated');
  end if;
end $$;

-- =============================================================================
-- 2. CATÁLOGO DEL BOT (curación; la escribe el dashboard vía bot_curator)
-- =============================================================================
-- Overlay/curación con FK a public. El PRECIO no se guarda: sale de
-- public.product_variants + pricing_rules por variant_id (generador de export).
create table if not exists bot.product (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,                 -- slug natural → metadata.producto_id (estable testing↔prod)
  bot_name   text not null,                        -- lo que ve/nombra el bot
  synonyms   text[] not null default '{}',         -- "También llamado:" (embedding)
  use_cases  text[] not null default '{}',         -- "Sirve para:" (embedding)
  niche      text,                                 -- filtro blando; null si el grupo mezcla nicho y no-nicho
  note       text,                                 -- info puntual al embedding
  hidden     boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Unicidad de bot_name NORMALIZADO (translate+lower+trim, ignorando ocultos): el
-- flujo de precios matchea por nombre del chunk; dos homónimos cruzarían montos.
create unique index if not exists bot_product_name_norm_uq
  on bot.product (translate(lower(trim(bot_name)), 'áéíóúñ', 'aeioun'))
  where not hidden;

create table if not exists bot.variant (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references bot.product(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade, -- precio/color/unit
  bot_name   text,                                 -- display de la variante (cascada: este → vivo)
  sale_unit  bot.sale_unit,                        -- unidad de cobro (español); null = no cobrable → mail
  pack_units integer,                              -- unidades por pack (si aplica)
  by_pack    boolean not null default false,
  hidden     boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (product_id, variant_id)
);

-- Una variante de public cuelga de UN SOLO producto-bot (si estuviera en dos, el
-- chunk la cotizaría dos veces con refs [vN] distintos).
create unique index if not exists bot_variant_variant_uq on bot.variant (variant_id);
create index if not exists bot_variant_product_idx on bot.variant (product_id);

-- =============================================================================
-- 2b. TRABAJOS (combos: 2+ materiales del catálogo que se hacen juntos)
-- =============================================================================
-- Un trabajo (ej. "invitaciones de casamiento") agrupa MATERIALES (variantes ya
-- curadas del catálogo) que se usan TODOS juntos, a diferencia de las variantes
-- de un producto (alternativas a elegir). El PRECIO TOTAL no se guarda: se CALCULA
-- sumando los precios de los materiales en la ingesta (chunkTrabajo). show_total
-- decide si el cliente ve ese total o solo los precios de los materiales.
create table if not exists bot.job (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,                 -- slug natural → metadata.producto_id
  bot_name   text not null,                        -- lo que ve/nombra el bot (= nombre_canonico)
  synonyms   text[] not null default '{}',         -- "También llamado:" (embedding)
  use_cases  text[] not null default '{}',         -- "Sirve para:" (embedding)
  niche      text,                                 -- filtro blando
  note       text,                                 -- info puntual al embedding
  show_total boolean not null default true,        -- true: mostrar el total calculado; false: solo materiales
  hidden     boolean not null default false,
  updated_at timestamptz not null default now()
  -- SIN columnas de precio: el total se calcula, no se cura.
);

-- Nombre normalizado único (espejo de bot_product_name_norm_uq). OJO: es un índice SEPARADO del de
-- product → un trabajo y un producto con el mismo nombre normalizado colisionarían en el match de
-- precios (por nombre) del bot. Convención de curación: nombres de trabajo distintos de los productos.
create unique index if not exists bot_job_name_norm_uq
  on bot.job (translate(lower(trim(bot_name)), 'áéíóúñ', 'aeioun'))
  where not hidden;

-- Materiales que componen un trabajo. Cada uno ES una variante ya curada del catálogo → reusa su
-- cobro/precio (sale_unit, pack_units, precio de public). Sin `position` (se ordena por nombre en el
-- chunk) ni `hidden` (un material compone o no; si no va, se borra la fila).
create table if not exists bot.job_material (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references bot.job(id)     on delete cascade,
  bot_variant_id uuid not null references bot.variant(id) on delete cascade,
  unique (job_id, bot_variant_id)
);
create index if not exists bot_job_material_job_idx on bot.job_material (job_id);

-- =============================================================================
-- 3. RUNTIME DEL BOT
-- =============================================================================
-- Formato LangChain/PGVector (id/text/metadata/embedding): defaults del nodo n8n.
-- embedding SIN dimensión fija (la que devuelva gemini-embedding-001). Catálogo
-- chico → seq scan, sin índice vectorial.
create table if not exists bot.rag_catalog (
  id        uuid primary key default gen_random_uuid(),
  text      text  not null,                        -- el chunk: lo que se embebe y ve el agente
  metadata  jsonb not null default '{}',           -- {producto_id, nombre_canonico, familia, nicho, precio_*, precios}
  embedding extensions.vector
);
comment on table bot.rag_catalog is
  'RAG lite: chunks del catálogo + embeddings gemini-embedding-001. Poblada por scripts/rag-ingest.ts.';

create table if not exists bot.rag_business_info (
  id        uuid primary key default gen_random_uuid(),
  text      text  not null,                        -- frase autónoma que lee y parafrasea el agente
  metadata  jsonb not null default '{}',           -- {clave}  (horario_semana, direccion, pago, envio, …)
  embedding extensions.vector
);
comment on table bot.rag_business_info is
  'RAG lite: embeddings de bot.business_info (info operativa). Poblada por scripts/rag-ingest.ts --info.';

-- Fuente de verdad de la INFO del negocio (pares clave/valor curados a mano). La
-- ingesta --info la lee y embebe cada `value` en rag_business_info.
create table if not exists bot.business_info (
  key        text primary key,                     -- horario_semana, direccion, pago, envio, plazos, contacto, redes, factura, …
  value      text not null,
  updated_at timestamptz not null default now()
);
comment on table bot.business_info is
  'Info operativa del negocio (fuente del --info ingest). Las CLAVES quedan en español.';

-- Log unificado: una fila por turno. Funde el viejo bot.decisiones (operativo) y
-- bot.rag_decisiones (memoria del cerebro). Guarda las DOS puntas del turno
-- (customer_message + bot_message). El read-back de memoria filtra por session_id.
create table if not exists bot.log (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  session_id       text not null,                  -- conversación (String(conversationId) en Chatwoot)
  customer_message text,                            -- lo que RECIBIÓ el bot
  bot_message      text,                            -- lo que ENVIÓ el bot
  action           bot.accion,                      -- enum del firewall/router (existente)
  resolution_level bot.resolution_level,
  state            text,                            -- ok | corrected | regenerated | rejected
  products         jsonb not null default '[]',     -- memoria: nombre producto + nombre_variante + cantidad
  prices           jsonb,                           -- solo auditoría
  verification     jsonb,                           -- solo auditoría (veredicto del Verificador)
  signals          jsonb,                           -- {entregado, envioFallido, latencia_ms, …}
  execution_id     text                             -- $execution.id (match INSERT↔UPDATE del turno)
);
create index if not exists bot_log_session_idx on bot.log (session_id, created_at);
create index if not exists bot_log_execution_idx on bot.log (execution_id);
comment on table bot.log is
  'Log unificado del bot (una fila por turno): operativo + memoria del cerebro. Ver plan greenfield.';

-- Errores de ejecución del bot (Error Trigger tg-bot-error → nodo Log Error).
create table if not exists bot.errors (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  workflow_name text,
  failed_node   text,
  message       text,
  stack         text,
  execution_id  text,
  execution_url text,
  mode          text
);

-- =============================================================================
-- 4. RLS + GRANTS (cinturón + tiradores: RLS es la 2ª capa sobre los grants)
-- =============================================================================
-- El owner (migraciones, export SELECT, ingest, funciones firewall SECURITY
-- DEFINER) BYPASSEA RLS (no usamos `force`). Cualquier otro principal (anon,
-- authenticated, empleados de quote-automation) no matchea ninguna policy y NO
-- tiene grant → denegado por defecto.

-- Revocar el pase libre heredado de PUBLIC/authenticated sobre lo nuevo.
revoke all on all tables in schema bot from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema bot from authenticated;
  end if;
end $g$;

-- ---- bot_curator: escribe el catálogo, lee la fuente public ----
grant usage on schema bot to bot_curator;
grant select, insert, update, delete on bot.product, bot.variant to bot_curator;
grant select, insert, update, delete on bot.job, bot.job_material to bot_curator;
grant usage on schema public to bot_curator;
grant select on public.products, public.product_variants, public.categories to bot_curator;

-- ---- bot_runtime: lee los vectores, escribe el log/errores ----
grant usage on schema bot to bot_runtime;
grant select on bot.rag_catalog, bot.rag_business_info to bot_runtime;
grant select, insert, update on bot.log to bot_runtime;   -- INSERT (Log Decisión) + UPDATE (Log Turno)
grant insert, select on bot.errors to bot_runtime;

-- CREATE en schema bot: el nodo PGVector de n8n (LangChain) corre `create table if not
-- exists` en su init aun en modo retrieve (ensureTable). Sin este grant tira 42501
-- "permission denied for schema bot". Concesión al nodo (la tabla ya existe → el create es
-- no-op); RLS sigue tapando todo lo que no tenga policy. Revisar si se cambia de nodo.
grant create on schema bot to bot_runtime;

-- pgvector vive en el schema `extensions` (create extension … with schema extensions, arriba).
-- El operador `<=>` no se puede calificar con schema → se resuelve por search_path. Los roles
-- default de Supabase ya traen `extensions`; bot_runtime (greenfield least-privilege) no. Sin
-- esto la búsqueda vectorial tira "operator does not exist: extensions.vector <=> unknown".
grant usage on schema extensions to bot_runtime;
alter role bot_runtime set search_path = "$user", public, extensions;  -- aplica en conexiones nuevas

-- ---- RLS: prender en TODAS las tablas de bot ----
alter table bot.product           enable row level security;
alter table bot.variant           enable row level security;
alter table bot.job               enable row level security;
alter table bot.job_material       enable row level security;
alter table bot.rag_catalog       enable row level security;
alter table bot.rag_business_info enable row level security;
alter table bot.business_info     enable row level security;
alter table bot.log               enable row level security;
alter table bot.errors            enable row level security;

-- Policies por rol (deny-all por defecto para todo lo demás). `create policy` no
-- soporta if-not-exists → drop-if primero para ser idempotente.
drop policy if exists curator_all on bot.product;
create policy curator_all on bot.product           for all    to bot_curator using (true) with check (true);
drop policy if exists curator_all on bot.variant;
create policy curator_all on bot.variant           for all    to bot_curator using (true) with check (true);
drop policy if exists curator_all on bot.job;
create policy curator_all on bot.job               for all    to bot_curator using (true) with check (true);
drop policy if exists curator_all on bot.job_material;
create policy curator_all on bot.job_material      for all    to bot_curator using (true) with check (true);

drop policy if exists runtime_select on bot.rag_catalog;
create policy runtime_select on bot.rag_catalog       for select to bot_runtime using (true);
drop policy if exists runtime_select on bot.rag_business_info;
create policy runtime_select on bot.rag_business_info for select to bot_runtime using (true);

-- bot.log: INSERT (Log Decisión) + SELECT (read-back de memoria) + UPDATE (Log Turno).
drop policy if exists runtime_all on bot.log;
create policy runtime_all on bot.log for all to bot_runtime using (true) with check (true);

drop policy if exists runtime_write on bot.errors;
create policy runtime_write on bot.errors for all to bot_runtime using (true) with check (true);

-- business_info: sin policy → owner-only. La ingesta --info lo lee como owner
-- (DATABASE_URL). Si el dashboard alguna vez curara la info, sumar una policy
-- for all to bot_curator + su grant (follow-up, no en este plan).

-- =============================================================================
-- 5. FIREWALL — actualizar bot.fw_log al log unificado
-- =============================================================================
-- fw_log escribía en bot.decisiones (que ya no existe). Ahora loguea en bot.log.
-- Es SECURITY DEFINER-agnóstico (la llaman firewall_check/firewall_strike, que sí
-- corren como owner → bypass RLS). Best-effort: si falla, la decisión sigue viva.
-- (El rename a inglés del RESTO del firewall queda DIFERIDO; esto es sólo el destino
--  del log, consecuencia directa de unificar decisiones+rag_decisiones en bot.log.)
create or replace function bot.fw_log(
  p_conversation_id bigint,
  p_text            text,
  p_accion          text
) returns void
language plpgsql
as $$
begin
  begin
    insert into bot.log (session_id, customer_message, action, resolution_level)
    values (p_conversation_id::text, left(coalesce(p_text, ''), 500), p_accion::bot.accion, 'firewall');
  exception when others then
    null;  -- logging fire-and-forget: si falla, la decisión del firewall sigue viva
  end;
end;
$$;

commit;

-- =============================================================================
-- Sanity (tras aplicar + poblar):
--   select count(*) from bot.rag_catalog;                          -- tras rag:ingest
--   select count(*) from bot.rag_business_info;                    -- tras rag:ingest:info
--   -- RLS: bot_curator escribe catálogo, NO el runtime; bot_runtime escribe log:
--   set role bot_curator;  insert into bot.product(key,bot_name) values('t','T');  -- OK
--   set role bot_runtime;  insert into bot.product(key,bot_name) values('u','U');  -- DENEGADO
--   set role bot_runtime;  insert into bot.log(session_id) values('t');            -- OK
--   reset role;
--
-- Rollback (dev descartable):
--   drop table if exists bot.log, bot.errors, bot.rag_catalog, bot.rag_business_info,
--     bot.business_info, bot.variant, bot.product cascade;
--   drop type if exists bot.sale_unit, bot.resolution_level;
-- =============================================================================
