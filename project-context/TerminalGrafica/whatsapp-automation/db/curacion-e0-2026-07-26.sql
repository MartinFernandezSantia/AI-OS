-- ============================================================================
-- Curación E0 — ATOMIZACIÓN del catálogo (2026-07-26)
--
-- Convierte en columnas lo que hoy se parsea del nombre en cada mensaje:
-- familias, y los atributos que un nodo determinístico necesita COMPARAR o
-- CALCULAR (unidad de venta, gramaje, faz, tamaño, medida, tecnología…).
-- Spec: plans/e0-atomizacion-catalogo.md · aprobado por Martin 2026-07-26.
--
-- ALCANCE
--   · 83 productos visibles + 139 variantes con atributos.
--   · 21 claves de atributo. Ausente = no aplica. null = aplica pero NO SE SABE
--     (y es información: le dice al bot qué preguntar). No se inventa nada.
--   · Unidades de venta = db/unidades-venta-decisiones.json, verificado fila por
--     fila (75 decididas + 24 confirmadas por omisión, 0 discrepancias).
--   · UN solo cambio de flag en toda la migración: por_pack en Talonarios.
--
-- QUÉ NO TOCA
--   · public.* — intacto.
--   · display_name, sinonimos, casos_de_uso, oculto, por_pagina — NO se pisan.
--     El upsert de producto_meta solo escribe familias, atributos y updated_at.
--   · Los 5 productos ocultos (anillados 48/72/96 hs, papel vegetal x10 ×2)
--     quedan sin atributos a propósito: sin atributos → fuera de los guards y
--     nunca reciben un total calculado (spec §8).
--
-- Resolución por CLAVE NATURAL (nombre+rubro normalizados), nunca uuids:
-- replayable en prod tal cual. 0 filas o 2+ filas → NOTICE 'SKIPPED' y sigue.
-- Transaccional. Después de aplicar: GET /webhook/refrescar-catalogo.
--
-- ⚠️ Este archivo recrea bot.variantes (DROP+CREATE, patrón de cotizador-v7b).
--    Esa vista es la que el bot lee en vivo: durante la transacción las consultas
--    del bot esperan el lock. Son milisegundos, pero no lo apliques en medio de
--    una conversación real.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Esquema
-- ---------------------------------------------------------------------------
alter table bot.producto_meta
  add column if not exists familias  text[] not null default '{}',
  add column if not exists atributos jsonb  not null default '{}';

alter table bot.variante_meta
  add column if not exists atributos jsonb  not null default '{}';

-- v8: el compositor redacta el mensaje que ve el cliente a partir de un borrador
-- determinístico. Se guardan los DOS. Sin esto, el juez offline del confident-wrong
-- estaría auditando un texto que el cliente nunca vio, y el drift semántico
-- (re-etiquetar un unitario como total, borrar una línea de degradación) es
-- estructuralmente indetectable.
alter table bot.decisiones
  add column if not exists borrador text,
  add column if not exists final    text;

-- v8.1 (consejo Opus 2026-07-26): la señal del confident-wrong.
-- Hoy el log guarda el nombre CANÓNICO de la base, así que en el camino de ÉXITO el
-- string crudo que tipeó el LLM se destruye — y con él la única forma de distinguir
-- un hijack de sinónimo de una elección deliberada. La clase de fallo que más plata
-- mueve era indetectable desde el log, por construcción.
-- Una sola columna jsonb en vez de seis: un alter, y las auditorías salen con
-- senales->>'...'. Claves: producto_pedido, variante_pedida, match_rank, descartados
-- (los candidatos que el filtro de rank borró), filas, anclados, sin_anclar, puerta.
alter table bot.decisiones
  add column if not exists senales jsonb;

-- Índice parcial para la consulta de auditoría (§5 del runbook): las cotizaciones
-- que salieron con un número sin que el cliente anclara ningún eje.
create index if not exists decisiones_sin_ancla_idx
  on bot.decisiones ((senales->>'puerta'))
  where senales is not null;

-- ---------------------------------------------------------------------------
-- 2. Vistas: exponer familias y atributos.
--    Sin esto la migración es INERTE (ningún nodo puede leer las columnas).
--
--    bot.taxonomia  → familias + atributos del PRODUCTO (create or replace:
--                     solo agrega columnas al final, no cambia las existentes).
--    bot.variantes  → familias + atributos EFECTIVOS ya resueltos:
--                       coalesce(producto) || coalesce(variante)
--                     El '||' de jsonb es merge shallow con el operando derecho
--                     ganando, o sea EXACTAMENTE la regla "atributo efectivo =
--                     el de la variante si existe, si no el del producto".
--                     Va en la vista y no en cada Code node para que sea
--                     imposible olvidársela.
-- ---------------------------------------------------------------------------
create or replace view bot.taxonomia as
select
  p.id                                  as producto_id,
  coalesce(m.display_name, p.name)      as nombre_canonico,
  coalesce(rm.display_name, c.name)     as categoria,
  coalesce(rmp.display_name, cpar.name) as categoria_padre,
  coalesce(m.sinonimos, '{}')
    || case
         when m.display_name is not null
          and m.display_name <> p.name
          and coalesce(m.auto_sinonimo, true)
          and not exists (
                select 1 from unnest(coalesce(m.sinonimos, '{}')) s
                where translate(lower(s), 'áéíóúñ', 'aeioun')
                    = translate(lower(p.name), 'áéíóúñ', 'aeioun'))
         then array[p.name]
         else '{}'::text[]
       end                              as sinonimos,
  coalesce(m.casos_de_uso, '{}')        as casos_de_uso,
  coalesce(m.familias, '{}')            as familias,
  coalesce(m.atributos, '{}'::jsonb)    as atributos
from public.products p
join public.categories c          on c.id = p.category_id
left join public.categories cpar  on cpar.id = c.parent_id
left join bot.producto_meta m     on m.producto_id = p.id
left join bot.rubro_meta rm       on rm.categoria_id = c.id
left join bot.rubro_meta rmp      on rmp.categoria_id = cpar.id
where p.is_active = true
  and c.audience = 'publico'
  and not coalesce(m.oculto, false);

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
    coalesce(pm.familias, '{}')         as familias,
    coalesce(pm.atributos, '{}'::jsonb)
      || coalesce(vm.atributos, '{}'::jsonb) as atributos,
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
    grant select on bot.taxonomia to bot_readonly;
    grant select on bot.variantes to bot_readonly;
    raise notice 'Grants de bot.taxonomia y bot.variantes re-otorgados a bot_readonly.';
  else
    raise notice 'Rol bot_readonly no existe: sin grants (n8n como owner ya accede).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Familias y atributos — 83 productos, por clave natural
-- ---------------------------------------------------------------------------

