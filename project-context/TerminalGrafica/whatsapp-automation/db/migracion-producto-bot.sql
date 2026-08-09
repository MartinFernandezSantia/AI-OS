-- =============================================================================
-- MIGRACIÓN: poblar el modelo producto-bot desde el modelo viejo
-- =============================================================================
-- Transforma bot.grupo/grupo_item + producto_meta/variante_meta + public en
-- bot.producto/bot.producto_item. NO toca public. NO toca la capa de precios
-- (bot.variantes, flags por_pagina/por_pack, variante_meta.atributos siguen vivos).
--
-- ORDEN de aplicación (Martin):
--   1. catalogo-producto-bot.sql              (DDL de las tablas nuevas + seed familias)
--   2. nombres-bot-2026-08-09.sql             (renombres → producto_meta/variante_meta)  [Downloads]
--   3. grupos-bot-2026-08-09.sql              (grupos → bot.grupo/grupo_item)             [Downloads]
--   4. ESTE archivo                           (puebla producto-bot desde lo anterior)
--   5. curador-export-v4.sql → RAG ingest
--
-- ⚠️ MIGRACIÓN INICIAL / REPOBLADO COMPLETO. Borra y repuebla bot.producto(_item) enteros,
--    así el resultado es idempotente (mismo input → mismo output) sin huérfanos ni colisiones
--    de índice entre runs. Por eso NO usar una vez que el DASHBOARD edite bot.producto (Fase 4):
--    para eso va el script de reconciliación INSERT-ONLY, no este. Correr por psql/CLI si podés:
--    el SQL editor de Supabase no muestra los RAISE NOTICE (el resumen final SÍ es seleccionable).
--
-- No lleva uuids literales: lee la base local, corre igual en testing y prod.
-- Transaccional. Los conflictos duros (variante en 2 grupos, colisión de clave/nombre) ABORTAN
-- con diagnóstico ANTES de tocar nada.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Helpers temporales (viven sólo en esta sesión)
-- ---------------------------------------------------------------------------

create or replace function pg_temp.nk(t text) returns text
  language sql immutable as
$$ select translate(lower(trim(coalesce(t, ''))), 'áéíóúñ', 'aeioun') $$;

-- una variante está ABSORBIDA sólo si cuelga de un grupo NO oculto (ocultar un grupo la libera).
create or replace function pg_temp.absorbida(v_id uuid) returns boolean
  language sql stable as $$
  select exists (
    select 1 from bot.grupo_item gi
    join bot.grupo g on g.id = gi.grupo_id and not g.oculto
    where gi.variante_id = v_id
  )
$$;

-- ¿el producto public tiene al menos una variante viva y NO absorbida? (→ genera individual)
create or replace function pg_temp.tiene_libre(p_id uuid) returns boolean
  language sql stable as $$
  select exists (
    select 1 from public.product_variants v
    left join bot.variante_meta vm on vm.variante_id = v.id
    where v.product_id = p_id and v.is_active
      and not coalesce(vm.oculto, false) and not pg_temp.absorbida(v.id)
  )
$$;

-- sinónimos efectivos de un producto: nombre vivo (si hubo rename) + display curado, para heredar
-- al grupo el vocabulario del producto absorbido.
create or replace function pg_temp.sinef(sin text[], display text, vivo text, auto boolean)
  returns text[] language sql immutable as $$
  select coalesce(sin, '{}')
    || case when display is not null and display <> vivo and coalesce(auto, true)
             and not exists (select 1 from unnest(coalesce(sin, '{}')) s where pg_temp.nk(s) = pg_temp.nk(vivo))
            then array[vivo] else '{}'::text[] end
    || case when display is not null then array[display] else '{}'::text[] end
$$;

-- dedupe NORMALIZADO de un text[] (colapsa "Volantes"/"volantes"/tildes), orden estable.
create or replace function pg_temp.dedup_norm(arr text[]) returns text[]
  language sql immutable as $$
  select coalesce(array(
    select min(e) from unnest(coalesce(arr, '{}')) e
    where e is not null and btrim(e) <> '' group by pg_temp.nk(e) order by min(e)
  ), '{}')
