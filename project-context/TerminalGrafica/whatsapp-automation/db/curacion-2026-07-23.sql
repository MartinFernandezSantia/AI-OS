-- ============================================================================
-- Curación pasada 1 — generada por la skill /tg-curar-catalogo (2026-07-23)
-- Export base: 2026-07-23T18:29:01.435887+00:00 (db/curador-export.sql)
-- Aprobación: Martin 2026-07-23 (cambios 1-22 + enmiendas técnicas, ver
-- db/curacion-2026-07-23.md). Resolución por CLAVE NATURAL (nombre+rubro
-- normalizados; variantes por nombre+color): replayable en prod. Filas
-- renombradas/ambiguas se saltean con NOTICE — revisar el output.
-- Transaccional. Después de aplicar: TOGGLE del workflow (cache de catálogo).
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- FLAGS por_pack (cambios 1-7)
-- ---------------------------------------------------------------------------

-- Porta Banner 2 velas: por_pack true → false (es UN soporte, no un pack)
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'porta banner 2 velas 0.90 x 1.90 mt'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Porta Banner 2 velas 0.90 x 1.90 mt';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Porta Banner 2 velas 0.90 x 1.90 mt';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['porta banner de 2 velas','portabanner 2 velas','banner de pie 2 patas','soporte banner','base para banner']::text[], array['para una feria','para un evento','para el local','para un stand']::text[], true, false, false, false, 'Porta Banner 2 velas 0.90 x 1.90 mt', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Porta Banner Roll up: por_pack true → false (las cifras son dimensiones)
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'porta banner roll up 0..85 x 2.00 mt'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Porta Banner Roll up 0..85 x 2.00 mt';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Porta Banner Roll up 0..85 x 2.00 mt';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Porta Banner Roll up 0.85 x 2.00 mt', array['roll up','banner enrollable','portabanner roll','banner enrollable 0.85','soporte enrollable']::text[], array['para una feria','para un stand','para guardar facil','publicidad portable']::text[], true, false, false, false, 'Porta Banner Roll up 0..85 x 2.00 mt', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Folletos ilustración 150 gr: por_pack false → true (variantes x500-x3000 = pack)
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'folletos 10x15 cm papel ilustracion brillo 150 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Folletos 10x15 cm papel ilustracion brillo 150 gr';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Folletos 10x15 cm papel ilustracion brillo 150 gr';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['volantes','hojas volantes','flyers 10x15','folleto ilustracion']::text[], array['para promocionar','para repartir','para publicidad','para local']::text[], true, false, false, true, 'Folletos 10x15 cm papel ilustracion brillo 150 gr', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Folletos obra 75 gr b/n: por_pack false → true
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'folletos 10x15 cm papel obra de 75 gr b/n'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Folletos 10x15 cm papel obra de 75 gr b/n';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Folletos 10x15 cm papel obra de 75 gr b/n';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['volantes','folletos obra','hojas 10x15','folletos blanco y negro','volantes bn']::text[], array['para publicidad economica','para repartir','para promocion simple']::text[], true, false, false, true, 'Folletos 10x15 cm papel obra de 75 gr b/n', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Folletos obra 75 gr color inkjet: por_pack false → true
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'folletos 10x15 cm papel obra de 75 gr color inkjet'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'piezas graficas/productos';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Folletos 10x15 cm papel obra de 75 gr color inkjet';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Folletos 10x15 cm papel obra de 75 gr color inkjet';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['volantes','volantes pequenios','folletos 10x15','folletos pequeños','folleto inkjet','folleto color']::text[], array['para repartir','publicidad en mano','volante de promocion']::text[], true, false, false, true, 'Folletos 10x15 cm papel obra de 75 gr color inkjet', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Perforaciones: por_pack false → true (variantes 500/1000 = tandas)
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'perforaciones'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Perforaciones';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Perforaciones';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['perforador','agujeros','perforaciones','hoyo para broche']::text[], '{}'::text[], true, false, false, true, 'Perforaciones', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Puntas Redondeadas: por_pack false → true (variantes 100/500/1000 = tandas)
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'puntas redondeadas'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Puntas Redondeadas';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Puntas Redondeadas';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['puntas redondeadas','punta redonda','esquinas redondeadas','redondear puntas']::text[], '{}'::text[], true, false, false, true, 'Puntas Redondeadas', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- ANILLADOS I14 (cambios 8-9): línea única sin plazo, los 4 valen $2.400
-- ---------------------------------------------------------------------------