-- ═══ familia impresion (18) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'impresiones'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones inkjet/ricoh/riso/epson';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'IMPRESIONES', 'Impresiones Inkjet/Ricoh/Riso/Epson';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'IMPRESIONES', 'Impresiones Inkjet/Ricoh/Riso/Epson';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion']::text[], '{"tecnologia":"riso","papel":"obra","gramaje_gr":75,"unidad_venta":"hoja","multiplica":true,"default_familia":true}'::jsonb, 'IMPRESIONES', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: OBRA 75 GR S/F (color=false)
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'obra 75 gr s/f'
      and v.color is not distinct from 'false';
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'IMPRESIONES', 'OBRA 75 GR S/F';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'IMPRESIONES', 'OBRA 75 GR S/F';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"simple","color":"bn","default_variante":true}'::jsonb, 'OBRA 75 GR S/F', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: OBRA 75 GR S/F (color=true)
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'obra 75 gr s/f'
      and v.color is not distinct from 'true';
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'IMPRESIONES', 'OBRA 75 GR S/F';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'IMPRESIONES', 'OBRA 75 GR S/F';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"simple","color":"color"}'::jsonb, 'OBRA 75 GR S/F', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: OBRA 75 GR D/F (color=false)
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'obra 75 gr d/f'
      and v.color is not distinct from 'false';
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'IMPRESIONES', 'OBRA 75 GR D/F';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'IMPRESIONES', 'OBRA 75 GR D/F';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"doble","color":"bn"}'::jsonb, 'OBRA 75 GR D/F', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: OBRA 75 GR D/F (color=true)
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'obra 75 gr d/f'
      and v.color is not distinct from 'true';
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'IMPRESIONES', 'OBRA 75 GR D/F';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'IMPRESIONES', 'OBRA 75 GR D/F';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"doble","color":"color"}'::jsonb, 'OBRA 75 GR D/F', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'impresion a4 papel obra de 106 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones inkjet/ricoh/riso/epson';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Impresión a4 Papel obra de 106 gr', 'Impresiones Inkjet/Ricoh/Riso/Epson';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Impresión a4 Papel obra de 106 gr', 'Impresiones Inkjet/Ricoh/Riso/Epson';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion']::text[], '{"tecnologia":"riso","papel":"obra","gramaje_gr":106,"tamano":["a4"],"unidad_venta":"hoja","multiplica":true}'::jsonb, 'Impresión a4 Papel obra de 106 gr', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: S/F (color=false)
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 's/f'
      and v.color is not distinct from 'false';
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Impresión a4 Papel obra de 106 gr', 'S/F';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Impresión a4 Papel obra de 106 gr', 'S/F';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"simple","color":"bn"}'::jsonb, 'S/F', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: S/F (color=true)
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 's/f'
      and v.color is not distinct from 'true';
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Impresión a4 Papel obra de 106 gr', 'S/F';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Impresión a4 Papel obra de 106 gr', 'S/F';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"simple","color":"color"}'::jsonb, 'S/F', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: D/F (color=false)
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'd/f'
      and v.color is not distinct from 'false';
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Impresión a4 Papel obra de 106 gr', 'D/F';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Impresión a4 Papel obra de 106 gr', 'D/F';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"doble","color":"bn"}'::jsonb, 'D/F', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: D/F (color=true)
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'd/f'
      and v.color is not distinct from 'true';
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Impresión a4 Papel obra de 106 gr', 'D/F';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Impresión a4 Papel obra de 106 gr', 'D/F';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"doble","color":"color"}'::jsonb, 'D/F', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'impresiones a3 tonner negro'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones a3 negro tonner';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Impresiones a3 tonner negro', 'Impresiones a3 Negro Tonner';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Impresiones a3 tonner negro', 'Impresiones a3 Negro Tonner';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion']::text[], '{"tecnologia":"tonner","papel":null,"gramaje_gr":null,"tamano":["a3"],"color":"bn","unidad_venta":"pagina","multiplica":true}'::jsonb, 'Impresiones a3 tonner negro', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'impresion de modulos/apuntes medicina'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresion medicina (precio especial)';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Impresión de Módulos/Apuntes medicina', 'Impresión Medicina (Precio Especial)';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Impresión de Módulos/Apuntes medicina', 'Impresión Medicina (Precio Especial)';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion']::text[], '{"tecnologia":"riso","nicho":"medicina","unidad_venta":"pagina","multiplica":true}'::jsonb, 'Impresión de Módulos/Apuntes medicina', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'obra 80 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones laser color';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'OBRA 80 GR', 'Impresiones laser color';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'OBRA 80 GR', 'Impresiones laser color';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion']::text[], '{"tecnologia":"laser","papel":"obra","gramaje_gr":80,"color":"color","unidad_venta":"hoja","multiplica":true,"tamano":["a3","a3+","a4","oficio"]}'::jsonb, 'OBRA 80 GR', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'OBRA 80 GR', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'OBRA 80 GR', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"]}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A3+
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3+'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'OBRA 80 GR', 'A3+';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'OBRA 80 GR', 'A3+';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3+"]}'::jsonb, 'A3+', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'OBRA 80 GR', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'OBRA 80 GR', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'A4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: OFICIO
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'OBRA 80 GR', 'OFICIO';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'OBRA 80 GR', 'OFICIO';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'OFICIO', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Oficio
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'OBRA 80 GR', 'Oficio';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'OBRA 80 GR', 'Oficio';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'Oficio', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'obra 106 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones laser color';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'OBRA 106 GR', 'Impresiones laser color';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'OBRA 106 GR', 'Impresiones laser color';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion']::text[], '{"tecnologia":"laser","papel":"obra","gramaje_gr":106,"color":"color","unidad_venta":"hoja","multiplica":true,"tamano":["a3","a3+","a4","oficio"]}'::jsonb, 'OBRA 106 GR', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'OBRA 106 GR', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'OBRA 106 GR', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"]}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A3+
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3+'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'OBRA 106 GR', 'A3+';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'OBRA 106 GR', 'A3+';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3+"]}'::jsonb, 'A3+', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'OBRA 106 GR', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'OBRA 106 GR', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'A4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: OFICIO
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'OBRA 106 GR', 'OFICIO';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'OBRA 106 GR', 'OFICIO';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'OFICIO', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Oficio
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'OBRA 106 GR', 'Oficio';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'OBRA 106 GR', 'Oficio';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'Oficio', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'ilustracion brillo 150 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones laser color';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Ilustración Brillo 150 gr', 'Impresiones laser color';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Ilustración Brillo 150 gr', 'Impresiones laser color';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion']::text[], '{"tecnologia":"laser","papel":"ilustracion","gramaje_gr":150,"acabado":"brillo","color":"color","unidad_venta":"hoja","multiplica":true,"tamano":["a3","a3+","a4","oficio"]}'::jsonb, 'Ilustración Brillo 150 gr', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Brillo 150 gr', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Brillo 150 gr', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"]}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A3+
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3+'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Brillo 150 gr', 'A3+';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Brillo 150 gr', 'A3+';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3+"]}'::jsonb, 'A3+', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Brillo 150 gr', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Brillo 150 gr', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'A4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: OFICIO
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Brillo 150 gr', 'OFICIO';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Brillo 150 gr', 'OFICIO';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'OFICIO', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Oficio
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Brillo 150 gr', 'Oficio';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Brillo 150 gr', 'Oficio';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'Oficio', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'ilustracion mate 250 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones laser color';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Ilustración Mate 250 gr', 'Impresiones laser color';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Ilustración Mate 250 gr', 'Impresiones laser color';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion']::text[], '{"tecnologia":"laser","papel":"ilustracion","gramaje_gr":250,"acabado":"mate","color":"color","unidad_venta":"hoja","multiplica":true,"tamano":["a3","a3+","a4","oficio"]}'::jsonb, 'Ilustración Mate 250 gr', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Mate 250 gr', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Mate 250 gr', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"]}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A3+
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3+'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Mate 250 gr', 'A3+';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Mate 250 gr', 'A3+';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3+"]}'::jsonb, 'A3+', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Mate 250 gr', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Mate 250 gr', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'A4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: OFICIO
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Mate 250 gr', 'OFICIO';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Mate 250 gr', 'OFICIO';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'OFICIO', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Oficio
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Mate 250 gr', 'Oficio';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Mate 250 gr', 'Oficio';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'Oficio', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Troquelado
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'troquelado'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Mate 250 gr', 'Troquelado';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Mate 250 gr', 'Troquelado';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"acabado":"troquelado"}'::jsonb, 'Troquelado', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'ilustracion mate 300 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones laser color';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Ilustración Mate 300 gr', 'Impresiones laser color';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Ilustración Mate 300 gr', 'Impresiones laser color';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion']::text[], '{"tecnologia":"laser","papel":"ilustracion","gramaje_gr":300,"acabado":"mate","color":"color","unidad_venta":"hoja","multiplica":true,"tamano":["a3","a3+","a4","oficio"]}'::jsonb, 'Ilustración Mate 300 gr', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Mate 300 gr', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Mate 300 gr', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"]}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A3+
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3+'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Mate 300 gr', 'A3+';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Mate 300 gr', 'A3+';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3+"]}'::jsonb, 'A3+', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Mate 300 gr', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Mate 300 gr', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'A4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: OFICIO
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Mate 300 gr', 'OFICIO';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Mate 300 gr', 'OFICIO';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'OFICIO', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Oficio
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Ilustración Mate 300 gr', 'Oficio';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Ilustración Mate 300 gr', 'Oficio';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'Oficio', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'opalina obra 250 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones laser color';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Opalina Obra 250 gr', 'Impresiones laser color';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Opalina Obra 250 gr', 'Impresiones laser color';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion']::text[], '{"tecnologia":"laser","papel":"opalina","gramaje_gr":250,"color":"color","unidad_venta":"hoja","multiplica":true,"tamano":["a3","a3+","a4","oficio"]}'::jsonb, 'Opalina Obra 250 gr', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Opalina Obra 250 gr', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Opalina Obra 250 gr', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"]}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A3+
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3+'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Opalina Obra 250 gr', 'A3+';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Opalina Obra 250 gr', 'A3+';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3+"]}'::jsonb, 'A3+', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Opalina Obra 250 gr', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Opalina Obra 250 gr', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'A4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: OFICIO
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Opalina Obra 250 gr', 'OFICIO';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Opalina Obra 250 gr', 'OFICIO';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'OFICIO', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Oficio
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Opalina Obra 250 gr', 'Oficio';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Opalina Obra 250 gr', 'Oficio';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'Oficio', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'a5 ilust. mate 250 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'laser';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'A5 ILUST. MATE 250 GR', 'LASER';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'A5 ILUST. MATE 250 GR', 'LASER';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion']::text[], '{"tecnologia":"laser","papel":"ilustracion","gramaje_gr":250,"acabado":"mate","tamano":["a5"],"unidad_venta":"hoja","multiplica":true}'::jsonb, 'A5 ILUST. MATE 250 GR', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'impresion uv holografico / glitter'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresion uv';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Impresión Uv Holografico / Glitter', 'Impresión Uv';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Impresión Uv Holografico / Glitter', 'Impresión Uv';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion','lonas_vinilos']::text[], '{"tecnologia":"uv","unidad_venta":"m2","multiplica":true}'::jsonb, 'Impresión Uv Holografico / Glitter', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'opp brillo'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'soportes especiales';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'OPP Brillo', 'Soportes Especiales';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'OPP Brillo', 'Soportes Especiales';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion','papeles']::text[], '{"tecnologia":"laser","papel":"opp","acabado":"brillo","unidad_venta":"hoja","multiplica":true}'::jsonb, 'OPP Brillo', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'opp mate/holografico/plata/crystal/glitter/kraft'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'soportes especiales';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'OPP Mate/Holografico/Plata/Crystal/Glitter/Kraft', 'Soportes Especiales';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'OPP Mate/Holografico/Plata/Crystal/Glitter/Kraft', 'Soportes Especiales';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion','papeles']::text[], '{"tecnologia":"laser","papel":"opp","acabado":["mate","holografico","plata","cristal","glitter","kraft"],"unidad_venta":"hoja","multiplica":true}'::jsonb, 'OPP Mate/Holografico/Plata/Crystal/Glitter/Kraft', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'papel autoadhesivo brillo / split'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'soportes especiales';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Papel Autoadhesivo Brillo / Split', 'Soportes Especiales';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Papel Autoadhesivo Brillo / Split', 'Soportes Especiales';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion','papeles']::text[], '{"tecnologia":"laser","papel":"autoadhesivo","acabado":"brillo","unidad_venta":"hoja","multiplica":true,"tamano":["a3","a4"]}'::jsonb, 'Papel Autoadhesivo Brillo / Split', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel Autoadhesivo Brillo / Split', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel Autoadhesivo Brillo / Split', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"]}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel Autoadhesivo Brillo / Split', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel Autoadhesivo Brillo / Split', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'A4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Medio Corte (Troquelado)
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'medio corte (troquelado)'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel Autoadhesivo Brillo / Split', 'Medio Corte (Troquelado)';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel Autoadhesivo Brillo / Split', 'Medio Corte (Troquelado)';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"acabado":"troquelado"}'::jsonb, 'Medio Corte (Troquelado)', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'papel kraft 130 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'soportes especiales';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Papel Kraft 130 Gr', 'Soportes Especiales';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Papel Kraft 130 Gr', 'Soportes Especiales';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion','papeles']::text[], '{"tecnologia":"laser","papel":"kraft","gramaje_gr":130,"unidad_venta":"hoja","multiplica":true,"tamano":["a3","a4"]}'::jsonb, 'Papel Kraft 130 Gr', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel Kraft 130 Gr', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel Kraft 130 Gr', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"]}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel Kraft 130 Gr', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel Kraft 130 Gr', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'A4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'papel kraft 300 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'soportes especiales';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Papel Kraft 300 Gr', 'Soportes Especiales';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Papel Kraft 300 Gr', 'Soportes Especiales';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion','papeles']::text[], '{"tecnologia":"laser","papel":"kraft","gramaje_gr":300,"unidad_venta":"hoja","multiplica":true,"tamano":["a3","a4"]}'::jsonb, 'Papel Kraft 300 Gr', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel Kraft 300 Gr', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel Kraft 300 Gr', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"]}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel Kraft 300 Gr', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel Kraft 300 Gr', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'A4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'vegetal'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'soportes especiales';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Vegetal', 'Soportes Especiales';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Vegetal', 'Soportes Especiales';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['impresion','papeles']::text[], '{"tecnologia":"laser","papel":"vegetal","unidad_venta":"hoja","multiplica":true,"tamano":["a3","a4","oficio"]}'::jsonb, 'Vegetal', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: A4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Vegetal', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Vegetal', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'A4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: OFICIO / a3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio / a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Vegetal', 'OFICIO / a3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Vegetal', 'OFICIO / a3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio","a3"]}'::jsonb, 'OFICIO / a3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;

