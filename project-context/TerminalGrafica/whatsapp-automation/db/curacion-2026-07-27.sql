-- ============================================================================
-- Curación 2026-07-27 — nombres encontrables para la búsqueda por palabra (v8.3)
-- ============================================================================
-- Aprobado por Martin 2026-07-27: los 17 cambios propuestos, completos.
-- Diagnóstico: plans/v8-3-busqueda-por-palabra.md §3 (dos lentes Sonnet sobre el
-- export del 2026-07-27).
--
-- QUÉ RESUELVE. Los 6 papeles del rubro "Impresiones laser color" no tienen
-- NINGUNA palabra de pedido en su nombre: medido, "fotocopias a color" e
-- "imprimir hojas a color" no traían ni OBRA 80 GR ni OBRA 106 GR. Los displays
-- meten el sustantivo adentro del nombre, que es lo que matchea el rank 2 (LIKE
-- contiguo, NO mata competidores). Deliberadamente NO se agregan verbos como
-- sinónimo: el rank 1 es igualdad exacta y borra a los competidores — un
-- 'imprimir' ahí resolvería en silencio a un producto de $800 el A4.
--
-- LA TECNOLOGÍA SE CONSERVA a propósito: existe un gemelo inkjet al mismo
-- gramaje ("Impresión a4 Papel obra de 106 gr", otro precio). Sin "láser color"
-- en el nombre, los dos quedarían indistinguibles. Con el cambio, "papel obra
-- 106" pasa a traer los DOS -> ambiguo -> el bot pregunta, en vez de resolver
-- callado al caro. Ésa es la dirección segura.
--
-- VERIFICADO ANTES DE GENERAR (scratchpad, réplica del motor de Get Precio con
-- su semántica real): 433 consultas que hoy resuelven -> 0 pérdidas, 0 cambios
-- de rank, 0 colisiones rank-1 nuevas.
--
-- EFECTO DE CONDUCTA A VIGILAR: la consulta vaga "papel ilustración" pasa de 1
-- producto a 5 -> el bot pregunta en vez de resolver. Es más honesto (hoy
-- resuelve callado a folletos), pero es un cambio. Los pedidos completos como
-- "papel ilustración para 500 folletos" siguen resolviendo igual.
--
-- Los sinónimos se AGREGAN sobre los existentes, nunca se reemplaza la lista:
-- la verificación mostró que quitar uno solo rompe un funnel vivo.
--
-- Resolución por CLAVE NATURAL (nombre + rubro normalizados): replayable en prod.
-- Transaccional. Después de aplicar: GET /webhook/refrescar-catalogo (URL de
-- PRODUCCIÓN — en ejecución manual el staticData no persiste).
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. OBRA 106 GR  [Impresiones laser color]
--    display -> Impresiones láser color papel obra 106 gr
--  +sinónimos: obra 106 laser, laser color 106
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'obra 106 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones laser color';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'OBRA 106 GR';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'OBRA 106 GR';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Impresiones láser color papel obra 106 gr', array['papel obra 106 gramos','papel grueso blanco','papel impresion grueso','obra 106 laser','laser color 106']::text[], array['para impresiones durables','para documentos importantes en color','para afiches gruesos']::text[], true, false, false, false, 'OBRA 106 GR', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    raise notice 'OK: % -> display %, % sinonimos', 'OBRA 106 GR', 'Impresiones láser color papel obra 106 gr', 5;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 2. OBRA 80 GR  [Impresiones laser color]
--    display -> Impresiones láser color papel obra 80 gr
--  +sinónimos: obra 80 laser, laser color 80
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'obra 80 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones laser color';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'OBRA 80 GR';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'OBRA 80 GR';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Impresiones láser color papel obra 80 gr', array['papel obra 80 gramos','papel blanco 80gr','papel impresion blanco','obra 80 laser','laser color 80']::text[], array['para impresiones en color','para documentos a color','para afiches','para imprimir un currículum / cv']::text[], true, false, false, false, 'OBRA 80 GR', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    raise notice 'OK: % -> display %, % sinonimos', 'OBRA 80 GR', 'Impresiones láser color papel obra 80 gr', 5;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 3. Ilustración Brillo 150 gr  [Impresiones laser color]
--    display -> Impresiones láser color papel ilustración brillo 150 gr
--  +sinónimos: ilustracion brillo 150
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'ilustracion brillo 150 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones laser color';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Ilustración Brillo 150 gr';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Ilustración Brillo 150 gr';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Impresiones láser color papel ilustración brillo 150 gr', array['papel 150 gramos brillo','papel foto brillo','ilustracion brillo 150']::text[], array['para fotos en color','para trabajos fotograficos','para impresiones brillantes']::text[], true, false, false, false, 'Ilustración Brillo 150 gr', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    raise notice 'OK: % -> display %, % sinonimos', 'Ilustración Brillo 150 gr', 'Impresiones láser color papel ilustración brillo 150 gr', 3;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 4. Ilustración Mate 250 gr  [Impresiones laser color]
--    display -> Impresiones láser color papel ilustración mate 250 gr
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'ilustracion mate 250 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones laser color';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Ilustración Mate 250 gr';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Ilustración Mate 250 gr';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Impresiones láser color papel ilustración mate 250 gr', array['ilustracion mate','papel mate 250gr','papel de foto','papel para fotos']::text[], array['para un portfolio','para mostrar trabajos','para un catalogo']::text[], true, false, false, false, 'Ilustración Mate 250 gr', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    raise notice 'OK: % -> display %, % sinonimos', 'Ilustración Mate 250 gr', 'Impresiones láser color papel ilustración mate 250 gr', 4;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 5. Ilustración Mate 300 gr  [Impresiones laser color]
--    display -> Impresiones láser color papel ilustración mate 300 gr
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'ilustracion mate 300 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones laser color';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Ilustración Mate 300 gr';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Ilustración Mate 300 gr';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Impresiones láser color papel ilustración mate 300 gr', array['papel ilustracion mate 300','papel grueso mate','papel artístico mate','papel 300 gramos']::text[], array['para trabajos de arte','para impresiones premium','para fotos mate alta calidad']::text[], true, false, false, false, 'Ilustración Mate 300 gr', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    raise notice 'OK: % -> display %, % sinonimos', 'Ilustración Mate 300 gr', 'Impresiones láser color papel ilustración mate 300 gr', 4;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 6. Opalina Obra 250 gr  [Impresiones laser color]
--    display -> Impresiones láser color papel opalina 250 gr
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'opalina obra 250 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones laser color';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Opalina Obra 250 gr';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Opalina Obra 250 gr';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Impresiones láser color papel opalina 250 gr', array['opalina 250 gramos','papel opalina','opalina blanca','papel mate 250']::text[], array['para tarjetas especiales','para documentos premium','para papeleria fina']::text[], true, false, false, false, 'Opalina Obra 250 gr', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    raise notice 'OK: % -> display %, % sinonimos', 'Opalina Obra 250 gr', 'Impresiones láser color papel opalina 250 gr', 4;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 7. A5 ILUST. MATE 250 GR  [LASER]
--    display -> Impresiones láser papel ilustración mate 250 gr A5
--  +sinónimos: papel ilustracion mate a5, ilustracion mate a5
--    variante 'A4' -> 'A5' (el nombre del producto y el atributo curado dicen a5: dos fuentes contra una)
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'a5 ilust. mate 250 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'laser';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'A5 ILUST. MATE 250 GR';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'A5 ILUST. MATE 250 GR';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Impresiones láser papel ilustración mate 250 gr A5', array['papel ilustracion mate','papel 250 gr mate','papel ilustrado','papel ilustracion mate a5','ilustracion mate a5']::text[], array['para impresiones de fotos','para trabajos artisticos','para portadas']::text[], true, false, false, false, 'A5 ILUST. MATE 250 GR', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    raise notice 'OK: % -> display %, % sinonimos', 'A5 ILUST. MATE 250 GR', 'Impresiones láser papel ilustración mate 250 gr A5', 5;
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'A5 ILUST. MATE 250 GR', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'A5 ILUST. MATE 250 GR', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, display_variante, nombre_origen, oculto, updated_at)
      values (ids[1], 'A5', 'A4', false, now())
      on conflict (variante_id) do update set display_variante = excluded.display_variante, nombre_origen = excluded.nombre_origen, oculto = excluded.oculto, updated_at = excluded.updated_at;
      raise notice 'OK: variante % / % -> %', 'A5 ILUST. MATE 250 GR', 'A4', 'A5';
    end if;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 8. OPP Mate/Holografico/Plata/Crystal/Glitter/Kraft  [Soportes Especiales]
