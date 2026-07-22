-- =============================================================================
-- v7b — flag por_pack (clase plata I8 de suite-5: "$28.000 × 150 = $4.200.000")
-- =============================================================================
-- Preparada por Claude, APLICA MARTIN. Contraste Fable ronda 4 (plan §Ronda 4).
--
-- Problema real visto en suite-5: "necesito 150 tarjetas" resolvió a
-- "500 Tarjetas Color/Negro" (precio POR PACK de 500) y el cotizador multiplicó
-- precio-pack × 150 unidades. La semántica de pack es conocimiento de CATÁLOGO,
-- no inferencia runtime → flag curado `por_pack` en bot.producto_meta.
-- Regla en Armar (ya aplicada en faq-bot-v7.json): por_pack=true → la cantidad
-- del cliente JAMÁS multiplica ni elige bracket; se muestra el precio del pack
-- con su nombre completo (el nombre ya dice la cantidad) + nota de telemetría.
--
-- El seed marca CANDIDATOS por patrón de nombre (x-cantidad / millar / "NNN
-- <producto>") y lista cada uno en NOTICE: REVISÁ esa lista en el output — si
-- aparece algo que NO es pack, corregilo con un UPDATE ... set por_pack=false.
-- La pasada de curación visual después refina esto producto por producto.
--
-- Todo en UNA transacción. Idempotente. Después: re-importar faq-bot-v7.json
-- (el SELECT de Get Precio ahora pide v.por_pack) + TOGGLE.
-- =============================================================================

begin;

alter table bot.producto_meta
  add column if not exists por_pack boolean not null default false;

-- Vista: misma definición de cotizador-v7.sql + por_pack
drop view if exists bot.variantes;

create view bot.variantes as
with recursive cat_chain as (
  select id as start_id, id as node_id, parent_id from public.categories
  union all
  select cc.start_id, c.id, c.parent_id
  from cat_chain cc
  join public.categories c on c.id = cc.parent_id
)
select b.*, (not b.tiene_reglas) as mostrable
from (
  select
    v.id                                as variante_id,
    v.product_id                        as producto_id,
    coalesce(vm.display_variante, v.name) as variante,
    v.name                              as variante_origen,
    v.color                             as color,
    v.unit                              as unidad,
    v.price                             as precio_lista,
    v.price_updated_at                  as precio_actualizado,
    coalesce(pm.por_pagina, false)      as por_pagina,
    coalesce(pm.por_pack, false)        as por_pack,
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
  left join bot.variante_meta vm on vm.variante_id = v.id
  left join bot.producto_meta pm on pm.producto_id = p.id
  where v.is_active = true
    and p.is_active = true
    and c.audience  = 'publico'
    and not coalesce(vm.oculto, false)
    and not coalesce(pm.oculto, false)
) b;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'bot_readonly') then
    grant select on bot.variantes to bot_readonly;
    raise notice 'Grant SELECT de bot.variantes re-otorgado a bot_readonly.';
  else
    raise notice 'Rol bot_readonly no existe: sin grants (n8n como owner ya accede).';
  end if;
end $$;

-- Seed de CANDIDATOS por patrón de nombre. El patrón x-número excluye medidas
-- tipo "10x15" (la x de medida va pegada a un dígito ANTES; acá exigimos que
-- lo anterior NO sea dígito). Cada candidato sale en NOTICE para tu revisión.
do $$
declare
  rec record;
  n int := 0;
begin
  for rec in
    select p.id, p.name
    from public.products p
    where p.is_active
      and (
        p.name ~* '(^|[^0-9])x\s*[0-9]+'                                -- "Papel Vegetal a4 x10"
        or p.name ~* 'millar'                                           -- "Corte x Millar"
        or p.name ~* '\y[0-9]{2,4}\s+(tarjetas?|volantes?|folletos?|unidades|hojas)\y' -- "500 Tarjetas ..."
      )
  loop
    insert into bot.producto_meta (producto_id, sinonimos, por_pack, updated_at)
    values (rec.id, '{}'::text[], true, now())
    on conflict (producto_id) do update
      set por_pack = true, updated_at = now();
    n := n + 1;
    raise notice 'por_pack=true (candidato por nombre): %', rec.name;
  end loop;
  raise notice 'Total productos marcados por_pack: % — REVISAR la lista de arriba; si alguno NO es pack: update bot.producto_meta set por_pack=false where producto_id = ...', n;
end $$;

commit;

-- SANITY (post-commit)
select t.nombre_canonico, v.variante, v.precio_lista, v.por_pack
from bot.variantes v join bot.taxonomia t using (producto_id)
where v.por_pack
order by t.nombre_canonico;
