-- =============================================================================
-- v7 COTIZADOR — flag por_pagina + bot.variantes con la columna + seeds + checks
-- =============================================================================
-- Preparada por Claude, APLICA MARTIN (regla: yo preparo, vos aplicás).
-- Plan contrastado con Fable (2 rondas): plans/faq-bot-v7-cotizador.md
--
-- Qué hace:
--   1. Columna bot.producto_meta.por_pagina (boolean, default false): marca los
--      productos cuyo trabajo típico es UN documento multipágina. Es el backstop
--      determinístico para que `paginas`/`copias` del action precio SOLO
--      multipliquen donde tiene sentido ("mi banner tiene 6 paños" nunca da lona×6).
--   2. Recrea bot.variantes agregando por_pagina (DROP+CREATE + re-grant, mismo
--      patrón del overlay). El SELECT del nodo Get Precio también la pide → el
--      flow v7 se importa DESPUÉS de aplicar esto.
--   3. Seed conservador (sesgo a MENOS true: el falso negativo solo pierde el
--      total; el falso positivo multiplica cualquier cosa): impresiones 75,
--      106 gr, a3 tonner, módulos medicina. Anillado/encuadernado/plastificado
--      quedan false A PROPÓSITO ("anillar un apunte de 120 páginas" NO es 120
--      anillados). Candidatos diferidos (obra 80, gemelo Riso del 106): entran
--      cuando TG aclare (preguntas-tg.md ítems 6 y 12).
--   4. QUERY DE VERIFICACIÓN (al final, solo SELECT): variantes cuya tabla de
--      cantidad coexiste con reglas que NO son descuento → la tabla verbatim (y
--      cualquier total) podría mentir para abajo. Revisar CADA fila antes de
--      habilitar totales. Si devuelve 0 filas, verde.
--
-- Todo en UNA transacción. Idempotente (re-ejecutable).
-- Después de aplicar: importar faq-bot-v7.json + creds + TOGGLE (cache).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. DDL aditivo
-- ---------------------------------------------------------------------------
alter table bot.producto_meta
  add column if not exists por_pagina boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. bot.variantes con por_pagina (definición del overlay + UNA columna)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. Seed por clave natural (STRICT: 0 o 2+ filas = error, nada se aplica)
-- ---------------------------------------------------------------------------
do $$
declare
  p75 uuid; p106 uuid; ptonner uuid; pmed uuid;
  n int;
begin
  select id into strict p75     from public.products where is_active
    and translate(lower(name), 'áéíóúñ', 'aeioun') = 'impresiones';
  select id into strict p106    from public.products where is_active
    and translate(lower(name), 'áéíóúñ', 'aeioun') = 'impresion a4 papel obra de 106 gr';
  select id into strict ptonner from public.products where is_active
    and translate(lower(name), 'áéíóúñ', 'aeioun') = 'impresiones a3 tonner negro';
  select id into strict pmed    from public.products where is_active
    and translate(lower(name), 'áéíóúñ', 'aeioun') = 'impresion de modulos/apuntes medicina';

  -- upsert: no pisa nada de la curación existente; solo enciende el flag
  insert into bot.producto_meta (producto_id, sinonimos, por_pagina, updated_at)
  select pid, '{}'::text[], true, now()
  from unnest(array[p75, p106, ptonner, pmed]) as u(pid)
  on conflict (producto_id) do update
    set por_pagina = true, updated_at = now();

  select count(*) into n from bot.producto_meta where por_pagina;
  if n <> 4 then
    raise exception 'ASSERT por_pagina: esperaba 4 productos true, hay % — NO aplicar', n;
  end if;
  raise notice 'por_pagina=true en 4 productos (impresiones 75 / 106 gr / a3 tonner / medicina).';
end $$;

commit;

-- ---------------------------------------------------------------------------
-- SANITY (correr después del commit; solo SELECT)
-- ---------------------------------------------------------------------------

-- a) La columna llegó a la vista y el conteo cierra (esperado: 4 productos true;
--    las variantes true son las de esos 4 productos)
select por_pagina, count(*) as variantes, count(distinct producto_id) as productos
from bot.variantes group by por_pagina order by por_pagina;

-- b) QUERY DE VERIFICACIÓN PRE-TOTALES (hazard Fable r1): variantes que tienen
--    regla de cantidad Y ADEMÁS un RECARGO (supercharge) alcanzándolas por
--    variante, producto o cadena de categorías. Para ellas la tabla verbatim (y
--    cualquier total calculado de ella) puede quedar POR DEBAJO de lo que cobra
--    el mostrador. OJO: una variante cuya única regla es la tabla es NORMAL (las
--    ~25 de siempre) — acá solo salen las que además tienen recargo.
--    Esperado: 0 filas. Si aparece alguna → revisarla contra el ruleset antes de
--    correr la ronda de totales, y anotar en preguntas-tg si hace falta.
with recursive cat_chain as (
  select id as start_id, id as node_id, parent_id from public.categories
  union all
  select cc.start_id, c.id, c.parent_id
  from cat_chain cc
  join public.categories c on c.id = cc.parent_id
)
select t.nombre_canonico, v.variante, v.n_reglas_cantidad, v.precio_lista,
       r.name as regla_recargo, r.rule_type
from bot.variantes v
join bot.taxonomia t using (producto_id)
join public.products p on p.id = v.producto_id
join public.pricing_rule_targets tg
  on (tg.product_variant_id = v.variante_id
   or tg.product_id         = v.producto_id
   or tg.category_id in (select cc.node_id from cat_chain cc where cc.start_id = p.category_id))
join public.pricing_rules r on r.id = tg.pricing_rule_id
where v.n_reglas_cantidad >= 1
  and r.is_active
  and r.rule_type = 'supercharge'
order by t.nombre_canonico, v.variante;