-- ═══ familia lonas_vinilos (8) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'lona front brillo'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'solvente';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Lona Front Brillo', 'Solvente';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Lona Front Brillo', 'Solvente';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['lonas_vinilos']::text[], '{"tecnologia":"solvente","material":"lona","acabado":"brillo","ancho_max":{"valor":1.52,"unidad":"m"},"unidad_venta":"m2","multiplica":true}'::jsonb, 'Lona Front Brillo', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'lona mate'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'solvente';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Lona Mate', 'Solvente';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Lona Mate', 'Solvente';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['lonas_vinilos']::text[], '{"tecnologia":"solvente","material":"lona","acabado":"mate","unidad_venta":"m2","multiplica":true}'::jsonb, 'Lona Mate', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'lona back light'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'solvente';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Lona Back Light', 'Solvente';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Lona Back Light', 'Solvente';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['lonas_vinilos']::text[], '{"tecnologia":"solvente","material":"lona","acabado":"backlight","unidad_venta":"m2","multiplica":true}'::jsonb, 'Lona Back Light', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'microperforado'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'solvente';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Microperforado', 'Solvente';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Microperforado', 'Solvente';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['lonas_vinilos']::text[], '{"tecnologia":"solvente","material":"microperforado","unidad_venta":"m2","multiplica":true}'::jsonb, 'Microperforado', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'vinilo brillo satinado'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'solvente';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Vinilo Brillo Satinado', 'Solvente';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Vinilo Brillo Satinado', 'Solvente';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['lonas_vinilos']::text[], '{"tecnologia":"solvente","material":"vinilo","acabado":"brillo","ancho_max":{"valor":1.48,"unidad":"m"},"unidad_venta":"m2","multiplica":true}'::jsonb, 'Vinilo Brillo Satinado', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'vinilo mate'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'solvente';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Vinilo Mate', 'Solvente';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Vinilo Mate', 'Solvente';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['lonas_vinilos']::text[], '{"tecnologia":"solvente","material":"vinilo","acabado":"mate","unidad_venta":"m2","multiplica":true}'::jsonb, 'Vinilo Mate', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'vinilo cristal'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'solvente';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Vinilo Cristal', 'Solvente';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Vinilo Cristal', 'Solvente';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['lonas_vinilos']::text[], '{"tecnologia":"solvente","material":"vinilo","acabado":"cristal","unidad_venta":"m2","multiplica":true}'::jsonb, 'Vinilo Cristal', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'vinilo, lona brillo/mate uv'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresion ultra violeta';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Vinilo, Lona Brillo/Mate Uv', 'Impresion Ultra Violeta';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Vinilo, Lona Brillo/Mate Uv', 'Impresion Ultra Violeta';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['lonas_vinilos']::text[], '{"tecnologia":"uv","material":"vinilo","acabado":["brillo","mate"],"unidad_venta":"metro","multiplica":false}'::jsonb, 'Vinilo, Lona Brillo/Mate Uv', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ═══ familia carteleria (6) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'impresion exterior / montado sobre plastico corrugado'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'carteleria en plastico corrugado';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Impresión exterior / montado sobre plástico corrugado', 'Carteleria en plástico corrugado';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Impresión exterior / montado sobre plástico corrugado', 'Carteleria en plástico corrugado';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['carteleria']::text[], '{"material":"plastico_corrugado","unidad_venta":"unidad","multiplica":true,"tamano":["a3"]}'::jsonb, 'Impresión exterior / montado sobre plástico corrugado', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: 1 x 0.65 mt
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '1 x 0.65 mt'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Impresión exterior / montado sobre plástico corrugado', '1 x 0.65 mt';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Impresión exterior / montado sobre plástico corrugado', '1 x 0.65 mt';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":100,"alto":65,"unidad":"cm"}}'::jsonb, '1 x 0.65 mt', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 1 x 1 mt
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '1 x 1 mt'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Impresión exterior / montado sobre plástico corrugado', '1 x 1 mt';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Impresión exterior / montado sobre plástico corrugado', '1 x 1 mt';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":100,"alto":100,"unidad":"cm"}}'::jsonb, '1 x 1 mt', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 2 x 1 mt
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '2 x 1 mt'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Impresión exterior / montado sobre plástico corrugado', '2 x 1 mt';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Impresión exterior / montado sobre plástico corrugado', '2 x 1 mt';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":200,"alto":100,"unidad":"cm"}}'::jsonb, '2 x 1 mt', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: a3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Impresión exterior / montado sobre plástico corrugado', 'a3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Impresión exterior / montado sobre plástico corrugado', 'a3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"],"medida":{"ancho":29.7,"alto":42,"unidad":"cm"}}'::jsonb, 'a3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'promocion inmobiliarias 6 carteles 1 x 0.65 mt'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'carteleria en plastico corrugado';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Promocion Inmobiliarias 6 carteles 1 x 0.65 mt', 'Carteleria en plástico corrugado';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Promocion Inmobiliarias 6 carteles 1 x 0.65 mt', 'Carteleria en plástico corrugado';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['carteleria']::text[], '{"material":"plastico_corrugado","nicho":"inmobiliarias","min_unidades":6,"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Promocion Inmobiliarias 6 carteles 1 x 0.65 mt', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: Promoción cartel plástico corrugado 1x0.65 mt
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'promocion cartel plastico corrugado 1x0.65 mt'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Promocion Inmobiliarias 6 carteles 1 x 0.65 mt', 'Promoción cartel plástico corrugado 1x0.65 mt';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Promocion Inmobiliarias 6 carteles 1 x 0.65 mt', 'Promoción cartel plástico corrugado 1x0.65 mt';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":100,"alto":65,"unidad":"cm"}}'::jsonb, 'Promoción cartel plástico corrugado 1x0.65 mt', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'carteleria en pvc c/ papel obra/130 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'carteleria en pvc';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Carteleria en Pvc c/ Papel obra/130 gr', 'Carteleria en Pvc';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Carteleria en Pvc c/ Papel obra/130 gr', 'Carteleria en Pvc';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['carteleria']::text[], '{"material":"pvc","impreso_en":"papel_obra","papel":"obra","gramaje_gr":130,"unidad_venta":"unidad","multiplica":true,"tamano":["a3"]}'::jsonb, 'Carteleria en Pvc c/ Papel obra/130 gr', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: 100X 70 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '100x 70 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Carteleria en Pvc c/ Papel obra/130 gr', '100X 70 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Carteleria en Pvc c/ Papel obra/130 gr', '100X 70 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":100,"alto":70,"unidad":"cm"}}'::jsonb, '100X 70 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 35X50 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '35x50 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Carteleria en Pvc c/ Papel obra/130 gr', '35X50 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Carteleria en Pvc c/ Papel obra/130 gr', '35X50 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":35,"alto":50,"unidad":"cm"}}'::jsonb, '35X50 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 50X70 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '50x70 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Carteleria en Pvc c/ Papel obra/130 gr', '50X70 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Carteleria en Pvc c/ Papel obra/130 gr', '50X70 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":50,"alto":70,"unidad":"cm"}}'::jsonb, '50X70 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 60X90 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '60x90 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Carteleria en Pvc c/ Papel obra/130 gr', '60X90 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Carteleria en Pvc c/ Papel obra/130 gr', '60X90 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":60,"alto":90,"unidad":"cm"}}'::jsonb, '60X90 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Carteleria en Pvc c/ Papel obra/130 gr', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Carteleria en Pvc c/ Papel obra/130 gr', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"],"medida":{"ancho":29.7,"alto":42,"unidad":"cm"}}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: m2
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'm2'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Carteleria en Pvc c/ Papel obra/130 gr', 'm2';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Carteleria en Pvc c/ Papel obra/130 gr', 'm2';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"unidad_venta":"m2","multiplica":true}'::jsonb, 'm2', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'carteleria en pvc c/vinilo brillo/mate'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'carteleria en pvc';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Carteleria en Pvc c/vinilo brillo/mate', 'Carteleria en Pvc';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Carteleria en Pvc c/vinilo brillo/mate', 'Carteleria en Pvc';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['carteleria','lonas_vinilos']::text[], '{"material":"pvc","impreso_en":"vinilo","acabado":["brillo","mate"],"unidad_venta":"unidad","multiplica":true,"tamano":["a3"]}'::jsonb, 'Carteleria en Pvc c/vinilo brillo/mate', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: 100X 70 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '100x 70 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Carteleria en Pvc c/vinilo brillo/mate', '100X 70 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Carteleria en Pvc c/vinilo brillo/mate', '100X 70 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":100,"alto":70,"unidad":"cm"}}'::jsonb, '100X 70 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 35X50 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '35x50 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Carteleria en Pvc c/vinilo brillo/mate', '35X50 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Carteleria en Pvc c/vinilo brillo/mate', '35X50 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":35,"alto":50,"unidad":"cm"}}'::jsonb, '35X50 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 50X70 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '50x70 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Carteleria en Pvc c/vinilo brillo/mate', '50X70 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Carteleria en Pvc c/vinilo brillo/mate', '50X70 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":50,"alto":70,"unidad":"cm"}}'::jsonb, '50X70 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 60X90 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '60x90 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Carteleria en Pvc c/vinilo brillo/mate', '60X90 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Carteleria en Pvc c/vinilo brillo/mate', '60X90 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":60,"alto":90,"unidad":"cm"}}'::jsonb, '60X90 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Carteleria en Pvc c/vinilo brillo/mate', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Carteleria en Pvc c/vinilo brillo/mate', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"],"medida":{"ancho":29.7,"alto":42,"unidad":"cm"}}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: m2
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'm2'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Carteleria en Pvc c/vinilo brillo/mate', 'm2';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Carteleria en Pvc c/vinilo brillo/mate', 'm2';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"unidad_venta":"m2","multiplica":true}'::jsonb, 'm2', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'carton'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'cartones';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Cartón', 'Cartones';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Cartón', 'Cartones';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['carteleria']::text[], '{"material":"carton","papel":"carton","servicio":false,"unidad_venta":"unidad","multiplica":true,"tamano":["a3"]}'::jsonb, 'Cartón', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: 100X 70 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '100x 70 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Cartón', '100X 70 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Cartón', '100X 70 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":100,"alto":70,"unidad":"cm"}}'::jsonb, '100X 70 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 35X50 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '35x50 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Cartón', '35X50 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Cartón', '35X50 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":35,"alto":50,"unidad":"cm"}}'::jsonb, '35X50 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 50X70 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '50x70 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Cartón', '50X70 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Cartón', '50X70 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":50,"alto":70,"unidad":"cm"}}'::jsonb, '50X70 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 60X90 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '60x90 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Cartón', '60X90 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Cartón', '60X90 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":60,"alto":90,"unidad":"cm"}}'::jsonb, '60X90 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Cartón', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Cartón', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"],"medida":{"ancho":29.7,"alto":42,"unidad":"cm"}}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'montado sobre carton'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'encartonado';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Montado sobre carton', 'Encartonado';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Montado sobre carton', 'Encartonado';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['carteleria']::text[], '{"material":"carton","papel":"carton","servicio":true,"unidad_venta":"unidad","multiplica":true,"tamano":["a3"]}'::jsonb, 'Montado sobre carton', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: 100X 70 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '100x 70 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Montado sobre carton', '100X 70 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Montado sobre carton', '100X 70 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":100,"alto":70,"unidad":"cm"}}'::jsonb, '100X 70 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 35X50 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '35x50 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Montado sobre carton', '35X50 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Montado sobre carton', '35X50 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":35,"alto":50,"unidad":"cm"}}'::jsonb, '35X50 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 50X70 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '50x70 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Montado sobre carton', '50X70 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Montado sobre carton', '50X70 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":50,"alto":70,"unidad":"cm"}}'::jsonb, '50X70 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 60X90 CM
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '60x90 cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Montado sobre carton', '60X90 CM';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Montado sobre carton', '60X90 CM';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":60,"alto":90,"unidad":"cm"}}'::jsonb, '60X90 CM', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Montado sobre carton', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Montado sobre carton', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"],"medida":{"ancho":29.7,"alto":42,"unidad":"cm"}}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;

