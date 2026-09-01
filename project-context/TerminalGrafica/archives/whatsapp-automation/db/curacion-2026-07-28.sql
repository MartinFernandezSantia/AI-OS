-- =====================================================================
-- CURACIÓN 2026-07-28 — DEFAULTS DE FAMILIA ("el trabajo normal")
--
-- Qué resuelve. Cuando el cliente pide un trabajo SIN especificar ("imprimir
-- 100 hojas a color", "anillame un apunte", "plastificame esto"), la búsqueda
-- por token trae toda la familia y gana el de mayor score IDF — que no tiene
-- por qué ser el trabajo normal. El 2026-07-27, "cuánto sale imprimir 100 hojas
-- a color" cotizó $750/hoja (láser obra 80) cuando el trabajo normal es $400
-- (obra 75). Mismo patrón latente en plastificado: hoy ganaría "Plastificado A4"
-- a $2.200 cuando el trabajo común es "Laminados" a $330.
--
-- El mecanismo. bot.producto_meta.atributos.default_familia = true marca el
-- producto que se asume cuando el cliente NO especifica. Ya existía en
-- IMPRESIONES (curación E0) y ningún nodo lo leía; v8.3 lo consume para ordenar
-- el ranking y para cotizar el trabajo normal con la puerta abierta al resto.
--
-- Alcance: 4 familias de 17. Las otras 13 NO llevan default a propósito — ver
-- el .md para el criterio (si el cliente siempre trae medida/material/cantidad,
-- un default miente en vez de ayudar).
--
-- Overlay only: NUNCA se toca public.products / public.product_variants.
-- Claves naturales (nombre + rubro normalizados), replayable, 0 filas o 2+ filas
-- => SKIPPED por notice y sigue.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. IMPRESIONES — el default ya existe; le falta el eje TAMAÑO.
--
-- Este es el DATO que habilita el fix de plata del lote — no el fix entero.
-- El producto no declara `tamano` en ninguna parte (sus 4 variantes son faz ×
-- color), así que el eje NO EXISTE y por lo tanto no puede contradecirse: ante
-- "50 hojas A3 a color" la resolución cae a color => simple faz color =>
-- $400/hoja, cuando el A3 real cuesta $1.200-1.800. Error de 3-4x sub-cotizando,
-- y ningún guard lo ve: los guards detectan CONTRADICCIÓN (el cliente dijo 106 y
-- la fila dice 75), no eje ausente.
--
-- OJO — verificado 2026-07-28, contra lo que decía el borrador de esta curación:
-- agregar el eje NO arregla el caso A3 por sí solo. La variante nunca se elegía
-- por tamaño en este producto (0 variantes matcheaban 'a3' antes Y después); el
-- producto ya venía resuelto por NOMBRE, y la resolución de producto no mira
-- atributos. El fix del A3 es un GUARD DE CÓDIGO — comparar el tamaño pedido
-- contra el `tamano` del producto resuelto y descartar si contradice — y ese
-- guard necesita este atributo para tener contra qué comparar. Sin el dato no hay
-- guard posible; con el dato, el guard es una línea. Por eso va igual, primero.
-- Es A4 de hecho (es lo que sale de un riso) pero nadie lo había escrito.
-- ---------------------------------------------------------------------
do $curador$
declare v_id uuid; n int;
begin
  select p.id, count(*) over () into v_id, n
  from public.products p
  join public.categories c on c.id = p.category_id
  where translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'impresiones'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'impresiones inkjet/ricoh/riso/epson'
  limit 1;
  if v_id is null then
    raise notice 'SKIPPED [1] IMPRESIONES: 0 filas (renombrado? re-exportar)';
  elsif n > 1 then
    raise notice 'SKIPPED [1] IMPRESIONES: % filas, clave ambigua', n;
  else
    insert into bot.producto_meta (producto_id, atributos, nombre_origen, updated_at)
    values (v_id, jsonb_build_object('tamano', jsonb_build_array('a4')), 'IMPRESIONES', now())
    on conflict (producto_id) do update
      -- merge: conserva papel/gramaje/tecnologia/unidad_venta/default_familia
      set atributos = coalesce(bot.producto_meta.atributos, '{}'::jsonb)
                      || jsonb_build_object('tamano', jsonb_build_array('a4')),
          updated_at = now();
    raise notice 'OK [1] IMPRESIONES: tamano=["a4"]';
  end if;
end $curador$;

-- ---------------------------------------------------------------------
-- 2. ANILLADO / ENCUADERNACIÓN — el plástico a4/oficio es el trabajo normal.
--
-- Decisión de Martin (2026-07-28). El producto pertenece a DOS familias
-- (anillado + encuadernacion), así que un solo flag cubre las dos.
-- Ratio de la familia: 1,9x ($2.400 plástico vs $3.200-4.600 metálico) — bajo,
-- pero el default acá no es por plata sino porque "anillame esto" tiene una
-- respuesta obvia y el metálico es el pedido explícito.
-- OJO con la clave: el nombre VIVO es 'Anillado Plastico a4/oficio 24 hs'
-- (el display curado es 'Anillado plástico a4/oficio') y el rubro es Taller.
-- ---------------------------------------------------------------------
do $curador$
declare v_id uuid; n int;
begin
  select p.id, count(*) over () into v_id, n
  from public.products p
  join public.categories c on c.id = p.category_id
  where translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'anillado plastico a4/oficio 24 hs'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'taller'
  limit 1;
  if v_id is null then
    raise notice 'SKIPPED [2] Anillado plástico a4/oficio: 0 filas';
  elsif n > 1 then
    raise notice 'SKIPPED [2] Anillado plástico a4/oficio: % filas', n;
  else
    insert into bot.producto_meta (producto_id, atributos, nombre_origen, updated_at)
    values (v_id, jsonb_build_object('default_familia', true),
            'Anillado Plastico a4/oficio 24 hs', now())
    on conflict (producto_id) do update
      set atributos = coalesce(bot.producto_meta.atributos, '{}'::jsonb)
                      || jsonb_build_object('default_familia', true),
          updated_at = now();
    raise notice 'OK [2] Anillado plástico a4/oficio: default_familia';
  end if;
end $curador$;

-- ---------------------------------------------------------------------
-- 3. PLASTIFICADO — Laminados es el trabajo normal.
--
-- Bug latente, mismo patrón que impresiones: hoy "plastificame esto" resuelve
-- por score y gana 'Plastificado A4' ($2.200) sobre 'Laminados' ($330 en A4).
-- 6,7x de diferencia sobre el trabajo más pedido de la familia.
-- Laminados YA declara tamano=["a3","a4"], así que el eje existe y un pedido de
-- oficio lo descarta solo (cae a 'Plastificado Oficio', correcto).
-- ---------------------------------------------------------------------
do $curador$
declare v_id uuid; n int;
begin
  select p.id, count(*) over () into v_id, n
  from public.products p
  join public.categories c on c.id = p.category_id
  where translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'laminados'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'laminado/brillo mate'
  limit 1;
  if v_id is null then
    raise notice 'SKIPPED [3] Laminados: 0 filas';
  elsif n > 1 then
    raise notice 'SKIPPED [3] Laminados: % filas', n;
  else
    insert into bot.producto_meta (producto_id, atributos, nombre_origen, updated_at)
    values (v_id, jsonb_build_object('default_familia', true), 'Laminados', now())
    on conflict (producto_id) do update
      set atributos = coalesce(bot.producto_meta.atributos, '{}'::jsonb)
                      || jsonb_build_object('default_familia', true),
          updated_at = now();
    raise notice 'OK [3] Laminados: default_familia';
  end if;
end $curador$;

-- ---------------------------------------------------------------------
-- 4. LIBRERÍA — Sobre A4 es el sobre normal.
--
-- El más flojo de los cuatro y por eso va a preguntas-tg (ítem 70): "un sobre"
-- podría ser el inglés (de carta) según a qué venga el cliente. A4 es el que
-- más se vende para documentación, que es el uso de imprenta. Si TG dice que el
-- normal es el inglés, se mueve el flag y listo — el mecanismo no cambia.
-- ---------------------------------------------------------------------
do $curador$
declare v_id uuid; n int;
begin
  select p.id, count(*) over () into v_id, n
  from public.products p
  join public.categories c on c.id = p.category_id
  where translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'sobre a4'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'libreria'
  limit 1;
  if v_id is null then
    raise notice 'SKIPPED [4] Sobre a4: 0 filas';
  elsif n > 1 then
    raise notice 'SKIPPED [4] Sobre a4: % filas', n;
  else
    insert into bot.producto_meta (producto_id, atributos, nombre_origen, updated_at)
    values (v_id, jsonb_build_object('default_familia', true), 'Sobre a4', now())
    on conflict (producto_id) do update
      set atributos = coalesce(bot.producto_meta.atributos, '{}'::jsonb)
                      || jsonb_build_object('default_familia', true),
          updated_at = now();
    raise notice 'OK [4] Sobre a4: default_familia';
  end if;
end $curador$;

commit;

-- =====================================================================
-- VERIFICACIÓN (read-only, correr después del commit)
-- Esperado: 4 filas — IMPRESIONES, Anillado plástico a4/oficio, Laminados,
-- Sobre a4 — y que IMPRESIONES muestre tamano=["a4"].
-- =====================================================================
-- select t.nombre_canonico,
--        t.atributos->'default_familia' as es_default,
--        t.atributos->'tamano'          as tamano,
--        t.familias
-- from bot.taxonomia t
-- where (t.atributos->>'default_familia')::boolean is true
-- order by t.nombre_canonico;