-- Anillado 48 hs: oculto (el plazo vuelve 100% al equipo)
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado plastico a4/oficio 48 hs'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Anillado Plastico a4/oficio 48 hs';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Anillado Plastico a4/oficio 48 hs';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['anillado 2 dias','anillo plastico entrega','espiralar','anillado rapido','espiralado','anillado plastico 48 horas']::text[], array['para rapido','entrega en 2 dias']::text[], true, true, false, false, 'Anillado Plastico a4/oficio 48 hs', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Anillado 72 hs: oculto
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado plastico a4/oficio 72 hs'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Anillado Plástico a4/oficio 72 hs';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Anillado Plástico a4/oficio 72 hs';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['espiralar','anilla plastica entrega','anillado plastico 72 horas','anillado semana','espiralado','anillado 3 dias']::text[], array['para la semana','sin prisa']::text[], true, true, false, false, 'Anillado Plástico a4/oficio 72 hs', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Anillado 96 hs: oculto
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado plastico a4/oficio 96 hs'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Anillado Plástico a4/oficio 96 hs';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Anillado Plástico a4/oficio 96 hs';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['espiralar','anillado sin apuro','anillado 4 dias','espiralado','anillado plastico 96 horas','anilla plastica lento']::text[], array['sin apuro','entrega lenta']::text[], true, true, false, false, 'Anillado Plástico a4/oficio 96 hs', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Anillado 24 hs: display sin plazo (queda como LA línea de anillado a4/oficio)
-- [display: Anillado Plastico a4/oficio 24 hs → Anillado plástico a4/oficio]
-- La variante única no se toca: el render usa el nombre del producto (regla
-- variante única) y Get Precio tiene el fallback mono-variante.
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado plastico a4/oficio 24 hs'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Anillado Plastico a4/oficio 24 hs';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Anillado Plastico a4/oficio 24 hs';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Anillado plástico a4/oficio', array['espiralar','anillado express','anillo plastico ya','anillado plastico 24 horas','espiralado','anillado urgente']::text[], array['para urgente','entrega al dia siguiente']::text[], true, false, false, false, 'Anillado Plastico a4/oficio 24 hs', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- SINÓNIMOS (cambios 10-15; el 11 enmendado a duplicación deliberada)
-- ---------------------------------------------------------------------------