$$;

-- mapeo familia granular (producto_meta.familias[1]) → familia slot-filling (aprobado con Martin).
create temp table _fam_map(gran text primary key, fam text) on commit drop;
insert into _fam_map(gran, fam) values
  ('impresion','impresiones_papel'), ('folletos','folletos'),
  ('lonas_vinilos','ploteado'), ('ploteo','ploteado'),
  ('tarjetas','tarjetas'), ('carteleria','carteleria'),
  ('porta_banner','otro'), ('libreria','libreria'),
  ('papeles','libreria'), ('carpetas','libreria'),
  ('talonarios','otro'), ('tacos','otro'), ('plastificado','otro'),
  ('encuadernacion','otro'), ('anillado','otro'), ('taller','otro'), ('imanes','otro');

create or replace function pg_temp.fam_de(p_id uuid) returns text
  language sql stable as $$
  select coalesce((
    select fm.fam from bot.producto_meta pm
    left join _fam_map fm on fm.gran = pm.familias[1]
    where pm.producto_id = p_id), 'otro')
$$;

create or replace function pg_temp.nicho_de(p_id uuid) returns text
  language sql stable as $$
  select nullif(pm.atributos->>'nicho', '') from bot.producto_meta pm where pm.producto_id = p_id
$$;

-- clave natural de un producto-bot INDIVIDUAL.
create or replace function pg_temp.clave_ind(nombre_bot text, categoria text) returns text
  language sql immutable as $$ select pg_temp.nk(nombre_bot) || '|' || pg_temp.nk(categoria) $$;

-- ---------------------------------------------------------------------------
-- PRE-ASSERTS (abortan con diagnóstico ANTES de tocar nada)
-- ---------------------------------------------------------------------------

-- (c) una variante en más de un grupo activo → la cotizaría dos veces
do $pre$
declare r record; msg text := '';
begin
  for r in
    select gi.variante_id, count(*) n, string_agg(g.nombre_bot, ' | ') grupos
    from bot.grupo_item gi join bot.grupo g on g.id = gi.grupo_id and not g.oculto
    group by gi.variante_id having count(*) > 1
  loop msg := msg || format(E'  variante %s en %s grupos: %s\n', r.variante_id, r.n, r.grupos); end loop;
  if msg <> '' then raise exception E'Variante(s) en más de un grupo activo:\n%', msg; end if;
end $pre$;

-- colisión de CLAVE NATURAL entre individuales (fusión silenciosa)
do $pre$
declare r record; msg text := '';
begin
  for r in
    with cand as (
      select pg_temp.clave_ind(coalesce(pm.display_name, pr.name), c.name) clave,
             coalesce(pm.display_name, pr.name) nombre
      from public.products pr
      join public.categories c on c.id = pr.category_id
      left join bot.producto_meta pm on pm.producto_id = pr.id
      where pr.is_active and c.audience = 'publico' and not coalesce(pm.oculto, false)
        and pg_temp.tiene_libre(pr.id)
    )
    select clave, count(*) n, string_agg(nombre, ' | ') nombres from cand group by clave having count(*) > 1
  loop msg := msg || format(E'  clave "%s" ← %s productos: %s\n', r.clave, r.n, r.nombres); end loop;
  if msg <> '' then raise exception E'Colisión de clave natural entre individuales:\n%', msg; end if;
end $pre$;

-- colisión de NOMBRE_BOT normalizado entre TODOS los producto-bot (cruzaría precios por nombre)
do $pre$
declare r record; msg text := '';
begin
  for r in
    with nombres as (
      select pg_temp.nk(g.nombre_bot) nk, g.nombre_bot nombre from bot.grupo g where not g.oculto
      union all
      select pg_temp.nk(coalesce(pm.display_name, pr.name)), coalesce(pm.display_name, pr.name)
      from public.products pr
      join public.categories c on c.id = pr.category_id
      left join bot.producto_meta pm on pm.producto_id = pr.id
      where pr.is_active and c.audience = 'publico' and not coalesce(pm.oculto, false)
        and pg_temp.tiene_libre(pr.id)
    )
    select nk, count(*) n, string_agg(distinct nombre, ' | ') nombres from nombres group by nk having count(*) > 1
  loop msg := msg || format(E'  "%s" ← %s: %s\n', r.nk, r.n, r.nombres); end loop;
  if msg <> '' then raise exception E'Colisión de nombre_bot normalizado (cruzaría precios):\n%', msg; end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- PURGA (repoblado completo → idempotencia real). cascade borra los items.