-- ═══ familia plastificado (7) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'plastificado a3'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'plastificado';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Plastificado a3', 'Plastificado';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Plastificado a3', 'Plastificado';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['plastificado']::text[], '{"acabado":"laminado","tamano":["a3"],"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Plastificado a3', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'plastificado a4'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'plastificado';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Plastificado A4', 'Plastificado';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Plastificado A4', 'Plastificado';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['plastificado']::text[], '{"acabado":"laminado","tamano":["a4"],"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Plastificado A4', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'plastificado oficio'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'plastificado';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Plastificado Oficio', 'Plastificado';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Plastificado Oficio', 'Plastificado';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['plastificado']::text[], '{"acabado":"laminado","tamano":["oficio"],"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Plastificado Oficio', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'encapsulado'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'laminado/brillo mate';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Encapsulado', 'Laminado/Brillo Mate';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Encapsulado', 'Laminado/Brillo Mate';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['plastificado']::text[], '{"acabado":"encapsulado","unidad_venta":"unidad","multiplica":true,"tamano":["a3","a4"]}'::jsonb, 'Encapsulado', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Encapsulado', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Encapsulado', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"]}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Encapsulado', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Encapsulado', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'A4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: METRO
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'metro'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Encapsulado', 'METRO';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Encapsulado', 'METRO';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"unidad_venta":"metro","multiplica":true}'::jsonb, 'METRO', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'laminados'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'laminado/brillo mate';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Laminados', 'Laminado/Brillo Mate';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Laminados', 'Laminado/Brillo Mate';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['plastificado']::text[], '{"acabado":"laminado","unidad_venta":"unidad","multiplica":true,"tamano":["a3","a4"]}'::jsonb, 'Laminados', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Laminados', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Laminados', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"]}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Laminados', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Laminados', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'A4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: METRO
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'metro'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Laminados', 'METRO';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Laminados', 'METRO';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"unidad_venta":"metro","multiplica":true}'::jsonb, 'METRO', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'carnet 9x13 cm'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'plastificado';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Carnet 9x13 cm', 'Plastificado';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Carnet 9x13 cm', 'Plastificado';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['plastificado']::text[], '{"acabado":"laminado","medida":{"ancho":9,"alto":13,"unidad":"cm"},"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Carnet 9x13 cm', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'cocodrilo'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'plastificado';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Cocodrilo', 'Plastificado';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Cocodrilo', 'Plastificado';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['plastificado']::text[], '{"acabado":"laminado","unidad_venta":"unidad","multiplica":true}'::jsonb, 'Cocodrilo', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ═══ familia taller (8) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'ojales'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Ojales', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Ojales', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['taller']::text[], '{"unidad_venta":null,"multiplica":null}'::jsonb, 'Ojales', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'numeradora'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Numeradora', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Numeradora', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['taller']::text[], '{"unidad_venta":"trabajo","multiplica":true}'::jsonb, 'Numeradora', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'perforaciones'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Perforaciones', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Perforaciones', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['taller']::text[], '{"unidad_venta":"pack","multiplica":false,"pack_tiers":[500,1000]}'::jsonb, 'Perforaciones', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: 500
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '500'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Perforaciones', '500';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Perforaciones', '500';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":500}'::jsonb, '500', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 1000
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '1000'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Perforaciones', '1000';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Perforaciones', '1000';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":1000}'::jsonb, '1000', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'puntas redondeadas'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Puntas Redondeadas', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Puntas Redondeadas', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['taller']::text[], '{"unidad_venta":"pack","multiplica":false,"pack_tiers":[100,500,1000]}'::jsonb, 'Puntas Redondeadas', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: 100
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '100'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Puntas Redondeadas', '100';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Puntas Redondeadas', '100';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":100}'::jsonb, '100', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 500
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '500'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Puntas Redondeadas', '500';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Puntas Redondeadas', '500';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":500}'::jsonb, '500', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 1000
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '1000'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Puntas Redondeadas', '1000';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Puntas Redondeadas', '1000';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":1000}'::jsonb, '1000', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'corte x millar'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Corte x Millar', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Corte x Millar', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['taller']::text[], '{"unidad_venta":"trabajo","multiplica":true,"pack_unidades":1000}'::jsonb, 'Corte x Millar', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'trazado/troquelado manual de papel.'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Trazado/Troquelado Manual de papel.', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Trazado/Troquelado Manual de papel.', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['taller']::text[], '{"acabado":"troquelado","unidad_venta":"unidad","multiplica":true}'::jsonb, 'Trazado/Troquelado Manual de papel.', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'bolsillos banner'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Bolsillos banner', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Bolsillos banner', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['taller','lonas_vinilos']::text[], '{"unidad_venta":"metro","multiplica":false}'::jsonb, 'Bolsillos banner', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'emblocados (lado corto o largo) c/carton.'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Emblocados (lado corto o largo) C/cartón.', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Emblocados (lado corto o largo) C/cartón.', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['taller','tacos']::text[], '{"material":"carton","servicio":true,"unidad_venta":"trabajo","multiplica":true,"tamano":["a3","a4","a5","a6","oficio"]}'::jsonb, 'Emblocados (lado corto o largo) C/cartón.', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: a3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Emblocados (lado corto o largo) C/cartón.', 'a3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Emblocados (lado corto o largo) C/cartón.', 'a3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"]}'::jsonb, 'a3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: a4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Emblocados (lado corto o largo) C/cartón.', 'a4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Emblocados (lado corto o largo) C/cartón.', 'a4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'a4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: a5
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a5'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Emblocados (lado corto o largo) C/cartón.', 'a5';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Emblocados (lado corto o largo) C/cartón.', 'a5';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a5"]}'::jsonb, 'a5', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: a6
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a6'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Emblocados (lado corto o largo) C/cartón.', 'a6';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Emblocados (lado corto o largo) C/cartón.', 'a6';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a6"]}'::jsonb, 'a6', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Oficio
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Emblocados (lado corto o largo) C/cartón.', 'Oficio';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Emblocados (lado corto o largo) C/cartón.', 'Oficio';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'Oficio', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;

