-- Bot RAG hipersimplificado (lite): pgvector + tabla de embeddings + RPC de match.
-- Plan: project-context/TerminalGrafica/whatsapp-automation/plans/rag-lite-bot.md
--
-- Experimento paralelo al v10: reemplaza la búsqueda léxica (IDF) por retrieval semántico.
-- NO toca nada del v10 ni del catálogo (public.*). Solo agrega objetos nuevos al schema bot.
-- Idempotente. Aplicar en el SQL Editor. Reversible: drop table/function abajo.
-- Reingesta de datos = truncate + insert vía scripts/rag-ingest.ts (repo del dashboard).

-- --- 1. Extensión pgvector --------------------------------------------------
create extension if not exists vector with schema extensions;

-- --- 2. Tabla de embeddings (un row por producto público no oculto) ---------
-- Se llena desde el export del catálogo: chunk_text = nombre + sinónimos + casos de uso
-- + rubro + variantes (lo mismo que embebe el modelo y ve el Compositor).
create table if not exists bot.producto_embeddings (
  producto_id      uuid primary key references public.products(id) on delete cascade,
  nombre_canonico  text not null,
  chunk_text       text not null,          -- lo que se embebió; el Compositor ve esto
  content_hash     text not null,          -- sha256(chunk|modelo|dims) — observabilidad, no skip
  rubro            text,                   -- "<hoja> (<padre>)" legible
  familias         text[] not null default '{}',
  nicho            text,                   -- 'medicina' | 'inmobiliarias' | null (de atributos)
  precio_desde     numeric,                -- solo variantes limpias; null si no hay (no se usa en v0)
  precio_hasta     numeric,
  precio_confiable boolean not null default false,
  embedding        extensions.vector(1536) not null,  -- gemini-embedding-001 truncado (Matryoshka), L2-norm
  modelo           text not null default 'gemini-embedding-001',
  embedded_at      timestamptz not null default now()
);
-- SIN índice HNSW/IVF a propósito: ~82 filas → seq scan exacto e instantáneo.
-- Agregar índice recién si el catálogo supera ~10k filas.

-- Solo el rol dueño (o definer) escribe. Cortamos acceso directo de credenciales restringidas.
alter table bot.producto_embeddings enable row level security;

-- --- 3. RPC de match (kNN coseno + guard de nicho) --------------------------
-- Devuelve SIEMPRE hasta match_count candidatos (sin umbral: el Compositor descarta).
-- Guard de nicho = filtro DURO de metadata, réplica exacta de la semántica del SQL de v10:
-- un producto de nicho solo aparece si el mensaje mencionó ese rubro (flags calculados por
-- el flow n8n con un regex, nunca por la similitud del embedding).
create or replace function bot.match_productos(
  query_embedding       extensions.vector(1536),
  match_count           int     default 8,
  mencion_medicina      boolean default false,
  mencion_inmobiliarias boolean default false
) returns table (
  producto_id      uuid,
  nombre_canonico  text,
  chunk_text       text,
  rubro            text,
  nicho            text,
  precio_desde     numeric,
  precio_hasta     numeric,
  precio_confiable boolean,
  similitud        double precision
)
language sql
stable
security definer                                 -- como bot.firewall_check: bot_readonly solo EXECUTE
set search_path = bot, public, extensions
as $$
  select
    e.producto_id, e.nombre_canonico, e.chunk_text, e.rubro, e.nicho,
    e.precio_desde, e.precio_hasta, e.precio_confiable,
    1 - (e.embedding <=> query_embedding) as similitud       -- coseno → 1 = idéntico
  from bot.producto_embeddings e
  where e.nicho is null
     or (e.nicho = 'medicina'      and mencion_medicina)
     or (e.nicho = 'inmobiliarias' and mencion_inmobiliarias)
  order by e.embedding <=> query_embedding
  limit greatest(1, least(match_count, 12));
$$;

-- --- 4. Grants (condicionales, mismo patrón que firewall-tier1.sql) ---------
revoke all on function bot.match_productos(extensions.vector, int, boolean, boolean) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'bot_readonly') then
    grant usage on schema bot to bot_readonly;  -- ya lo tiene; inofensivo repetir
    grant execute on function bot.match_productos(extensions.vector, int, boolean, boolean) to bot_readonly;
    raise notice 'Grant EXECUTE de bot.match_productos otorgado a bot_readonly.';
  else
    raise notice 'Rol bot_readonly no existe: sin grants. Si n8n conecta como postgres/owner ya tiene acceso.';
  end if;
end $$;

-- =============================================================================
-- Sanity checks (correr a mano tras poblar la tabla con rag-ingest.ts):
--   select count(*) from bot.producto_embeddings;                 -- ≈ 82 (productos públicos no ocultos)
--   select min(embedded_at) from bot.producto_embeddings;         -- staleness vs el export
--   -- match_productos se prueba desde scripts/rag-query.ts (arma el vector de la query).
--
-- Rollback:
--   drop function if exists bot.match_productos(extensions.vector, int, boolean, boolean);
--   drop table if exists bot.producto_embeddings;
-- =============================================================================