-- Folios: poda hojas a4 / papeles a4 / papel bond (cotizaban folios a $500 c/u)
-- Array vivo antes de pisar: {hojas a4, papeles a4, folio, folios, papel bond}
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'folios a4/oficio'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'libreria';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Folios a4/Oficio';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Folios a4/Oficio';
  else
    pid := ids[1];
    raise notice 'PODA Folios — array vivo: %', (select sinonimos from bot.producto_meta where producto_id = ids[1]);
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['folio','folios']::text[], array['para imprimir documentos','para fotocopias','para notas y cartas']::text[], true, false, false, false, 'Folios a4/Oficio', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Vegetal (por hoja): ALTA duplicación deliberada de 'papel vegetal a4/a3'
-- (rank-1 doble con los packs x10 → ambiguo honesto → menú; la poda sola era
-- no-op: el pack retenía la consulta por rank 2 contains)
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'vegetal'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'soportes especiales';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Vegetal';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Vegetal';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['papel vegetal','velina','papel transparente','papel calco','papel vegetal a4','papel vegetal a3']::text[], array['para calcar','para dibujos que se ven atras','para trabajos de diseño']::text[], true, false, false, false, 'Vegetal', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Vinilo Mate: poda 'vinil' (Tier B — misma anatomía que 'lona mate')
-- Array vivo antes de pisar: {vinilo mate, vinil mate, vinilo sin brillo, vinil}
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'vinilo mate'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'solvente';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Vinilo Mate';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Vinilo Mate';
  else
    pid := ids[1];
    raise notice 'PODA Vinilo Mate — array vivo: %', (select sinonimos from bot.producto_meta where producto_id = ids[1]);
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['vinilo mate','vinil mate','vinilo sin brillo']::text[], array['para imprimir en lona','para cubrir lonas','acabado mate']::text[], true, false, false, false, 'Vinilo Mate', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Corrugado: poda 'impresion montada' (coin-flip con Montado sobre cartón)
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'impresion exterior / montado sobre plastico corrugado'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'carteleria en plastico corrugado';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Impresión exterior / montado sobre plástico corrugado';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Impresión exterior / montado sobre plástico corrugado';
  else
    pid := ids[1];
    raise notice 'PODA Corrugado — array vivo: %', (select sinonimos from bot.producto_meta where producto_id = ids[1]);
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['cartel plastico corrugado','carteleria en plastico corrugado','cartel policarbonato','cartel coroplast']::text[], array['para carteleria','para propaganda','para publicidad exterior','para evento']::text[], true, false, false, false, 'Impresión exterior / montado sobre plástico corrugado', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Papel 130 Recubierto: poda 'papel especial' (término de clase; NO toca el
-- backstop papel_especial del cotizador — solo comparten nombre)
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'papel 130 gr recubierto / encapado'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'ploteados';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Papel 130 gr Recubierto / Encapado';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Papel 130 gr Recubierto / Encapado';
  else
    pid := ids[1];
    raise notice 'PODA Papel 130 — array vivo: %', (select sinonimos from bot.producto_meta where producto_id = ids[1]);
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['papel recubierto 130 gr','papel encapado','papel brillante 130']::text[], array['para impresiones de alta calidad','para catálogos profesionales','para trabajos de lujo']::text[], true, false, false, false, 'Papel 130 gr Recubierto / Encapado', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Plastificado A4: poda 'protegido' (término de intención, rank-1 único al A4)
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'plastificado a4'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'plastificado';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Plastificado A4';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Plastificado A4';
  else
    pid := ids[1];
    raise notice 'PODA Plastificado A4 — array vivo: %', (select sinonimos from bot.producto_meta where producto_id = ids[1]);
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['enmicado','hoja plastificada','papel plastificado hoja','enmicar','plastificado a4']::text[], array['para carteles que se tocan mucho','para material que se moja','para tarjetas de menu']::text[], true, false, false, false, 'Plastificado A4', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- DISPLAYS (cambios 16-21; el 16 con alta técnica de sinónimo)
-- ---------------------------------------------------------------------------