-- ---------------------------------------------------------------------------
delete from bot.producto;  -- FK on delete cascade borra bot.producto_item

-- ---------------------------------------------------------------------------
-- 1) GRUPOS → producto-bot (N variantes)
-- ---------------------------------------------------------------------------
do $mig$
declare
  g record; v_pid uuid; v_fam text; v_nicho text; v_sin text[]; v_cas text[];
  n_fam int; n_nicho int; n_items int;
begin
  for g in select * from bot.grupo where not oculto order by clave loop

    select count(*) into n_items
      from bot.grupo_item gi join public.product_variants v on v.id = gi.variante_id and v.is_active
     where gi.grupo_id = g.id and not gi.oculto;
    if n_items = 0 then raise notice 'SKIP grupo sin items vivos: %', g.nombre_bot; continue; end if;

    select count(distinct pg_temp.fam_de(p.id)), min(pg_temp.fam_de(p.id))
      into n_fam, v_fam
      from bot.grupo_item gi
      join public.product_variants pv on pv.id = gi.variante_id
      join public.products p on p.id = pv.product_id
     where gi.grupo_id = g.id;
    if coalesce(n_fam, 0) <> 1 then v_fam := 'otro'; end if;

    select count(distinct nn), min(nn) into n_nicho, v_nicho
      from (select pg_temp.nicho_de(p.id) nn
              from bot.grupo_item gi
              join public.product_variants pv on pv.id = gi.variante_id
              join public.products p on p.id = pv.product_id
             where gi.grupo_id = g.id and pg_temp.nicho_de(p.id) is not null) q;
    if coalesce(n_nicho, 0) <> 1 then v_nicho := null; end if;

    -- sinónimos/casos = del grupo + heredados de los absorbidos (dedupe NORMALIZADO)
    v_sin := pg_temp.dedup_norm(
      coalesce(g.sinonimos, '{}') ||
      coalesce((select array_agg(x) from (
        select unnest(pg_temp.sinef(pm.sinonimos, pm.display_name, p.name, pm.auto_sinonimo)) x
          from bot.grupo_item gi
          join public.product_variants pv on pv.id = gi.variante_id
          join public.products p on p.id = pv.product_id
          left join bot.producto_meta pm on pm.producto_id = p.id
         where gi.grupo_id = g.id
      ) s), '{}'));
    v_cas := pg_temp.dedup_norm(
      coalesce(g.casos_de_uso, '{}') ||
      coalesce((select array_agg(x) from (
        select unnest(coalesce(pm.casos_de_uso, '{}')) x
          from bot.grupo_item gi
          join public.product_variants pv on pv.id = gi.variante_id
          join public.products p on p.id = pv.product_id
          left join bot.producto_meta pm on pm.producto_id = p.id
         where gi.grupo_id = g.id
      ) s), '{}'));

    insert into bot.producto(clave, nombre_bot, familia, sinonimos, casos_de_uso, nicho, updated_at)
    values (g.clave, g.nombre_bot, v_fam, v_sin, v_cas, v_nicho, now())
    returning id into v_pid;

    insert into bot.producto_item(producto_id, variante_id, nombre_variante_bot, oculto)
    select v_pid, gi.variante_id, gi.nombre_variante_bot, gi.oculto
      from bot.grupo_item gi join public.product_variants v on v.id = gi.variante_id and v.is_active
     where gi.grupo_id = g.id;

  end loop;
end $mig$;