-- ═══ familia anillado (3) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado metalico a4/a3'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Anillado Metálico a4/a3', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Anillado Metálico a4/a3', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['anillado','encuadernacion']::text[], '{"material":"metalico","tamano":["a4","a3"],"unidad_venta":"trabajo","multiplica":true}'::jsonb, 'Anillado Metálico a4/a3', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: Hasta 3/4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'hasta 3/4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Anillado Metálico a4/a3', 'Hasta 3/4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Anillado Metálico a4/a3', 'Hasta 3/4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"diametro":0.75,"unidad":"pulg"}}'::jsonb, 'Hasta 3/4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 1"
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '1"'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Anillado Metálico a4/a3', '1"';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Anillado Metálico a4/a3', '1"';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"diametro":1,"unidad":"pulg"}}'::jsonb, '1"', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 1" 1/8
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '1" 1/8'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Anillado Metálico a4/a3', '1" 1/8';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Anillado Metálico a4/a3', '1" 1/8';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"diametro":1.125,"unidad":"pulg"}}'::jsonb, '1" 1/8', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 1" 1/4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '1" 1/4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Anillado Metálico a4/a3', '1" 1/4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Anillado Metálico a4/a3', '1" 1/4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"diametro":1.25,"unidad":"pulg"}}'::jsonb, '1" 1/4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 1" 1/2
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '1" 1/2'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Anillado Metálico a4/a3', '1" 1/2';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Anillado Metálico a4/a3', '1" 1/2';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"diametro":1.5,"unidad":"pulg"}}'::jsonb, '1" 1/2', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado plastico a3'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Anillado Plastico a3', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Anillado Plastico a3', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['anillado','encuadernacion']::text[], '{"material":"plastico","tamano":["a3"],"unidad_venta":"trabajo","multiplica":true}'::jsonb, 'Anillado Plastico a3', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado plastico a4/oficio 24 hs'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Anillado Plastico a4/oficio 24 hs', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Anillado Plastico a4/oficio 24 hs', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['anillado','encuadernacion']::text[], '{"material":"plastico","tamano":["a4","oficio"],"unidad_venta":"trabajo","multiplica":true}'::jsonb, 'Anillado Plastico a4/oficio 24 hs', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ═══ familia encuadernacion (4) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'encuadernado'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Encuadernado', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Encuadernado', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['encuadernacion']::text[], '{"unidad_venta":"trabajo","multiplica":true}'::jsonb, 'Encuadernado', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'refilado de libros'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Refilado de libros', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Refilado de libros', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['encuadernacion']::text[], '{"unidad_venta":"trabajo","multiplica":true}'::jsonb, 'Refilado de libros', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'abrochado de revistas'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Abrochado de Revistas', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Abrochado de Revistas', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['encuadernacion']::text[], '{"unidad_venta":"trabajo","multiplica":true}'::jsonb, 'Abrochado de Revistas', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'armado de revistas. plegado/refilado y 2 ganchos'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Armado de Revistas. Plegado/refilado y 2 ganchos', 'Taller';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Armado de Revistas. Plegado/refilado y 2 ganchos', 'Taller';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['encuadernacion']::text[], '{"unidad_venta":"trabajo","multiplica":true}'::jsonb, 'Armado de Revistas. Plegado/refilado y 2 ganchos', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ═══ familia libreria (6) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'carpetas con vaina'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'libreria';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Carpetas con Vaina', 'Libreria';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Carpetas con Vaina', 'Libreria';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['libreria']::text[], '{"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Carpetas con Vaina', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'folios a4/oficio'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'libreria';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Folios a4/Oficio', 'Libreria';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Folios a4/Oficio', 'Libreria';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['libreria']::text[], '{"material":"plastico","tamano":["a4","oficio"],"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Folios a4/Oficio', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'sobre a3'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'libreria';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Sobre a3', 'Libreria';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Sobre a3', 'Libreria';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['libreria']::text[], '{"tamano":["a3"],"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Sobre a3', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'sobre a4'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'libreria';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Sobre a4', 'Libreria';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Sobre a4', 'Libreria';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['libreria']::text[], '{"tamano":["a4"],"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Sobre a4', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'sobre ingles'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'libreria';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Sobre Ingles', 'Libreria';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Sobre Ingles', 'Libreria';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['libreria']::text[], '{"tamano":["ingles"],"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Sobre Ingles', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'sobre ingles'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'soportes especiales';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Sobre Ingles', 'Soportes Especiales';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Sobre Ingles', 'Soportes Especiales';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['libreria']::text[], '{"tamano":["ingles"],"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Sobre Ingles', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ═══ familia tacos (6) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'tacos / emblocados 10x7 cm negro'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Tacos / Emblocados 10x7 cm negro', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Tacos / Emblocados 10x7 cm negro', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['tacos']::text[], '{"medida":{"ancho":10,"alto":7,"unidad":"cm"},"color":"bn","unidad_venta":"unidad","multiplica":true}'::jsonb, 'Tacos / Emblocados 10x7 cm negro', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'tacos / emblocados 10x7 cm color'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Tacos / Emblocados 10x7 cm color', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Tacos / Emblocados 10x7 cm color', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['tacos']::text[], '{"medida":{"ancho":10,"alto":7,"unidad":"cm"},"color":"color","unidad_venta":"unidad","multiplica":true}'::jsonb, 'Tacos / Emblocados 10x7 cm color', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'tacos / emblocados 10x15 cm negro'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Tacos / Emblocados 10x15 cm negro', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Tacos / Emblocados 10x15 cm negro', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['tacos']::text[], '{"medida":{"ancho":10,"alto":15,"unidad":"cm"},"color":"bn","unidad_venta":"unidad","multiplica":true}'::jsonb, 'Tacos / Emblocados 10x15 cm negro', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'tacos / emblocados 10x15 cm color'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Tacos / Emblocados 10x15 cm color', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Tacos / Emblocados 10x15 cm color', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['tacos']::text[], '{"medida":{"ancho":10,"alto":15,"unidad":"cm"},"color":"color","unidad_venta":"unidad","multiplica":true}'::jsonb, 'Tacos / Emblocados 10x15 cm color', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'tacos / emblocados 15x21 cm negro'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Tacos / Emblocados 15x21 cm negro', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Tacos / Emblocados 15x21 cm negro', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['tacos']::text[], '{"medida":{"ancho":15,"alto":21,"unidad":"cm"},"color":"bn","unidad_venta":"unidad","multiplica":true}'::jsonb, 'Tacos / Emblocados 15x21 cm negro', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'tacos / emblocados 15x21 cm color'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Tacos / Emblocados 15x21 cm color', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Tacos / Emblocados 15x21 cm color', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['tacos']::text[], '{"medida":{"ancho":15,"alto":21,"unidad":"cm"},"color":"color","unidad_venta":"unidad","multiplica":true}'::jsonb, 'Tacos / Emblocados 15x21 cm color', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ═══ familia tarjetas (4) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = '100 tarjetas color/negro'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', '100 Tarjetas Color/Negro', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), '100 Tarjetas Color/Negro', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['tarjetas']::text[], '{"unidad_venta":"pack","multiplica":false,"pack_unidades":100,"pack_tiers":[100,500,1000]}'::jsonb, '100 Tarjetas Color/Negro', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: Simple Faz
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'simple faz'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '100 Tarjetas Color/Negro', 'Simple Faz';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '100 Tarjetas Color/Negro', 'Simple Faz';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"simple"}'::jsonb, 'Simple Faz', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Doble Faz
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'doble faz'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '100 Tarjetas Color/Negro', 'Doble Faz';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '100 Tarjetas Color/Negro', 'Doble Faz';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"doble"}'::jsonb, 'Doble Faz', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Simple Faz Encapsuladas
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'simple faz encapsuladas'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '100 Tarjetas Color/Negro', 'Simple Faz Encapsuladas';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '100 Tarjetas Color/Negro', 'Simple Faz Encapsuladas';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"simple","acabado":"encapsulado"}'::jsonb, 'Simple Faz Encapsuladas', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Doble Faz Encapsuladas
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'doble faz encapsuladas'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '100 Tarjetas Color/Negro', 'Doble Faz Encapsuladas';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '100 Tarjetas Color/Negro', 'Doble Faz Encapsuladas';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"doble","acabado":"encapsulado"}'::jsonb, 'Doble Faz Encapsuladas', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = '500 tarjetas color/negro'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', '500 Tarjetas Color/Negro', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), '500 Tarjetas Color/Negro', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['tarjetas']::text[], '{"unidad_venta":"pack","multiplica":false,"pack_unidades":500,"pack_tiers":[100,500,1000]}'::jsonb, '500 Tarjetas Color/Negro', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: Simple Faz
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'simple faz'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '500 Tarjetas Color/Negro', 'Simple Faz';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '500 Tarjetas Color/Negro', 'Simple Faz';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"simple"}'::jsonb, 'Simple Faz', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Doble Faz
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'doble faz'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '500 Tarjetas Color/Negro', 'Doble Faz';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '500 Tarjetas Color/Negro', 'Doble Faz';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"doble"}'::jsonb, 'Doble Faz', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Simple Faz Encapsuladas
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'simple faz encapsuladas'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '500 Tarjetas Color/Negro', 'Simple Faz Encapsuladas';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '500 Tarjetas Color/Negro', 'Simple Faz Encapsuladas';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"simple","acabado":"encapsulado"}'::jsonb, 'Simple Faz Encapsuladas', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Doble Faz Encapsuladas
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'doble faz encapsuladas'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '500 Tarjetas Color/Negro', 'Doble Faz Encapsuladas';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '500 Tarjetas Color/Negro', 'Doble Faz Encapsuladas';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"doble","acabado":"encapsulado"}'::jsonb, 'Doble Faz Encapsuladas', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = '1000 tarjetas color/negro'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', '1000 Tarjetas Color/Negro', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), '1000 Tarjetas Color/Negro', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['tarjetas']::text[], '{"unidad_venta":"pack","multiplica":false,"pack_unidades":1000,"pack_tiers":[100,500,1000]}'::jsonb, '1000 Tarjetas Color/Negro', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: Simple Faz
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'simple faz'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '1000 Tarjetas Color/Negro', 'Simple Faz';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '1000 Tarjetas Color/Negro', 'Simple Faz';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"simple"}'::jsonb, 'Simple Faz', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Doble Faz
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'doble faz'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '1000 Tarjetas Color/Negro', 'Doble Faz';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '1000 Tarjetas Color/Negro', 'Doble Faz';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"doble"}'::jsonb, 'Doble Faz', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Simple Faz Encapsuladas
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'simple faz encapsuladas'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '1000 Tarjetas Color/Negro', 'Simple Faz Encapsuladas';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '1000 Tarjetas Color/Negro', 'Simple Faz Encapsuladas';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"simple","acabado":"encapsulado"}'::jsonb, 'Simple Faz Encapsuladas', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Doble Faz Encapsuladas
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'doble faz encapsuladas'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '1000 Tarjetas Color/Negro', 'Doble Faz Encapsuladas';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '1000 Tarjetas Color/Negro', 'Doble Faz Encapsuladas';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"doble","acabado":"encapsulado"}'::jsonb, 'Doble Faz Encapsuladas', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = '100 tarjetas papel kraft 280 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', '100 Tarjetas Papel Kraft 280 gr', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), '100 Tarjetas Papel Kraft 280 gr', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['tarjetas']::text[], '{"papel":"kraft","gramaje_gr":280,"unidad_venta":"pack","multiplica":false,"pack_unidades":100,"pack_tiers":[100]}'::jsonb, '100 Tarjetas Papel Kraft 280 gr', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: Simple Faz
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'simple faz'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '100 Tarjetas Papel Kraft 280 gr', 'Simple Faz';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '100 Tarjetas Papel Kraft 280 gr', 'Simple Faz';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"simple"}'::jsonb, 'Simple Faz', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Doble Faz
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'doble faz'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', '100 Tarjetas Papel Kraft 280 gr', 'Doble Faz';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', '100 Tarjetas Papel Kraft 280 gr', 'Doble Faz';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"faz":"doble"}'::jsonb, 'Doble Faz', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;

