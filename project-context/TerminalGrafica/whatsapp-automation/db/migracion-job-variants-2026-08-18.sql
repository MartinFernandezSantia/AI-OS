-- =============================================================================
-- MIGRACIÓN: trabajos cartesianos → trabajos con VARIANTES-DE-TRABAJO · 2026-08-18
-- =============================================================================
-- Reemplaza el modelo viejo (bot.job_material N:N = cartesiano libre) por el nuevo
-- (bot.job_variant + bot.job_variant_material = variantes cerradas con componentes
-- concretos). Ver plan: whatsapp-rag-lite/plans/trabajos-variantes.md.
--
-- Único trabajo curado en prod: ENCARTONADO (confirmado). Por eso la re-curación de
-- las combinaciones válidas es MANUAL (la regla "qué medida va con qué encapsulado"
-- NO existe en el dato viejo — es justamente el bug que este cambio arregla).
--
-- Aplicar por PASOS, en orden, leyendo la salida de cada uno. SOLO Martin, en el SQL
-- editor del Supabase correspondiente (primero TESTING, después PROD).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PASO 0 — SNAPSHOT read-only del dato viejo (NO borra nada). Copiá esta salida
-- a un lado: te da los bot.variant.id de cada medida de encartonado y de encapsulado
-- para poder rearmar las combinaciones válidas en el dashboard.
-- -----------------------------------------------------------------------------
-- 0a. ¿Cuántos trabajos hay? Si sale >1, PARAR: hay más que el encartonado y este
--     script (pensado para 1) necesita repetir la re-curación por cada uno.
select count(*) as total_trabajos from bot.job where not hidden;

-- 0b. Los trabajos y sus materiales viejos (variante + de qué producto-bot sale).
select bj.key           as trabajo,
       bj.bot_name       as trabajo_nombre,
       bp.bot_name       as producto_parte,
       bv.id             as bot_variant_id,
       coalesce(bv.bot_name, pv.name) as variante,
       pv.price          as precio
from bot.job bj
join bot.job_material jm on jm.job_id = bj.id
join bot.variant bv on bv.id = jm.bot_variant_id
join bot.product bp on bp.id = bv.product_id
join public.product_variants pv on pv.id = bv.variant_id
where not bj.hidden
order by bj.bot_name, bp.bot_name, variante;

-- -----------------------------------------------------------------------------
-- PASO 1 — Crear las tablas nuevas (idempotente). NO toca bot.job_material todavía.
-- (Es el mismo DDL del bloque 2b de schema-bot.sql; se incluye acá para poder correr
--  la migración sin re-aplicar todo el schema.)
-- -----------------------------------------------------------------------------
create table if not exists bot.job_variant (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references bot.job(id) on delete cascade,
  bot_name   text not null,
  position   integer not null default 0,
  hidden     boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (job_id, bot_name)
);
create index if not exists bot_job_variant_job_idx on bot.job_variant (job_id);

create table if not exists bot.job_variant_material (
  id             uuid primary key default gen_random_uuid(),
  job_variant_id uuid not null references bot.job_variant(id) on delete cascade,
  bot_variant_id uuid not null references bot.variant(id)     on delete cascade,
  unique (job_variant_id, bot_variant_id)
);
create index if not exists bot_job_variant_material_jv_idx on bot.job_variant_material (job_variant_id);

-- -----------------------------------------------------------------------------
-- PASO 2 — RE-CURACIÓN del encartonado (MANUAL, en el dashboard catalog-curator).
-- En la pantalla de Trabajos → Encartonado, crear las variantes-de-trabajo y asignar
-- sus componentes según la regla de negocio (confirmada por el dueño):
--   · A3       → [encartonado A3]     + [encapsulado A3]
--   · 100x70   → [encartonado 100x70] + [encapsulado por Metro]
--   · 35x50    → [encartonado 35x50]  + [encapsulado por Metro]
--   · 50x70    → [encartonado 50x70]  + [encapsulado por Metro]
--   · 60x90    → [encartonado 60x90]  + [encapsulado por Metro]
--
-- ALTERNATIVA por SQL (si preferís no usar el dashboard): con los bot_variant_id del
-- PASO 0b, descomentar y completar. Ejemplo para la variante A3 del trabajo 'encartonado':
--
--   with jv as (
--     insert into bot.job_variant (job_id, bot_name, position)
--     select id, 'A3', 1 from bot.job where key = 'encartonado'
--     returning id
--   )
--   insert into bot.job_variant_material (job_variant_id, bot_variant_id)
--   select jv.id, x.bot_variant_id
--   from jv, (values
--     ('<bot_variant_id de encartonado A3>'::uuid),
--     ('<bot_variant_id de encapsulado A3>'::uuid)
--   ) as x(bot_variant_id);
--
-- Repetir para 100x70/35x50/50x70/60x90 (position 2..5), cada una con
-- [encartonado <medida>] + [encapsulado por Metro].

-- -----------------------------------------------------------------------------
-- PASO 3 — VERIFICAR la re-curación antes de borrar nada. Cada variante-de-trabajo
-- debe tener exactamente sus 2 componentes correctos.
-- -----------------------------------------------------------------------------
select bj.bot_name              as trabajo,
       jv.bot_name              as variante_trabajo,
       jv.position,
       coalesce(bv.bot_name, pv.name) as componente,
       bp.bot_name              as componente_producto,
       pv.price                 as precio_componente
from bot.job bj
join bot.job_variant jv on jv.job_id = bj.id
join bot.job_variant_material jvm on jvm.job_variant_id = jv.id
join bot.variant bv on bv.id = jvm.bot_variant_id
join bot.product bp on bp.id = bv.product_id
join public.product_variants pv on pv.id = bv.variant_id
order by bj.bot_name, jv.position, componente;

-- -----------------------------------------------------------------------------
-- PASO 4 — Una vez CONFIRMADO el PASO 3, retirar el modelo viejo. IRREVERSIBLE.
-- -----------------------------------------------------------------------------
-- drop table bot.job_material;

-- -----------------------------------------------------------------------------
-- PASO 5 — Re-generar el export v5 (curador-export-v5.sql) y re-ingestar:
--   guardar como db/export-actualizado-catalogo-v5.json → pnpm rag:ingest --apply
-- Verificar con: pnpm rag:query "encartonado a3"  → el chunk arranca con "Trabajo:"
-- y lista "- [t1] A3 (...)" con el precio real de la combinación válida.
-- =============================================================================
