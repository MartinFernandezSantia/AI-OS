-- =============================================================================
-- MIGRACIÓN: poblar el modelo producto-bot desde el modelo viejo
-- =============================================================================
-- Transforma bot.grupo/grupo_item + producto_meta/variante_meta + public en
-- bot.producto/bot.producto_item. NO toca public. NO toca la capa de precios
-- (bot.variantes, flags por_pagina/por_pack, variante_meta.atributos siguen vivos).
--
-- ORDEN de aplicación (Martin):
--   1. catalogo-producto-bot.sql              (DDL de las tablas nuevas + seed familias)
--   2. nombres-bot-2026-08-09.sql             (renombres → producto_meta/variante_meta)  [ya bajado]
--   3. grupos-bot-2026-08-09.sql              (grupos → bot.grupo/grupo_item)             [ya bajado]
--   4. ESTE archivo                           (puebla producto-bot desde lo anterior)
--   5. curador-export-v4.sql → RAG ingest
--
-- IDEMPOTENTE: no lleva uuids literales. Lee la base local, así corre igual en
-- testing y en prod (cada una con sus propios uuid). Upsert por clave natural del
-- producto-bot; los items se re-sincronizan (delete+insert) desde la fuente.
-- Transaccional. Reglas de borde con RAISE NOTICE/WARNING/EXCEPTION.
--
-- Absorción: una variante que pertenece a un grupo (bot.grupo_item) NO genera además
-- un producto-bot individual → mata el solapamiento por construcción, sin flag `oculto`
-- (que la sacaría de bot.variantes y le quitaría el precio).
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Helpers temporales (viven sólo en esta sesión)
-- ---------------------------------------------------------------------------

-- normKey: espeja translate(lower(trim(x))) del resto del overlay.
create or replace function pg_temp.nk(t text) returns text
  language sql immutable as
$$ select translate(lower(trim(coalesce(t, ''))), 'áéíóúñ', 'aeioun') $$;

-- sinónimos efectivos: agrega el nombre vivo como auto-sinónimo sólo si el display
-- lo renombró y no está ya presente (misma regla que bot.taxonomia / export v3).
create or replace function pg_temp.sinef(sin text[], display text, vivo text, auto boolean)
  returns text[] language sql immutable as $$
  select coalesce(sin, '{}') || case
    when display is not null and display <> vivo and coalesce(auto, true)
     and not exists (select 1 from unnest(coalesce(sin, '{}')) s where pg_temp.nk(s) = pg_temp.nk(vivo))
    then array[vivo] else '{}'::text[] end
$$;

-- mapeo familia granular (producto_meta.familias[1]) → familia slot-filling.
-- Aprobado con Martin sobre el artefacto de familias.
create temp table _fam_map(gran text primary key, fam text) on commit drop;
insert into _fam_map(gran, fam) values
  ('impresion',      'impresiones_papel'),
  ('folletos',       'folletos'),
  ('lonas_vinilos',  'ploteado'),
  ('ploteo',         'ploteado'),
  ('tarjetas',       'tarjetas'),
  ('carteleria',     'carteleria'),
  ('porta_banner',   'otro'),
  ('libreria',       'libreria'),
  ('papeles',        'libreria'),
  ('carpetas',       'libreria'),
  ('talonarios',     'otro'),
  ('tacos',          'otro'),
  ('plastificado',   'otro'),
  ('encuadernacion', 'otro'),
  ('anillado',       'otro'),
  ('taller',         'otro'),
  ('imanes',         'otro');

-- familia slot-filling de un producto public (por su primera familia granular curada).
create or replace function pg_temp.fam_de(p_id uuid) returns text
  language sql stable as $$
  select coalesce(
    (select fm.fam
       from bot.producto_meta pm
       left join _fam_map fm on fm.gran = pm.familias[1]
      where pm.producto_id = p_id),
    'otro')
$$;

-- nicho de un producto public (atributos->>'nicho', normalizado a null si vacío).
create or replace function pg_temp.nicho_de(p_id uuid) returns text
  language sql stable as $$
  select nullif(pm.atributos->>'nicho', '')
    from bot.producto_meta pm where pm.producto_id = p_id
$$;

-- ---------------------------------------------------------------------------
-- 1) GRUPOS → producto-bot (N variantes)
-- ---------------------------------------------------------------------------
do $mig$
declare
  g record; v_pid uuid; v_fam text; v_nicho text; v_sin text[]; v_cas text[];
  n_fam int; n_nicho int;