-- ═══ familia folletos (3) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'folletos 10x15 cm papel ilustracion brillo 150 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Folletos 10x15 cm papel ilustracion brillo 150 gr', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Folletos 10x15 cm papel ilustracion brillo 150 gr', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['folletos']::text[], '{"papel":"ilustracion","gramaje_gr":150,"acabado":"brillo","medida":{"ancho":10,"alto":15,"unidad":"cm"},"unidad_venta":"pack","multiplica":false,"pack_tiers":[500,1000,2000,3000]}'::jsonb, 'Folletos 10x15 cm papel ilustracion brillo 150 gr', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: x500
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'x500'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Folletos 10x15 cm papel ilustracion brillo 150 gr', 'x500';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Folletos 10x15 cm papel ilustracion brillo 150 gr', 'x500';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":500}'::jsonb, 'x500', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: x1000
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'x1000'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Folletos 10x15 cm papel ilustracion brillo 150 gr', 'x1000';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Folletos 10x15 cm papel ilustracion brillo 150 gr', 'x1000';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":1000}'::jsonb, 'x1000', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: x2000
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'x2000'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Folletos 10x15 cm papel ilustracion brillo 150 gr', 'x2000';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Folletos 10x15 cm papel ilustracion brillo 150 gr', 'x2000';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":2000}'::jsonb, 'x2000', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: x3000
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'x3000'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Folletos 10x15 cm papel ilustracion brillo 150 gr', 'x3000';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Folletos 10x15 cm papel ilustracion brillo 150 gr', 'x3000';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":3000}'::jsonb, 'x3000', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'folletos 10x15 cm papel obra de 75 gr b/n'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Folletos 10x15 cm papel obra de 75 gr b/n', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Folletos 10x15 cm papel obra de 75 gr b/n', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['folletos']::text[], '{"papel":"obra","gramaje_gr":75,"color":"bn","medida":{"ancho":10,"alto":15,"unidad":"cm"},"unidad_venta":"pack","multiplica":false,"pack_tiers":[500,1000,2000,3000]}'::jsonb, 'Folletos 10x15 cm papel obra de 75 gr b/n', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: x500
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'x500'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Folletos 10x15 cm papel obra de 75 gr b/n', 'x500';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Folletos 10x15 cm papel obra de 75 gr b/n', 'x500';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":500}'::jsonb, 'x500', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: x1000
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'x1000'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Folletos 10x15 cm papel obra de 75 gr b/n', 'x1000';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Folletos 10x15 cm papel obra de 75 gr b/n', 'x1000';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":1000}'::jsonb, 'x1000', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: x2000
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'x2000'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Folletos 10x15 cm papel obra de 75 gr b/n', 'x2000';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Folletos 10x15 cm papel obra de 75 gr b/n', 'x2000';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":2000}'::jsonb, 'x2000', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: x3000
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'x3000'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Folletos 10x15 cm papel obra de 75 gr b/n', 'x3000';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Folletos 10x15 cm papel obra de 75 gr b/n', 'x3000';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":3000}'::jsonb, 'x3000', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'folletos 10x15 cm papel obra de 75 gr color inkjet'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Folletos 10x15 cm papel obra de 75 gr color inkjet', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Folletos 10x15 cm papel obra de 75 gr color inkjet', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['folletos']::text[], '{"tecnologia":"riso","papel":"obra","gramaje_gr":75,"color":"color","medida":{"ancho":10,"alto":15,"unidad":"cm"},"unidad_venta":"pack","multiplica":false,"pack_tiers":[500,1000,2000,3000]}'::jsonb, 'Folletos 10x15 cm papel obra de 75 gr color inkjet', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: 500
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '500'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Folletos 10x15 cm papel obra de 75 gr color inkjet', '500';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Folletos 10x15 cm papel obra de 75 gr color inkjet', '500';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":500}'::jsonb, '500', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 1000
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '1000'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Folletos 10x15 cm papel obra de 75 gr color inkjet', '1000';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Folletos 10x15 cm papel obra de 75 gr color inkjet', '1000';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":1000}'::jsonb, '1000', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 2000
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '2000'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Folletos 10x15 cm papel obra de 75 gr color inkjet', '2000';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Folletos 10x15 cm papel obra de 75 gr color inkjet', '2000';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":2000}'::jsonb, '2000', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 3000
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '3000'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Folletos 10x15 cm papel obra de 75 gr color inkjet', '3000';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Folletos 10x15 cm papel obra de 75 gr color inkjet', '3000';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"pack_unidades":3000}'::jsonb, '3000', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;

