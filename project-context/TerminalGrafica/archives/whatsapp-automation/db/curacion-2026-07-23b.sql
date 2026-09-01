-- ============================================================================
-- Curación pasada 1b — fixes de catálogo de la ronda 2 suite-5 (2026-07-23)
-- Acompaña al paquete r6 del workflow (plans/suite5-ronda2-fixes.md).
--
-- QUÉ ARREGLA: variantes ÚNICAS cuyo nombre parece un producto. Ese nombre:
--   (a) se filtraba al catálogo del LLM como material de fusión ("Impresion a4
--       s/f color" → el LLM inventaba el producto "Impresiones a4 s/f color",
--       casos 4/14/18 de la ronda 2);
--   (b) aparecía en menús y renders con info que no corresponde ("Anillado
--       Plastico a4/oficio 24 hs" → el bot mostraba el plazo, caso 13; la
--       decisión I14 de la pasada 1 era que el plazo vuelve 100% al equipo);
--   (c) rompía el match de Get Precio (la pasada 1 asumió un fallback
--       mono-variante que en realidad exigía variante no-alfanumérica —
--       caso 7: menú → "1" → 0 filas → email). El workflow r6 relaja ese
--       fallback; esto lo hace robusto también a nivel de datos.
-- display_variante '.' = variante única sin nombre: el catálogo publica
-- "única", el menú y el render usan el nombre del producto.
--
-- Resolución por CLAVE NATURAL (replayable en prod). Filas renombradas o
-- ambiguas se saltean con NOTICE. Transaccional.
-- Después de aplicar: GET /webhook/refrescar-catalogo (purga el cache).
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Anillado 24 hs: variante única '.' (el "24 hs" ya no se muestra en menús
--    ni renders; los sinónimos "anillado express/urgente" siguen resolviendo).
--    r6-review H4: además se podan del producto_meta el sinónimo "anillado
--    plastico 24 horas" y los usos "para urgente"/"entrega al dia siguiente" —
--    el catálogo del LLM afirmaba un plazo que la decisión I14 devolvió al
--    equipo (el System Prompt lo prohíbe, pero no hay que darle el material).
-- ---------------------------------------------------------------------------
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
    values (pid, 'Anillado plástico a4/oficio', array['espiralar','anillado express','anillo plastico ya','espiralado','anillado urgente']::text[], '{}'::text[], true, false, false, false, 'Anillado Plastico a4/oficio 24 hs', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'anillado plastico a4/oficio 24 hs' and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Anillado Plastico a4/oficio 24 hs', 'Anillado Plastico a4/oficio 24 hs';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Anillado Plastico a4/oficio 24 hs', 'Anillado Plastico a4/oficio 24 hs';
    else
      insert into bot.variante_meta as vm (variante_id, display_variante, nombre_origen, oculto, updated_at)
      values (ids[1], '.', 'Anillado Plastico a4/oficio 24 hs', false, now())
      on conflict (variante_id) do update set display_variante = excluded.display_variante, nombre_origen = excluded.nombre_origen, oculto = excluded.oculto, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 2. Medicina: variante única '.' — "Impresion a4 s/f color" era el material
--    de fusión de los 0-filas de la ronda 2 (el formato real sigue gateado por
--    la pregunta TG 34; el precio especial ahora además tiene guard de nicho
--    en el workflow: solo sale si el cliente dijo "medicina")
-- ---------------------------------------------------------------------------
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
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'impresion a4 s/f color' and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Impresión de Módulos/Apuntes medicina', 'Impresion a4 s/f color';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Impresión de Módulos/Apuntes medicina', 'Impresion a4 s/f color';
    else
      insert into bot.variante_meta as vm (variante_id, display_variante, nombre_origen, oculto, updated_at)
      values (ids[1], '.', 'Impresion a4 s/f color', false, now())
      on conflict (variante_id) do update set display_variante = excluded.display_variante, nombre_origen = excluded.nombre_origen, oculto = excluded.oculto, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 3. Lona Mate: variante única '.' (se llamaba igual que el producto; el menú
--    del caso 12 la mostraba duplicada)
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'lona mate'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'solvente';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Lona Mate';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Lona Mate';
  else
    pid := ids[1];
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'lona mate' and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Lona Mate', 'Lona Mate';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Lona Mate', 'Lona Mate';
    else
      insert into bot.variante_meta as vm (variante_id, display_variante, nombre_origen, oculto, updated_at)
      values (ids[1], '.', 'Lona Mate', false, now())
      on conflict (variante_id) do update set display_variante = excluded.display_variante, nombre_origen = excluded.nombre_origen, oculto = excluded.oculto, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 4. Lona Front Brillo: el dato útil de la variante ("ancho max 1.52 mt") sube
--    al display del PRODUCTO (visible en menú y catálogo, caso 12: el cliente
--    de la lona 3x2 tiene que poder descartar el brillo solo) y la variante
--    única pasa a '.'
-- ---------------------------------------------------------------------------
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'lona front brillo'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'solvente';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Lona Front Brillo';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Lona Front Brillo';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Lona front brillo (ancho máx 1,52 m)', array['lona brillo','lona brillante','banner brillo','tela brillo']::text[], array['para banner','para carteleria grande','para exterior']::text[], true, false, false, false, 'Lona Front Brillo', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
    select array_agg(v.id) into ids from public.product_variants v
    where v.product_id = pid and v.is_active and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = 'lona brillo ancho max 1.52 mt' and v.color is not distinct from null;
    if ids is null then
      raise notice 'SKIPPED (variante no encontrada o renombrada): % / %', 'Lona Front Brillo', 'Lona Brillo ancho max 1.52 mt';
    elsif array_length(ids, 1) > 1 then
      raise notice 'SKIPPED (variante ambigua por clave natural): % / %', 'Lona Front Brillo', 'Lona Brillo ancho max 1.52 mt';
    else
      insert into bot.variante_meta as vm (variante_id, display_variante, nombre_origen, oculto, updated_at)
      values (ids[1], '.', 'Lona Brillo ancho max 1.52 mt', false, now())
      on conflict (variante_id) do update set display_variante = excluded.display_variante, nombre_origen = excluded.nombre_origen, oculto = excluded.oculto, updated_at = excluded.updated_at;
    end if;
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 5. Anclaje de documentos GENÉRICOS a las impresiones comunes (nota Martin
--    post-r6: "apuntes"/"libro" resolvían a medicina como ÚNICO candidato).
--    La línea de medicina era la única del catálogo con "apuntes" en el nombre;
--    obra 75 tenía sinónimos VACÍOS. Con esto el catálogo que ve el LLM dice
--    "también: apuntes, libro" en las comunes, y "apuntes"/"libro" quedan como
--    rank-1 exacto de las comunes en Get Precio/Get Opciones.
--    OJO: se preserva por_pagina=true (seed de cotizador-v7.sql) y el
--    auto_sinonimo=false del obra 75 (su nombre vivo "IMPRESIONES" es genérico).
-- ---------------------------------------------------------------------------

-- IMPRESIONES (obra 75): + apuntes, libro
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'impresiones'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones inkjet/ricoh/riso/epson';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'IMPRESIONES (obra 75)';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'IMPRESIONES (obra 75)';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Impresiones papel obra 75 gr', array['apuntes','libro']::text[], array['para imprimir apuntes','para imprimir exámenes o parciales','para trabajos de la facultad','para imprimir un currículum / cv']::text[], false, false, true, false, 'IMPRESIONES', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

-- Impresión a4 papel obra 106 gr: + libro (ambas comunes matchean "libro" →
-- menú de dos niveles, el cliente elige gramaje)
do $curador$
declare pid uuid; ids uuid[];
begin
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'impresion a4 papel obra de 106 gr'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones inkjet/ricoh/riso/epson';
  if ids is null then
    raise notice 'SKIPPED (producto no encontrado o renombrado): %', 'Impresión a4 Papel obra de 106 gr';
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Impresión a4 Papel obra de 106 gr';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, display_name, sinonimos, casos_de_uso, auto_sinonimo, oculto, por_pagina, por_pack, nombre_origen, updated_at)
    values (pid, 'Impresiones a4 papel obra 106 gr', array['impresion a4','hoja a4 impresa','libro']::text[], array['para documentos','para folleteria']::text[], true, false, true, false, 'Impresión a4 Papel obra de 106 gr', now())
    on conflict (producto_id) do update set display_name = excluded.display_name, sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, auto_sinonimo = excluded.auto_sinonimo, oculto = excluded.oculto, por_pagina = excluded.por_pagina, por_pack = excluded.por_pack, nombre_origen = excluded.nombre_origen, updated_at = excluded.updated_at;
  end if;
end $curador$;

commit;

-- ---------------------------------------------------------------------------
-- Sanity (correr después de aplicar):
-- select t.nombre_canonico, v.variante from bot.variantes v
--   join bot.taxonomia t using (producto_id)
--   where t.nombre_canonico ilike any (array['%anillado plástico a4%','%medicina%','%lona%']);
--   -- esperado: anillado a4/oficio, medicina, Lona Mate y Lona front brillo
--   -- (ancho máx 1,52 m) con variante '.'
-- select count(*) from bot.variante_meta where display_variante = '.';  -- esperado: 4
-- select t.nombre_canonico, t.sinonimos, bool_and(v.por_pagina) as por_pagina
--   from bot.taxonomia t join bot.variantes v using (producto_id)
--   where t.nombre_canonico ilike 'impresiones%obra%'
--   group by 1, 2;
--   -- esperado: obra 75 con {apuntes,libro} y 106 con {...,libro}; AMBOS por_pagina
--   -- true (si alguno da false, el seed de cotizador-v7.sql fue pisado: re-correrlo)
-- ---------------------------------------------------------------------------