begin
  for g in select * from bot.grupo where not oculto order by clave loop

    -- familia: única entre los productos dueños de las variantes; si mezclan → 'otro'
    select count(distinct pg_temp.fam_de(p.id)), min(pg_temp.fam_de(p.id))
      into n_fam, v_fam
      from bot.grupo_item gi
      join public.product_variants pv on pv.id = gi.variante_id
      join public.products p on p.id = pv.product_id
     where gi.grupo_id = g.id;
    if coalesce(n_fam, 0) <> 1 then v_fam := 'otro'; end if;

    -- nicho: único no-nulo entre los absorbidos; si mezclan o ninguno → null
    select count(distinct nn), min(nn) into n_nicho, v_nicho
      from (
        select pg_temp.nicho_de(p.id) nn
          from bot.grupo_item gi
          join public.product_variants pv on pv.id = gi.variante_id
          join public.products p on p.id = pv.product_id
         where gi.grupo_id = g.id and pg_temp.nicho_de(p.id) is not null
      ) q;
    if coalesce(n_nicho, 0) <> 1 then v_nicho := null; end if;

    -- sinónimos = del grupo + efectivos heredados de los productos absorbidos (dedupe)
    select array(select distinct e from unnest(
             coalesce(g.sinonimos, '{}') ||
             coalesce((select array_agg(x) from (
               select unnest(pg_temp.sinef(pm.sinonimos, pm.display_name, p.name, pm.auto_sinonimo)) x
                 from bot.grupo_item gi
                 join public.product_variants pv on pv.id = gi.variante_id
                 join public.products p on p.id = pv.product_id
                 left join bot.producto_meta pm on pm.producto_id = p.id
                where gi.grupo_id = g.id
             ) s), '{}')
           ) e where e is not null and e <> '')
      into v_sin;

    -- casos de uso = del grupo + heredados de los absorbidos (dedupe)
    select array(select distinct e from unnest(
             coalesce(g.casos_de_uso, '{}') ||
             coalesce((select array_agg(x) from (
               select unnest(coalesce(pm.casos_de_uso, '{}')) x
                 from bot.grupo_item gi
                 join public.product_variants pv on pv.id = gi.variante_id
                 join public.products p on p.id = pv.product_id
                 left join bot.producto_meta pm on pm.producto_id = p.id
                where gi.grupo_id = g.id
             ) s), '{}')
           ) e where e is not null and e <> '')
      into v_cas;

    insert into bot.producto(clave, nombre_bot, familia, sinonimos, casos_de_uso, nicho, updated_at)
    values (g.clave, g.nombre_bot, v_fam, v_sin, v_cas, v_nicho, now())
    on conflict (clave) do update set
      nombre_bot = excluded.nombre_bot, familia = excluded.familia,
      sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso,
      nicho = excluded.nicho, updated_at = now()
    returning id into v_pid;

    -- re-sync de items (el estado del grupo es la verdad)
    delete from bot.producto_item where producto_id = v_pid;
    insert into bot.producto_item(producto_id, variante_id, nombre_variante_bot, oculto)
    select v_pid, gi.variante_id, gi.nombre_variante_bot, gi.oculto
      from bot.grupo_item gi where gi.grupo_id = g.id;

  end loop;
end $mig$;

-- ---------------------------------------------------------------------------
-- 2) PRODUCTOS INDIVIDUALES → producto-bot (sólo variantes NO absorbidas)
-- ---------------------------------------------------------------------------
do $mig$
declare
  p record; v_pid uuid; v_clave text; v_nombre text; n_items int;
begin
  for p in
    select pr.id, pr.name, c.name as cat,
           pm.display_name, pm.sinonimos, pm.casos_de_uso, pm.auto_sinonimo, pm.atributos
      from public.products pr
      join public.categories c on c.id = pr.category_id
      left join bot.producto_meta pm on pm.producto_id = pr.id
     where pr.is_active and c.audience = 'publico' and not coalesce(pm.oculto, false)
     order by pr.name
  loop
    v_nombre := coalesce(p.display_name, p.name);
    v_clave  := pg_temp.nk(v_nombre) || '|' || pg_temp.nk(p.cat);

    select count(*) into n_items
      from public.product_variants v
      left join bot.variante_meta vm on vm.variante_id = v.id
     where v.product_id = p.id and v.is_active
       and not coalesce(vm.oculto, false)
       and not exists (select 1 from bot.grupo_item gi where gi.variante_id = v.id);

    if n_items = 0 then
      raise notice 'SKIP individual (0 variantes libres, todas absorbidas u ocultas): %', v_nombre;
      continue;
    end if;

    insert into bot.producto(clave, nombre_bot, familia, sinonimos, casos_de_uso, nicho, updated_at)
    values (v_clave, v_nombre, pg_temp.fam_de(p.id),
            pg_temp.sinef(p.sinonimos, p.display_name, p.name, p.auto_sinonimo),
            coalesce(p.casos_de_uso, '{}'),
            nullif(p.atributos->>'nicho', ''), now())
    on conflict (clave) do update set
      nombre_bot = excluded.nombre_bot, familia = excluded.familia,
      sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso,
      nicho = excluded.nicho, updated_at = now()
    returning id into v_pid;

    delete from bot.producto_item where producto_id = v_pid;
    insert into bot.producto_item(producto_id, variante_id, nombre_variante_bot, oculto)
    select v_pid, v.id, vm.display_variante, false
      from public.product_variants v
      left join bot.variante_meta vm on vm.variante_id = v.id
     where v.product_id = p.id and v.is_active
       and not coalesce(vm.oculto, false)
       and not exists (select 1 from bot.grupo_item gi where gi.variante_id = v.id);

  end loop;
end $mig$;

-- ---------------------------------------------------------------------------
-- 3) ASSERTS / sanity (la variante-en-2-grupos ya la bloquea el unique index)
-- ---------------------------------------------------------------------------
do $chk$
declare n int;
begin
  select count(*) into n from bot.producto where familia is null;
  if n > 0 then raise warning 'producto-bot SIN familia: % (revisar)', n; end if;

  select count(*) into n
    from bot.producto p left join bot.familia f on f.clave = p.familia
   where p.familia is not null and f.clave is null;
  if n > 0 then raise exception 'producto-bot con familia inexistente en bot.familia: %', n; end if;

  select count(*) into n
    from bot.producto p
   where not exists (select 1 from bot.producto_item i where i.producto_id = p.id);
  if n > 0 then raise warning 'producto-bot SIN items: % (deberían haberse saltado)', n; end if;

  raise notice 'Migración OK → producto-bot: %, items: %, familias en uso: %',
    (select count(*) from bot.producto),
    (select count(*) from bot.producto_item),
    (select count(distinct familia) from bot.producto);
end $chk$;

commit;
-- Después de aplicar: correr curador-export-v4.sql, guardar el JSON, re-ingestar embeddings.