-- ═══ familia carpetas (2) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'carpetas de presentacion a4 laminadas brillo/mate'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Carpetas de presentación a4 laminadas brillo/mate', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Carpetas de presentación a4 laminadas brillo/mate', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['carpetas']::text[], '{"tamano":["a4"],"acabado":["laminado","brillo","mate"],"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Carpetas de presentación a4 laminadas brillo/mate', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'carpetas de presentacion a4 s/laminar'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Carpetas de presentación a4 s/laminar', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Carpetas de presentación a4 s/laminar', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['carpetas']::text[], '{"tamano":["a4"],"acabado":null,"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Carpetas de presentación a4 s/laminar', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ═══ familia ploteo (4) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'impresion autocad lineal color/negro'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'autocad lineal';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Impresión Autocad lineal Color/Negro', 'Autocad Lineal';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Impresión Autocad lineal Color/Negro', 'Autocad Lineal';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['ploteo']::text[], '{"tecnologia":"riso","unidad_venta":"hoja","multiplica":true,"tamano":["a3","a4","oficio"]}'::jsonb, 'Impresión Autocad lineal Color/Negro', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: A3
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a3'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Impresión Autocad lineal Color/Negro', 'A3';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Impresión Autocad lineal Color/Negro', 'A3';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a3"]}'::jsonb, 'A3', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: A4
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Impresión Autocad lineal Color/Negro', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Impresión Autocad lineal Color/Negro', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["a4"]}'::jsonb, 'A4', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: OFICIO
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'oficio'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Impresión Autocad lineal Color/Negro', 'OFICIO';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Impresión Autocad lineal Color/Negro', 'OFICIO';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"tamano":["oficio"]}'::jsonb, 'OFICIO', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'lineal obra 90 gr color/negro'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'ploteados';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Lineal obra 90 gr Color/Negro', 'PLOTEADOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Lineal obra 90 gr Color/Negro', 'PLOTEADOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['ploteo']::text[], '{"tecnologia":"plotter","papel":"obra","gramaje_gr":90,"unidad_venta":"m2","multiplica":true}'::jsonb, 'Lineal obra 90 gr Color/Negro', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: 25% Cobertura
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '25% cobertura'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Lineal obra 90 gr Color/Negro', '25% Cobertura';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Lineal obra 90 gr Color/Negro', '25% Cobertura';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"cobertura":"25"}'::jsonb, '25% Cobertura', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 50% Cobertura
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '50% cobertura'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Lineal obra 90 gr Color/Negro', '50% Cobertura';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Lineal obra 90 gr Color/Negro', '50% Cobertura';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"cobertura":"50"}'::jsonb, '50% Cobertura', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 100% Cobertura
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '100% cobertura'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Lineal obra 90 gr Color/Negro', '100% Cobertura';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Lineal obra 90 gr Color/Negro', '100% Cobertura';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"cobertura":"100"}'::jsonb, '100% Cobertura', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Lineal
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'lineal'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Lineal obra 90 gr Color/Negro', 'Lineal';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Lineal obra 90 gr Color/Negro', 'Lineal';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"cobertura":"lineal"}'::jsonb, 'Lineal', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'papel 130 gr recubierto / encapado'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'ploteados';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Papel 130 gr Recubierto / Encapado', 'PLOTEADOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Papel 130 gr Recubierto / Encapado', 'PLOTEADOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['ploteo']::text[], '{"tecnologia":"plotter","papel":"recubierto","gramaje_gr":130,"unidad_venta":"m2","multiplica":true}'::jsonb, 'Papel 130 gr Recubierto / Encapado', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: 25% Cobertura
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '25% cobertura'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel 130 gr Recubierto / Encapado', '25% Cobertura';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel 130 gr Recubierto / Encapado', '25% Cobertura';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"cobertura":"25"}'::jsonb, '25% Cobertura', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 50% Cobertura
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '50% cobertura'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel 130 gr Recubierto / Encapado', '50% Cobertura';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel 130 gr Recubierto / Encapado', '50% Cobertura';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"cobertura":"50"}'::jsonb, '50% Cobertura', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 100% Cobertura
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '100% cobertura'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel 130 gr Recubierto / Encapado', '100% Cobertura';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel 130 gr Recubierto / Encapado', '100% Cobertura';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"cobertura":"100"}'::jsonb, '100% Cobertura', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Lineal
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'lineal'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel 130 gr Recubierto / Encapado', 'Lineal';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel 130 gr Recubierto / Encapado', 'Lineal';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"cobertura":"lineal"}'::jsonb, 'Lineal', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'papel obra vegetal color/negro'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'ploteados';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Papel Obra Vegetal Color/Negro', 'PLOTEADOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Papel Obra Vegetal Color/Negro', 'PLOTEADOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['ploteo']::text[], '{"tecnologia":"plotter","papel":"vegetal","unidad_venta":"m2","multiplica":true}'::jsonb, 'Papel Obra Vegetal Color/Negro', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
    -- variante: 25% Cobertura
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '25% cobertura'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel Obra Vegetal Color/Negro', '25% Cobertura';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel Obra Vegetal Color/Negro', '25% Cobertura';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"cobertura":"25"}'::jsonb, '25% Cobertura', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 50% Cobertura
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '50% cobertura'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel Obra Vegetal Color/Negro', '50% Cobertura';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel Obra Vegetal Color/Negro', '50% Cobertura';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"cobertura":"50"}'::jsonb, '50% Cobertura', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: 100% Cobertura
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '100% cobertura'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel Obra Vegetal Color/Negro', '100% Cobertura';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel Obra Vegetal Color/Negro', '100% Cobertura';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"cobertura":"100"}'::jsonb, '100% Cobertura', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Lineal
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'lineal'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Papel Obra Vegetal Color/Negro', 'Lineal';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Papel Obra Vegetal Color/Negro', 'Lineal';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"cobertura":"lineal"}'::jsonb, 'Lineal', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;

