-- ============================================================================
-- Curación de voz de mostrador — 2026-07-26 (consejo Opus)
--
-- Dos cosas, medidas contra el catálogo real:
--   (a) el vocabulario del cliente que NO existe en ninguna superficie del
--       catálogo. Medido: 16 de 22 verbos de mostrador y 16 de 38 términos no
--       matchean nada. "me hacen fotocopias?" cae en la posición 71 de 82.
--   (b) los sinónimos que SECUESTRAN consultas genéricas. El rank-1 de A borra
--       el empate rank-2 que habría mandado la consulta al Aclarador, así que el
--       hijack no deja rastro: el motor devuelve "un ganador limpio".
--
-- Resolución por CLAVE NATURAL (nombre+rubro normalizados), replayable en prod.
-- raise notice + skip si una fila no resuelve. Transaccional.
-- NO toca public.*. Después de aplicar: GET /webhook/refrescar-catalogo.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Impresiones papel obra 75 gr
--    El default firmado (obra 75 / simple faz / b/n) y tiene la lista de sinónimos VACÍA.
--    Es el producto que el cliente nombra de diez maneras y el único curado a mano.
--    16 de 22 verbos de mostrador no existían en ninguna superficie del catálogo.
--    AGREGA: fotocopias, fotocopia, copias, hojas impresas, impresiones comunes, apuntes, apunte, carillas, carilla
-- ---------------------------------------------------------------------------
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
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'IMPRESIONES';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, sinonimos, nombre_origen, updated_at)
    values (pid, array(select distinct unnest(coalesce('{}'::text[], '{}') || array['fotocopias', 'fotocopia', 'copias', 'hojas impresas', 'impresiones comunes', 'apuntes', 'apunte', 'carillas', 'carilla']::text[])), 'IMPRESIONES', now())
    on conflict (producto_id) do update
      set sinonimos = array(select distinct unnest(coalesce(m.sinonimos, '{}') || array['fotocopias', 'fotocopia', 'copias', 'hojas impresas', 'impresiones comunes', 'apuntes', 'apunte', 'carillas', 'carilla']::text[])), updated_at = now();
    raise notice 'OK: % -> % sinonimos', 'IMPRESIONES', (select cardinality(sinonimos) from bot.producto_meta where producto_id = pid);
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 2. Impresión de módulos/apuntes de medicina
--    HIJACK de nicho: "apuntes de medicina" dispara con score máximo ante CUALQUIER
--    mensaje que diga "apuntes", y este es el producto de precio especial de nicho
--    ($45/página). El guard de nicho es un backstop, no una estrategia de matching.
--    QUITA:  apuntes de medicina
-- ---------------------------------------------------------------------------
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
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Impresión de Módulos/Apuntes medicina';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, sinonimos, nombre_origen, updated_at)
    values (pid, array_remove(coalesce('{}'::text[], '{}'), 'apuntes de medicina'), 'Impresión de Módulos/Apuntes medicina', now())
    on conflict (producto_id) do update
      set sinonimos = array_remove(coalesce(m.sinonimos, '{}'), 'apuntes de medicina'), updated_at = now();
    raise notice 'OK: % -> % sinonimos', 'Impresión de Módulos/Apuntes medicina', (select cardinality(sinonimos) from bot.producto_meta where producto_id = pid);
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 3. Impresiones a3 tonner negro
--    HIJACK genérico: "hojas a3" se lleva puesto todo "hojas", que es la palabra más
--    común del mostrador, hacia un producto de $500 la página contra $100 del obra 75.
--    QUITA:  hojas a3
-- ---------------------------------------------------------------------------
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
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Impresiones a3 tonner negro';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, sinonimos, nombre_origen, updated_at)
    values (pid, array_remove(coalesce('{}'::text[], '{}'), 'hojas a3'), 'Impresiones a3 tonner negro', now())
    on conflict (producto_id) do update
      set sinonimos = array_remove(coalesce(m.sinonimos, '{}'), 'hojas a3'), updated_at = now();
    raise notice 'OK: % -> % sinonimos', 'Impresiones a3 tonner negro', (select cardinality(sinonimos) from bot.producto_meta where producto_id = pid);
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 4. Ilustración Mate 250 gr
--    HIJACK de 73x: "papel ilustracion" resuelve a la HOJA suelta ($900) y tapa a
--    Folletos 10x15 en ilustración ($66.000 x500). El cliente que dice "papel
--    ilustración" casi nunca quiere una hoja.
--    QUITA:  papel ilustracion
-- ---------------------------------------------------------------------------
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
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Ilustración Mate 250 gr';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, sinonimos, nombre_origen, updated_at)
    values (pid, array_remove(coalesce('{}'::text[], '{}'), 'papel ilustracion'), 'Ilustración Mate 250 gr', now())
    on conflict (producto_id) do update
      set sinonimos = array_remove(coalesce(m.sinonimos, '{}'), 'papel ilustracion'), updated_at = now();
    raise notice 'OK: % -> % sinonimos', 'Ilustración Mate 250 gr', (select cardinality(sinonimos) from bot.producto_meta where producto_id = pid);
  end if;
