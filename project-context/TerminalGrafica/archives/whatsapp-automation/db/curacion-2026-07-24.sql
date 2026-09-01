-- ============================================================================
-- Curación 1c — barrido anti-hijack de la ronda 2 (2026-07-24)
-- Aprobación Martin 2026-07-24: cambios 1 (provisional), 2 y 4. El 3
-- (Ilustración Mate 250/300) se pospone (precios casi idénticos). Preguntas
-- TG 37-38 nuevas. Diagnóstico: plans/suite5-ronda2-fixes.md §barrido.
--
-- CONTEXTO: estos empates (kraft, folletos) hacen VISIBLE la ambigüedad para
-- que el futuro nodo "Aclarador" (2ª llamada LLM, en diseño) pueda preguntar el
-- eje que distingue o mostrar las opciones — en vez de tapar una en silencio.
-- Sin el empate, Get Precio resuelve a una sola por "gana el mejor rank" y el
-- Aclarador ni se entera de que había otra.
--
-- Resolución por CLAVE NATURAL (nombre+rubro normalizados): replayable en prod.
-- Transaccional. Después de aplicar: GET /webhook/refrescar-catalogo.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Sobre Inglés fantasma: OCULTAR (PROVISIONAL, pendiente pregunta TG 37)
--    Hay dos "Sobre Inglés": el real de Librería ($500) y este de Soportes
--    Especiales a $0. "sobre ingles" hoy matchea los dos (rank-1) → menú con un
--    ítem a $0. Se oculta hasta que TG confirme que es basura (pregunta 37);
--    si dijeran que es un producto vivo, se revierte (oculto=false).
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'sobre ingles'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'soportes especiales';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Sobre Ingles (Soportes Especiales)';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Sobre Ingles (Soportes Especiales)';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['sobre ingles','sobres clasicos','sobre formal','sobre para cartas']::text[], array['para enviar documentos','para cartas formales','para correspondencia empresarial']::text[], true, true, false, false, 'Sobre Ingles', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 2. Papel Kraft 300 gr: + sinónimo 'papel kraft' (hoy solo lo tiene el 130 gr
--    → gana rank-1 y el 300 nunca aparece). Con el empate, "papel kraft" →
--    ambiguo → el Aclarador pregunta el gramaje o muestra los dos.
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'papel kraft 300 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'soportes especiales';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Papel Kraft 300 Gr';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Papel Kraft 300 Gr';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['kraft 300','cartulina gruesa','papel kraft grueso','kraft grueso','papel kraft']::text[], array['para cajas','para embalaje resistente','para packaging premium']::text[], true, false, false, false, 'Papel Kraft 300 Gr', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 4. Folletos obra 75 color inkjet: PODAR el sinónimo 'folletos 10x15' (lo
--    tenía solo este → "folletos 10x15" ganaba rank-1 y tapaba a los otros dos
--    folletos). Sin él, "folletos 10x15" cae por NOMBRE (rank-2) en los tres →
--    empate → el Aclarador ofrece los tres. La resolución del inkjet sigue por
--    'volantes'/'folleto color'/'folleto inkjet'.
-- ---------------------------------------------------------------------------
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
    raise notice 'PODA Folletos inkjet — array vivo: %', (select sinonimos from bot.producto_meta where producto_id = ids[1]);
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, null, array['volantes','volantes pequenios','folletos pequeños','folleto inkjet','folleto color']::text[], array['para repartir','publicidad en mano','volante de promocion']::text[], true, false, false, true, 'Folletos 10x15 cm papel obra de 75 gr color inkjet', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

commit;

-- ---------------------------------------------------------------------------
-- Sanity (correr después de aplicar):
-- select p.name, pm.oculto from bot.producto_meta pm join public.products p on p.id = pm.producto_id
--   where p.name ilike 'sobre ingles';                    -- el de Soportes: oculto=true
-- select nombre_canonico, sinonimos from bot.taxonomia
--   where nombre_canonico ilike 'papel kraft%';           -- 130 y 300 AMBOS con 'papel kraft'
-- select nombre_canonico, sinonimos from bot.taxonomia
--   where nombre_canonico ilike 'folletos 10x15%';        -- inkjet SIN 'folletos 10x15'
-- ---------------------------------------------------------------------------