-- ═══ familia porta_banner (2) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'porta banner 2 velas 0.90 x 1.90 mt'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Porta Banner 2 velas 0.90 x 1.90 mt', 'Productos';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Porta Banner 2 velas 0.90 x 1.90 mt', 'Productos';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['porta_banner']::text[], '{"medida":{"ancho":90,"alto":190,"unidad":"cm"},"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Porta Banner 2 velas 0.90 x 1.90 mt', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'porta banner roll up 0..85 x 2.00 mt'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Porta Banner Roll up 0..85 x 2.00 mt', 'Productos';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Porta Banner Roll up 0..85 x 2.00 mt', 'Productos';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['porta_banner']::text[], '{"medida":{"ancho":85,"alto":200,"unidad":"cm"},"unidad_venta":"unidad","multiplica":true}'::jsonb, 'Porta Banner Roll up 0..85 x 2.00 mt', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ═══ familia imanes (1) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'iman. impresion laminada y corte.'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'iman';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Iman. Impresión laminada y corte.', 'Iman';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Iman. Impresión laminada y corte.', 'Iman';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, nombre_origen, updated_at)
    values (pid, array['imanes']::text[], '{"acabado":"laminado","unidad_venta":"unidad","multiplica":true}'::jsonb, 'Iman. Impresión laminada y corte.', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ═══ familia talonarios (1) ═══
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'talonarios rifas 100 numeros'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): % @ %', 'Talonarios Rifas 100 numeros', 'PIEZAS GRAFICAS/PRODUCTOS';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): % @ %', array_length(ids, 1), 'Talonarios Rifas 100 numeros', 'PIEZAS GRAFICAS/PRODUCTOS';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, familias, atributos, por_pack, nombre_origen, updated_at)
    values (pid, array['talonarios']::text[], '{"unidad_venta":"pack","multiplica":false,"pack_unidades":100}'::jsonb, true, 'Talonarios Rifas 100 numeros', now())
    on conflict (producto_id) do update set familias = excluded.familias, atributos = excluded.atributos, updated_at = excluded.updated_at, por_pack = excluded.por_pack;
    -- variante: Escala de rifas 10x7cm
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'escala de rifas 10x7cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Talonarios Rifas 100 numeros', 'Escala de rifas 10x7cm';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Talonarios Rifas 100 numeros', 'Escala de rifas 10x7cm';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":10,"alto":7,"unidad":"cm"}}'::jsonb, 'Escala de rifas 10x7cm', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
    -- variante: Escala de rifas 15x7cm
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'escala de rifas 15x7cm'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Talonarios Rifas 100 numeros', 'Escala de rifas 15x7cm';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Talonarios Rifas 100 numeros', 'Escala de rifas 15x7cm';
    else
      insert into bot.variante_meta as vm (variante_id, atributos, nombre_origen, updated_at)
      values (ids[1], '{"medida":{"ancho":15,"alto":7,"unidad":"cm"}}'::jsonb, 'Escala de rifas 15x7cm', now())
      on conflict (variante_id) do update set atributos = excluded.atributos, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 4. Resumen — LEER LOS NOTICES. Un SKIPPED significa que ese producto o esa
--    variante se renombró en el mostrador desde el export: re-exportar y
--    regenerar solo esa fila. Un producto sin atributos NO rompe nada (queda
--    fuera de los guards y sin total calculado), pero tampoco mejora.
-- ---------------------------------------------------------------------------
do $$
declare np int; nv int;
begin
  select count(*) into np from bot.producto_meta where familias <> '{}';
  select count(*) into nv from bot.variante_meta where atributos <> '{}'::jsonb;
  raise notice '---------------------------------------------------------------';
  raise notice 'ATOMIZACIÓN: % productos con familia (esperados 83), % variantes con atributos (esperadas 139).', np, nv;
  if np = 0 then
    raise exception 'ATOMIZACIÓN: 0 productos resueltos — algo está mal (¿base equivocada?). NO commitear.';
  end if;
  if np < 83 then
    raise notice 'OJO: faltan % productos. Revisá los SKIPPED de arriba.', 83 - np;
  end if;
  raise notice '---------------------------------------------------------------';
end $$;

commit;

-- ---------------------------------------------------------------------------
-- Sanity (correr después de aplicar):
--
-- -- 1. las vistas exponen las columnas nuevas
-- select nombre_canonico, familias, atributos from bot.taxonomia
--   where nombre_canonico ilike '%kraft%';
--
-- -- 2. el atributo EFECTIVO se resuelve solo (variante pisa producto)
-- select t.nombre_canonico, v.variante, v.atributos->>'unidad_venta' as unidad
--   from bot.variantes v join bot.taxonomia t using (producto_id)
--   where t.nombre_canonico ilike '%Pvc c/ Papel obra%';
--   -- las medidas fijas: 'unidad' (heredado) · la variante m2: 'm2' (override)
--
-- -- 3. el guard del 6,7x tiene con qué distinguir
-- select nombre_canonico, atributos->>'tecnologia' from bot.taxonomia
--   where nombre_canonico ilike '%106%';   -- uno riso, otro laser
--
-- -- 4. el unico flag que cambio
-- select por_pack from bot.variantes v join bot.taxonomia t using (producto_id)
--   where t.nombre_canonico ilike '%Talonarios%';   -- true
--
-- -- 5. nada se piso: displays y sinonimos intactos
-- select count(*) from bot.producto_meta where display_name is not null;  -- 8
-- ---------------------------------------------------------------------------
