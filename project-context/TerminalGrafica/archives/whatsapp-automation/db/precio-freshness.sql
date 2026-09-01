-- =============================================================================
-- Increment B (precios) — frescura de precio + vista bot.variantes con timestamp
-- =============================================================================
-- Preparada por Claude, APLICA MARTIN (regla: yo preparo, vos aplicás).
-- Colocar como migración timestamped en el repo del quote-system, p.ej.
--   supabase/migrations/2026072X<HHMMSS>_precio_freshness.sql
--
-- Para qué: el bot solo muestra un precio de lista si es "fresco" (actualizado
-- hace ≤ 30 días). product_variants NO tenía updated_at, así que:
--   1. Columna ADITIVA price_updated_at en public.product_variants. El motor del
--      mostrador no la lee ni la escribe: cero impacto en el quote-system.
--   2. Trigger que la bumpea SOLO cuando cambia price (bulk_upsert_products usa
--      UPDATE plano → un upsert sin cambio de precio NO renueva la frescura).
--   3. bot.variantes recreada exponiendo precio_actualizado + solo_descuentos.
--      Va DROP + CREATE (CREATE OR REPLACE no permite insertar columnas) → re-grant.
--
-- Clasificación de reglas (revisión adversarial Fable + decisión Martin
-- "desbloquear todo" 2026-07-21). La vista clasifica cada variante y n8n decide
-- determinísticamente (el LLM nunca ve reglas, solo el * del catálogo):
--   · tiene_override            → nunca mostrar número (el empleado pisa el precio)
--   · n_reglas_cantidad = 1     → tabla de rangos verbatim (rangos_cantidad) + caveat
--   · n_reglas_cantidad > 1     → ambiguo (precedencia del motor) → sin número
--   · sin reglas (mostrable)    → número limpio
--   · resto (discount/supercharge) → número de lista + caveat neutro
-- Los quantity_range del ruleset real son confirmation=false y REEMPLAZAN el
-- precio → la tabla verbatim es exactamente lo que cobra el mostrador.
-- solo_descuentos queda para telemetría (discount = signo negativo garantizado,
-- precio_lista es techo). Nota anotada (no accionar): un discount con value
-- negativo sumaría y el bool_and no lo detectaría — hoy no existe en el ruleset.
-- Backfill: default now() = asumimos que los precios vigentes hoy son válidos.
-- =============================================================================

-- --- 1. Columna de frescura (aditiva, el motor no la toca) -------------------
alter table public.product_variants
  add column if not exists price_updated_at timestamptz not null default now();

-- --- 2. Trigger: bump solo ante cambio real de precio ------------------------
create or replace function public.touch_variant_price_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.price_updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_variant_price_updated on public.product_variants;
create trigger trg_variant_price_updated
  before update on public.product_variants
  for each row
  when (old.price is distinct from new.price)
  execute function public.touch_variant_price_updated_at();

-- --- 3. Recrear bot.variantes con precio_actualizado -------------------------
drop view if exists bot.variantes;

create view bot.variantes as
with recursive cat_chain as (
  -- cada categoría + toda su cadena de ancestros (start_id = la categoría hoja)
  select id as start_id, id as node_id, parent_id from public.categories
  union all
  select cc.start_id, c.id, c.parent_id
  from cat_chain cc
  join public.categories c on c.id = cc.parent_id
)
select b.*, (not b.tiene_reglas) as mostrable
from (
  select
    v.id               as variante_id,
    v.product_id       as producto_id,
    v.name             as variante,
    v.color            as color,
    v.unit             as unidad,
    v.price            as precio_lista,
    v.price_updated_at as precio_actualizado,
    exists (
      select 1
      from public.pricing_rule_targets t
      join public.pricing_rules r on r.id = t.pricing_rule_id
      where r.is_active = true
        and (
              t.product_variant_id = v.id
           or t.product_id         = v.product_id
           or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = p.category_id)
        )
    ) as tiene_reglas,
    coalesce((
      select bool_and(r.rule_type = 'discount')
      from public.pricing_rule_targets t
      join public.pricing_rules r on r.id = t.pricing_rule_id
      where r.is_active = true
        and (
              t.product_variant_id = v.id
           or t.product_id         = v.product_id
           or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = p.category_id)
        )
    ), false) as solo_descuentos,
    exists (
      select 1
      from public.pricing_rule_targets t
      join public.pricing_rules r on r.id = t.pricing_rule_id
      where r.is_active = true
        and r.rule_type = 'override'
        and (
              t.product_variant_id = v.id
           or t.product_id         = v.product_id
           or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = p.category_id)
        )
    ) as tiene_override,
    (
      select count(*)::int
      from public.pricing_rule_targets t
      join public.pricing_rules r on r.id = t.pricing_rule_id
      where r.is_active = true
        and r.rule_type = 'quantity_range'
        and (
              t.product_variant_id = v.id
           or t.product_id         = v.product_id
           or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = p.category_id)
        )
    ) as n_reglas_cantidad,
    -- Solo confiable cuando n_reglas_cantidad = 1 (con >1 el motor resuelve
    -- precedencia de scope que acá no replicamos → n8n hace fallback).
    (
      select r.effect->'ranges'
      from public.pricing_rule_targets t
      join public.pricing_rules r on r.id = t.pricing_rule_id
      where r.is_active = true
        and r.rule_type = 'quantity_range'
        and (
              t.product_variant_id = v.id
           or t.product_id         = v.product_id
           or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = p.category_id)
        )
      limit 1
    ) as rangos_cantidad
  from public.product_variants v
  join public.products  p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  where v.is_active = true
    and p.is_active = true
    and c.audience  = 'publico'
) b;

-- --- Re-grant tras el DROP (condicional, mismo patrón que las demás) ---------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'bot_readonly') then
    grant select on bot.variantes to bot_readonly;
    raise notice 'Grant SELECT de bot.variantes re-otorgado a bot_readonly.';
  else
    raise notice 'Rol bot_readonly no existe: sin grants. Si n8n conecta como postgres/owner ya tiene acceso.';
  end if;
end $$;

-- =============================================================================
-- Sanity check (tras aplicar):
--   select variante, precio_lista, tiene_reglas, mostrable, solo_descuentos,
--          tiene_override, n_reglas_cantidad, rangos_cantidad, precio_actualizado
--   from bot.variantes limit 5;                       -- precio_actualizado ≈ now()
--   select count(*) filter (where mostrable),             -- esperado ~79
--          count(*) filter (where solo_descuentos),       -- esperado ~54
--          count(*) filter (where n_reglas_cantidad = 1), -- esperado ~25
--          count(*) filter (where n_reglas_cantidad > 1), -- esperado pocas (Carpetas a4)
--          count(*) filter (where tiene_override)         -- esperado ~2
--   from bot.variantes;
--   update public.product_variants set price = price + 1
--     where id = (select variante_id from bot.variantes where mostrable limit 1);
--   -- → esa fila debe mostrar precio_actualizado nuevo; revertir el +1 después.
-- =============================================================================