-- ---------------------------------------------------------------------------
-- 2) PRODUCTOS INDIVIDUALES → producto-bot (sólo variantes NO absorbidas)
-- ---------------------------------------------------------------------------
do $mig$
declare
  p record; v_pid uuid; v_clave text; v_nombre text; n_libres int; n_absorb int;
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
    select count(*) filter (where not pg_temp.absorbida(v.id) and not coalesce(vm.oculto, false)),
           count(*) filter (where pg_temp.absorbida(v.id))
      into n_libres, n_absorb
      from public.product_variants v
      left join bot.variante_meta vm on vm.variante_id = v.id
     where v.product_id = p.id and v.is_active;

    if n_libres = 0 then
      raise notice 'SKIP individual (0 variantes libres): %', coalesce(p.display_name, p.name);
      continue;
    end if;
    if n_absorb > 0 then
      raise notice 'REVISAR absorción parcial (% libres, % agrupadas): % — el display curado puede describir el producto completo',
        n_libres, n_absorb, coalesce(p.display_name, p.name);
    end if;

    v_nombre := coalesce(p.display_name, p.name);
    v_clave  := pg_temp.clave_ind(v_nombre, p.cat);

    insert into bot.producto(clave, nombre_bot, familia, sinonimos, casos_de_uso, nicho, updated_at)
    values (v_clave, v_nombre, pg_temp.fam_de(p.id),
            pg_temp.dedup_norm(pg_temp.sinef(p.sinonimos, p.display_name, p.name, p.auto_sinonimo)),
            pg_temp.dedup_norm(coalesce(p.casos_de_uso, '{}')),
            nullif(p.atributos->>'nicho', ''), now())
    returning id into v_pid;

    insert into bot.producto_item(producto_id, variante_id, nombre_variante_bot, oculto)
    select v_pid, v.id, vm.display_variante, false
      from public.product_variants v
      left join bot.variante_meta vm on vm.variante_id = v.id
     where v.product_id = p.id and v.is_active
       and not coalesce(vm.oculto, false) and not pg_temp.absorbida(v.id);

  end loop;
end $mig$;

-- ---------------------------------------------------------------------------
-- 3) ASSERT de integridad (aborta si algo quedó inconsistente)
-- ---------------------------------------------------------------------------
do $chk$
declare n int;
begin
  select count(*) into n
    from bot.producto p left join bot.familia f on f.clave = p.familia
   where p.familia is not null and f.clave is null;
  if n > 0 then raise exception 'producto-bot con familia inexistente en bot.familia: %', n; end if;

  select count(*) into n from bot.producto p
   where not exists (select 1 from bot.producto_item i where i.producto_id = p.id);
  if n > 0 then raise exception 'producto-bot SIN items (no debería): %', n; end if;
end $chk$;

commit;

-- ---------------------------------------------------------------------------
-- RESUMEN (seleccionable — el SQL editor NO muestra los RAISE NOTICE de arriba)
-- ---------------------------------------------------------------------------
select 'producto-bot' as metrica, count(*)::text as valor from bot.producto
union all select 'items',       count(*)::text from bot.producto_item
union all select 'sin familia', count(*)::text from bot.producto where familia is null
union all select 'por familia', string_agg(familia || ':' || n, ', ')
            from (select familia, count(*) n from bot.producto group by familia order by familia) f;

-- Absorción PARCIAL a revisar: productos public con algunas variantes agrupadas y otras sueltas
-- (el nombre curado del individual puede mentir sobre el remanente).
select pr.name as producto, c.name as categoria,
       count(*) filter (where absorbida)     as agrupadas,
       count(*) filter (where not absorbida) as libres
  from public.products pr
  join public.categories c on c.id = pr.category_id
  join lateral (
    select exists (
      select 1 from bot.grupo_item gi join bot.grupo g on g.id = gi.grupo_id and not g.oculto
       where gi.variante_id = v.id) as absorbida
    from public.product_variants v
    left join bot.variante_meta vm on vm.variante_id = v.id
    where v.product_id = pr.id and v.is_active and not coalesce(vm.oculto, false)
  ) vv on true
 where pr.is_active and c.audience = 'publico'
 group by pr.id, pr.name, c.name
having count(*) filter (where absorbida) > 0 and count(*) filter (where not absorbida) > 0
 order by pr.name;
