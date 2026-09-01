-- ============================================================================
-- Curación 2026-07-24b — 3 cambios ya decididos por Martin (respuestas 2026-07-24)
--   1. Ocultar los "Papel Vegetal x10" a $0 (preguntas 8: "si están así, ocultalos").
--   2. Promo Inmobiliarias: por_pack=false ($15.000 es POR CARTEL llevando 6,
--      pregunta 35) + display ajustado para que el número lea por cartel.
--   3. Anillado plástico a4/oficio: sacar los sinónimos de urgencia y neutralizar
--      casos_de_uso — "el anillado es anillado y ya, nada de prometer tiempo"
--      (pregunta 38). Aplica al visible (24 hs) y a los ocultos (48/72/96 hs), así
--      ninguna consulta con nombre de plazo resuelve (verificado: worst-case sin_match).
--
-- Verificación (scratchpad verify-curacion.js, semántica real de Get Precio):
--   "papel vegetal a4/a3/velina/papel calco" → RESUELVE a "Vegetal" ($1000/$2000)
--       (antes ambiguo con los x10 $0; ocultarlos DESAMBIGUA, efecto lateral bueno).
--   "anillado" → AMBIGUO(3) → menú (metálico / plástico a3 / plástico a4-oficio).
--   "espiralar"/"espiralado" → siguen resolviendo (se conservan).
--   "anillado urgente / express / 2 dias / semana / sin apuro" → sin_match (deseado).
--
-- Resolución por CLAVE NATURAL (nombre+rubro normalizados): replayable en prod.
-- Transaccional. Después de aplicar: GET /webhook/refrescar-catalogo.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1a. Papel Vegetal a4 x 10 unid ($0) → OCULTAR
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'papel vegetal a4 x 10 unid'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'libreria';
  if ids is null then
    raise notice 'SKIPPED (no encontrado o renombrado): %', 'Papel Vegetal a4 x 10 unid';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Papel Vegetal a4 x 10 unid';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['papel vegetal a4','velina a4','papel calco','papel transparente a4']::text[], array['para calcar dibujos','para trabajos de escuela','para trazar']::text[], true, true, false, true, 'Papel Vegetal a4 x 10 unid', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 1b. Papel Vegetal a3/ Oficio x 10 unid ($0) → OCULTAR
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'papel vegetal a3/ oficio x 10 unid'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'libreria';
  if ids is null then
    raise notice 'SKIPPED (no encontrado o renombrado): %', 'Papel Vegetal a3/ Oficio x 10 unid';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Papel Vegetal a3/ Oficio x 10 unid';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['papel vegetal a3','velina a3','papel calco a3','papel transparente grande']::text[], array['para trabajos de arquitectura','para calcar grandes','para planos']::text[], true, true, false, true, 'Papel Vegetal a3/ Oficio x 10 unid', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 2. Promoción Inmobiliarias → por_pack=false (el $15.000 es POR CARTEL, no por
--    el pack de 6) + display para que el número lea por cartel.
--    OJO Martin: revisá el display antes de aplicar; si la promo NO exige 6,
--    decime y saco "(llevando 6)". La cuenta de 6× / mínimo es lógica del
--    cotizador, no de la curación.
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'promocion inmobiliarias 6 carteles 1 x 0.65 mt'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'carteleria en plastico corrugado';
  if ids is null then
    raise notice 'SKIPPED (no encontrado o renombrado): %', 'Promocion Inmobiliarias 6 carteles';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Promocion Inmobiliarias 6 carteles';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Promoción para inmobiliarias (cartel de 1 × 0,65 m, llevando 6)', array['cartel inmobiliario','senial inmobiliaria','carteles para vender casa','cartel de venta','carteles paquete 6','promocion inmobiliarias']::text[], array['para un inmueble','para vender propiedad','cartel en la calle']::text[], true, false, false, false, 'Promocion Inmobiliarias 6 carteles 1 x 0.65 mt', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 3a. Anillado Plastico a4/oficio 24 hs (VISIBLE) → sacar urgencia
--     sinónimos: solo espiralar/espiralado | casos: neutrales
--     display se conserva ("Anillado plástico a4/oficio")
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado plastico a4/oficio 24 hs'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (no encontrado o renombrado): %', 'Anillado Plastico a4/oficio 24 hs';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Anillado Plastico a4/oficio 24 hs';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Anillado plástico a4/oficio', array['espiralar','espiralado']::text[], array['para un informe','para un proyecto']::text[], true, false, false, false, 'Anillado Plastico a4/oficio 24 hs', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 3b/c/d. Anillado 48/72/96 hs (OCULTOS) → sacar urgencia (insurance: si oculto
--         no excluyera del matching, igual caen a sin_match). Se conservan oculto=true.
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado plastico a4/oficio 48 hs'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then raise notice 'SKIPPED: %', 'Anillado 48 hs';
  elsif array_length(ids, 1) > 1 then raise notice 'SKIPPED ambigua: %', 'Anillado 48 hs';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['espiralar','espiralado']::text[], array['para un informe','para un proyecto']::text[], true, true, false, false, 'Anillado Plastico a4/oficio 48 hs', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado plastico a4/oficio 72 hs'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then raise notice 'SKIPPED: %', 'Anillado 72 hs';
  elsif array_length(ids, 1) > 1 then raise notice 'SKIPPED ambigua: %', 'Anillado 72 hs';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['espiralar','espiralado']::text[], array['para un informe','para un proyecto']::text[], true, true, false, false, 'Anillado Plástico a4/oficio 72 hs', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado plastico a4/oficio 96 hs'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then raise notice 'SKIPPED: %', 'Anillado 96 hs';
  elsif array_length(ids, 1) > 1 then raise notice 'SKIPPED ambigua: %', 'Anillado 96 hs';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['espiralar','espiralado']::text[], array['para un informe','para un proyecto']::text[], true, true, false, false, 'Anillado Plástico a4/oficio 96 hs', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

commit;