--    display -> OPP mate, holográfico, plata, cristal, glitter o kraft
--  +sinónimos: opp holografico, opp glitter, opp plata, opp cristal, opp kraft, plastico metalizado
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'opp mate/holografico/plata/crystal/glitter/kraft'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'soportes especiales';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'OPP Mate/Holografico/Plata/Crystal/Glitter/Kraft';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'OPP Mate/Holografico/Plata/Crystal/Glitter/Kraft';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'OPP mate, holográfico, plata, cristal, glitter o kraft', array['opp mate','opp','opp holografico','opp glitter','opp plata','opp cristal','opp kraft','plastico metalizado']::text[], array['para embalaje','para productos de regalo','para acabado especial']::text[], true, false, false, false, 'OPP Mate/Holografico/Plata/Crystal/Glitter/Kraft', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    raise notice 'OK: % -> display %, % sinonimos', 'OPP Mate/Holografico/Plata/Crystal/Glitter/Kraft', 'OPP mate, holográfico, plata, cristal, glitter o kraft', 8;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 9. Folios a4/Oficio  [Libreria]
--    display -> Folios A4 / Oficio
--  +sinónimos: funda plastica, folio transparente
-- ---------------------------------------------------------------------------
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
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Folios A4 / Oficio', array['folio','folios','funda plastica','folio transparente']::text[], array['para imprimir documentos','para fotocopias','para notas y cartas']::text[], true, false, false, false, 'Folios a4/Oficio', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    raise notice 'OK: % -> display %, % sinonimos', 'Folios a4/Oficio', 'Folios A4 / Oficio', 4;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 10. Anillado Metálico a4/a3  [Taller]
--    display -> Anillado metálico A4/A3
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado metalico a4/a3'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Anillado Metálico a4/a3';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Anillado Metálico a4/a3';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Anillado metálico A4/A3', array['anillado metalico','anillo de metal','anillado de metal','anilla metalica']::text[], array['para un catalogo','para un documento importante']::text[], true, false, false, false, 'Anillado Metálico a4/a3', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    raise notice 'OK: % -> display %, % sinonimos', 'Anillado Metálico a4/a3', 'Anillado metálico A4/A3', 4;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 11. Anillado Plastico a3  [Taller]
--    display -> Anillado plástico A3
--    variante 'A4' -> 'A3' (el nombre del producto y el atributo curado dicen a3: dos fuentes contra una)
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado plastico a3'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Anillado Plastico a3';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Anillado Plastico a3';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Anillado plástico A3', array['espiralar','anillado de plastico','anillo plastico','espiralado','anilla de plastico','anillado plastico a3']::text[], array['para un informe','para un proyecto']::text[], true, false, false, false, 'Anillado Plastico a3', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    raise notice 'OK: % -> display %, % sinonimos', 'Anillado Plastico a3', 'Anillado plástico A3', 6;
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active
      and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'a4'
      and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Anillado Plastico a3', 'A4';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Anillado Plastico a3', 'A4';
    else
      insert into bot.variante_meta as vm (variante_id, display_variante, nombre_origen, oculto, updated_at)
      values (ids[1], 'A3', 'A4', false, now())
      on conflict (variante_id) do update set display_variante = excluded.display_variante, nombre_origen = excluded.nombre_origen, oculto = excluded.oculto, updated_at = excluded.updated_at;
      raise notice 'OK: variante % / % -> %', 'Anillado Plastico a3', 'A4', 'A3';
    end if;
  end if;
end $curador$;

commit;

-- ============================================================================
-- VERIFICACIÓN (correr después del commit; solo SELECT)
-- ============================================================================
-- 1) Los 11 displays quedaron, y los sinónimos no se perdieron:
-- select t.nombre_canonico, cardinality(t.sinonimos) as n_sinonimos
--   from bot.taxonomia t
--  where t.nombre_canonico like 'Impresiones láser%'
--     or t.nombre_canonico like 'Anillado%'
--     or t.nombre_canonico like 'OPP %'
--     or t.nombre_canonico like 'Folios%'
--  order by 1;
--
-- 2) Las dos variantes contradichas:
-- select t.nombre_canonico, v.variante
--   from bot.variantes v join bot.taxonomia t using (producto_id)
--  where t.nombre_canonico in ('Anillado plástico A3', 'Impresiones láser papel ilustración mate 250 gr A5');
--   -- esperado: A3 y A5 (antes las dos decían A4)
--
-- 3) El par que ahora empata (la dirección segura):
-- select nombre_canonico from bot.taxonomia
--  where translate(lower(nombre_canonico), 'áéíóúñ', 'aeioun') like '%papel obra 106%';
--   -- esperado: 2 filas (la inkjet y la láser color)