-- Promo Inmobiliarias  [display: → Promoción para inmobiliarias (6 carteles de 1 × 0,65 m)]
-- + sinónimo 'promocion inmobiliarias': el LIKE de rank 2 es contiguo y el
-- «para» del display rompía esa consulta (verificado contra Get Precio v7).
-- por_pack queda true, gated por pregunta 35.
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'promocion inmobiliarias 6 carteles 1 x 0.65 mt'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'carteleria en plastico corrugado';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Promocion Inmobiliarias 6 carteles 1 x 0.65 mt';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Promocion Inmobiliarias 6 carteles 1 x 0.65 mt';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Promoción para inmobiliarias (6 carteles de 1 × 0,65 m)', array['cartel inmobiliario','senial inmobiliaria','carteles para vender casa','cartel de venta','carteles paquete 6','promocion inmobiliarias']::text[], array['para un inmueble','para vender propiedad','cartel en la calle']::text[], true, false, false, true, 'Promocion Inmobiliarias 6 carteles 1 x 0.65 mt', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Trazado/Troquelado  [display: → Trazado/troquelado manual de papel]
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'trazado/troquelado manual de papel.'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Trazado/Troquelado Manual de papel.';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Trazado/Troquelado Manual de papel.';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Trazado/troquelado manual de papel', array['troquelado manual','trazado','corte especial','troquelado a mano']::text[], '{}'::text[], true, false, false, false, 'Trazado/Troquelado Manual de papel.', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Emblocados  [display: → Emblocados con cartón (lado corto o largo)]
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'emblocados (lado corto o largo) c/carton.'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Emblocados (lado corto o largo) C/cartón.';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Emblocados (lado corto o largo) C/cartón.';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Emblocados con cartón (lado corto o largo)', array['bloques de papel','papel emblocado','libretitas emblocadas']::text[], '{}'::text[], true, false, false, false, 'Emblocados (lado corto o largo) C/cartón.', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Montado sobre carton  [display: → Montado sobre cartón] (solo acento)
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'montado sobre carton'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'encartonado';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Montado sobre carton';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Montado sobre carton';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Montado sobre cartón', array['cuadro montado','papel sobre carton','lámina sobre carton','cartón montado','encartonado']::text[], array['para posters de pared','para cuadros','para láminas que se cuelgan']::text[], true, false, false, false, 'Montado sobre carton', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Medicina  [display: → Impresión de módulos/apuntes de medicina] (gramática;
-- sigue neutro: no afirma formato — pregunta 34 vigente). por_pagina true se preserva.
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'impresion de modulos/apuntes medicina'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresion medicina (precio especial)';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Impresión de Módulos/Apuntes medicina';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Impresión de Módulos/Apuntes medicina';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Impresión de módulos/apuntes de medicina', array['apuntes de medicina','modulos medicina','modulos de medicina','modulos carrera medicina','impresion medicina']::text[], array['para la facultad de medicina']::text[], true, false, true, false, 'Impresión de Módulos/Apuntes medicina', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Armado de Revistas: display de la variante 'Abrochado de Revistas' →
-- 'plegado, refilado y 2 ganchos' (repetía el NOMBRE de otro producto con otro
-- precio: $2.000 acá vs $1.000 el Abrochado real). producto_meta se pinea igual.
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'armado de revistas. plegado/refilado y 2 ganchos'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Armado de Revistas. Plegado/refilado y 2 ganchos';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Armado de Revistas. Plegado/refilado y 2 ganchos';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['armado de revistas','armado y plegado','revistas armadas','plegado y grapado']::text[], '{}'::text[], true, false, false, false, 'Armado de Revistas. Plegado/refilado y 2 ganchos', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'abrochado de revistas' and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Armado de Revistas. Plegado/refilado y 2 ganchos', 'Abrochado de Revistas';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Armado de Revistas. Plegado/refilado y 2 ganchos', 'Abrochado de Revistas';
    else
      insert into bot.variante_meta as vm (variante_id, display_variante, nombre_origen, oculto, updated_at)
      values (ids[1], 'plegado, refilado y 2 ganchos', 'Abrochado de Revistas', false, now())
      on conflict (variante_id) do update set display_variante = excluded.display_variante, nombre_origen = excluded.nombre_origen, oculto = excluded.oculto, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- RUBROS (cambio 22 — solo acentos/caso, normalización idéntica = cero cambio
-- de matching; headers citables bien escritos)
-- ---------------------------------------------------------------------------
do $curador$
declare cid uuid; ids uuid[]; r record;
begin
  for r in
    select * from (values
      ('carteleria en plastico corrugado', 'Cartelería en plástico corrugado'),
      ('carteleria en pvc',                'Cartelería en PVC'),
      ('libreria',                         'Librería'),
      ('impresiones laser color',          'Impresiones láser color'),
      ('impresion uv',                     'Impresión UV')
    ) as t(clave, display)
  loop
    select array_agg(c.id) into ids from public.categories c
    where c.audience = 'publico' and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = r.clave;
    if ids is null then
      raise notice 'SKIPPED (rubro no encontrado o renombrado): %', r.clave;
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (rubro ambiguo por clave natural, % filas): %', array_length(ids, 1), r.clave;
    else
      insert into bot.rubro_meta (categoria_id, display_name)
      values (ids[1], r.display)
      on conflict (categoria_id) do update set display_name = excluded.display_name;
    end if;
  end loop;
end $curador$;

commit;

-- ---------------------------------------------------------------------------
-- Sanity (correr después de aplicar):
-- select count(*) from bot.producto_meta where oculto;                       -- esperado: 3 (anillados 48/72/96)
-- select display_name, por_pack from bot.producto_meta pm
--   join public.products p on p.id = pm.producto_id
--   where p.name ilike '%inmobiliarias%';                                    -- display nuevo + por_pack true
-- select count(*) from bot.producto_meta where por_pack;                     -- esperado: 13 (10 actuales − 2 porta banners + 5 altas)
-- select nombre_canonico from bot.taxonomia where nombre_canonico ilike '%anillado%';  -- 1 solo plástico a4/oficio (sin plazo) + a3 + metálico
-- ---------------------------------------------------------------------------
