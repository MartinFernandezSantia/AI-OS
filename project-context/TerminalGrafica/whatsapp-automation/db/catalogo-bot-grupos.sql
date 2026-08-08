-- =============================================================================
-- CAPA BOT: AGRUPACIÓN DE PRODUCTOS (B-27) — DDL
-- =============================================================================
-- Nueva capa que le permite al bot ver ciertos productos de `public` agrupados
-- bajo UN producto-bot con variantes (ej.: "Tacos", "Folletos"), con nombres y
-- formatos propios del bot, SIN perder la conexión con el catálogo maestro: cada
-- variante del grupo apunta a una fila real de public.product_variants, así el
-- PRECIO y las pricing_rules salen siempre de public (nunca se duplican montos).
--
-- INVARIANTE: el bot NUNCA escribe en `public`. Estas tablas viven en el schema
-- `bot` y sólo REFERENCIAN (FK con on delete cascade) a public. `public` es
-- estrictamente solo-lectura desde el dashboard y el bot.
--
-- Se puebla con el SQL de overlay que genera el dashboard (lib/catalog/grupos-sql.ts),
-- resuelto por CLAVE NATURAL (nombre+rubro / nombre+color normalizados) — replayable
-- entre testing y prod porque los uuid difieren. Lo revisa y aplica Martin.
--
-- Uso: correr este DDL UNA vez en el SQL editor del Supabase (testing y prod).
-- Consumo por el bot (RAG ingest sobre bot.grupo_variantes): TODO — follow-up.
-- =============================================================================

create schema if not exists bot;

-- Producto-bot: agrupa varias variantes de public bajo un nombre que ve el bot.
create table if not exists bot.grupo (
  id            uuid primary key default gen_random_uuid(),
  -- clave natural estable del grupo = normKey(nombre_bot) || '|' || normKey(categoria_bot).
  -- Con ella el overlay upsertea sin depender del uuid (replay testing→prod).
  clave         text not null unique,
  nombre_bot    text not null,                       -- lo que ve/nombra el bot
  categoria_bot text,                                -- rubro bot opcional (texto libre)
  sinonimos     text[]  not null default '{}',
  casos_de_uso  text[]  not null default '{}',
  oculto        boolean not null default false,
  orden         int     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Membresía: cada variante de public que cuelga del grupo. El precio es SIEMPRE
-- el de la variante referenciada (v.price + pricing_rules), nunca uno propio.
create table if not exists bot.grupo_item (
  id                  uuid primary key default gen_random_uuid(),
  grupo_id            uuid not null references bot.grupo(id) on delete cascade,
  variante_id         uuid not null references public.product_variants(id) on delete cascade,
  nombre_variante_bot text,                          -- nombre bot de la variante en el grupo (opcional)
  orden               int     not null default 0,
  oculto              boolean not null default false,
  unique (grupo_id, variante_id)
);

create index if not exists grupo_item_grupo_idx    on bot.grupo_item(grupo_id);
create index if not exists grupo_item_variante_idx on bot.grupo_item(variante_id);

-- Vista de conveniencia: el catálogo agrupado como lo vería el bot, con el precio
-- resuelto desde public. `variante_bot` cae en cascada: nombre en el grupo →
-- display del overlay de renombrado → nombre vivo. Base para el RAG ingest futuro.
create or replace view bot.grupo_variantes as
select
  g.id            as grupo_id,
  g.clave         as grupo_clave,
  g.nombre_bot    as grupo_nombre_bot,
  g.categoria_bot,
  g.sinonimos,
  g.casos_de_uso,
  g.oculto        as grupo_oculto,
  g.orden         as grupo_orden,
  gi.id           as item_id,
  gi.orden        as item_orden,
  gi.oculto       as item_oculto,
  v.id            as variante_id,
  v.product_id,
  coalesce(gi.nombre_variante_bot, vm.display_variante, v.name) as variante_bot,
  v.name          as variante_vivo,
  v.color,
  v.unit          as unidad,
  v.price         as precio_lista
from bot.grupo g
join bot.grupo_item gi          on gi.grupo_id = g.id
join public.product_variants v  on v.id = gi.variante_id and v.is_active
left join bot.variante_meta vm  on vm.variante_id = v.id
order by g.orden, g.nombre_bot, gi.orden, v.name;

-- Después de aplicar cambios de agrupación: TOGGLE del workflow n8n (cache de catálogo).