end $curador$;

-- ---------------------------------------------------------------------------
-- 5. Ilustración Brillo 150 gr
--    HIJACK de 82x, misma clase que el anterior.
--    QUITA:  papel ilustracion brillo
-- ---------------------------------------------------------------------------
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
    raise notice 'SKIPPED (clave natural ambigua, % filas): %', array_length(ids, 1), 'Ilustración Brillo 150 gr';
  else
    pid := ids[1];
    insert into bot.producto_meta as m (producto_id, sinonimos, nombre_origen, updated_at)
    values (pid, array_remove(coalesce('{}'::text[], '{}'), 'papel ilustracion brillo'), 'Ilustración Brillo 150 gr', now())
    on conflict (producto_id) do update
      set sinonimos = array_remove(coalesce(m.sinonimos, '{}'), 'papel ilustracion brillo'), updated_at = now();
    raise notice 'OK: % -> % sinonimos', 'Ilustración Brillo 150 gr', (select cardinality(sinonimos) from bot.producto_meta where producto_id = pid);
  end if;
end $curador$;

commit;

-- ---------------------------------------------------------------------------
-- LO QUE NO ENTRÓ EN ESTA PASADA, Y POR QUÉ
--
-- 1. Las FORMAS VERBALES (anillar, plastificar, refilar, abrochar, perforar,
--    troquelar, plegar). El consejo las pidió y corresponden — hoy "anillar un
--    apunte" no matchea nada. Van en una pasada propia sobre los 11 productos de
--    Taller y los 4 de Encuadernación, que necesita las claves naturales de esos
--    rubros verificadas contra la base viva (el export es del 23-jul y quedó
--    atrás de dos curaciones).
--
-- 2. Los verbos GENÉRICOS de impresión (imprimir, imprimir hojas) y "copia" en
--    singular. Deliberado: los sinónimos solo trabajan en rank-1, que exige
--    igualdad EXACTA del slot "producto" completo. Un verbo suelto como producto
--    es senal de extraccion rota, y hacerlo resolver al producto MAS BARATO del
--    catálogo es la dirección equivocada del error: sub-cotiza en silencio. Sin
--    el sinónimo cae en sin_match y lo atiende el Aclarador, que pregunta.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Sanity después de aplicar (y GET /webhook/refrescar-catalogo):
--
--   -- 1. el default ya no tiene la lista vacía
--   select nombre_canonico, sinonimos from bot.taxonomia
--    where nombre_canonico ilike '%obra 75%';
--
--   -- 2. ningún producto de nicho o de hoja suelta se queda con un genérico
--   select nombre_canonico, sinonimos from bot.taxonomia
--    where sinonimos && array['apuntes de medicina','hojas a3','papel ilustracion',
--                             'papel ilustracion brillo']::text[];
--   -- esperado: 0 filas
--
--   -- 3. "fotocopias" ahora resuelve (era el agujero de la posición 71 de 82)
--   select nombre_canonico from bot.taxonomia
--    where 'fotocopias' = any(sinonimos);
-- ---------------------------------------------------------------------------
