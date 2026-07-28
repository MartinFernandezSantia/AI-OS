-- ═══════════════════════════════════════════════════════════════════════════
-- CURACIÓN 2026-07-28b — el hermano de la promo, curado en vez de inferido
--
-- QUÉ RESUELVE. La promo de inmobiliarias tiene min_unidades:6. Cuando el cliente
-- pide MENOS de 6, el bot hoy se niega a cotizar y repregunta — teniendo el precio
-- del cartel normal a mano. Para poder cotizarlo hace falta saber CUÁL es el cartel
-- normal de esa promo, y esa relación no existe en ningún lado.
--
-- POR QUÉ CURADO Y NO INFERIDO. La pasada adversarial del 28 (3 lentes Opus, las
-- tres por su lado) tumbó la idea de deducir el hermano en runtime por
-- familias+material:
--   · el hermano NO está en el candidato-set en el turno donde el guard dispara.
--     En "3" pelado la búsqueda la manda el eco del LLM ("promoción inmobiliarias")
--     y el corte relativo del SQL (score >= 0.4*max) deja al normal en 0,23 del
--     máximo: no entra ni pre-filtro. El fix habría sido inerte.
--   · familias+material es 1-a-10 para el otro nicho del catálogo: `material` es
--     null en la mayoría de las fichas, así que el criterio degenera.
--   · y aun encontrándolo, elegirVariante() puntúa sobre el mensaje ACTUAL — que en
--     el turno del incidente es "3" — y sin medida gana la más barata: cotizaría el
--     A3 de $10.500 en vez del 1x0,65 de $19.500. Sub-cotización de 1,86×, la misma
--     magnitud que los confident-wrong del 27.
--
-- La medida de la promo está en su propio nombre ("6 carteles 1 x 0.65 mt"), o sea
-- el vínculo es un DATO del negocio, no algo a adivinar. Se escribe y listo.
--
-- QUÉ NO HACE. Esto no cambia ninguna conducta del bot: ningún nodo lee todavía
-- producto_base/variante_base (`grep producto_base` sobre el workflow da cero).
-- Es el prerrequisito. La lógica se construye DESPUÉS de una ronda real, con
-- bot.decisiones poblado — el fix del log es de hoy (commit 1dd3040) y hasta
-- ahora la tabla no registraba los turnos de la rama normal.
--
-- ALCANCE. Martin confirmó (2026-07-28) que ésta es la ÚNICA promo por volumen del
-- catálogo. Una fila, dos campos. Si mañana TG suma otra, se cura igual.
--
-- IDEMPOTENTE. Resolución por clave natural + raise notice + skip, como todas las
-- curaciones. Se puede correr dos veces sin efecto.
--
-- CÓMO SE APLICA. Lo aplica Martin (Claude no toca la base). Después:
--   GET /webhook/refrescar-catalogo   ← purga el cache del catálogo
-- ═══════════════════════════════════════════════════════════════════════════

do $curador$
declare
  pid_promo   uuid;
  pid_base    uuid;
  vid_base    uuid;
  ids         uuid[];
begin
  -- ── 1. El HERMANO (el cartel normal) y su variante 1x0,65 ────────────────
  -- Se resuelve primero: si no existe, no tiene sentido escribir el vínculo.
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active
    and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'impresion exterior / montado sobre plastico corrugado'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'carteleria en plastico corrugado';

  if ids is null then
    raise notice 'ABORTADO (producto base no encontrado): %', 'Impresión exterior / montado sobre plástico corrugado';
    return;
  elsif array_length(ids, 1) > 1 then
    raise notice 'ABORTADO (producto base ambiguo, % filas): %', array_length(ids, 1), 'Impresión exterior / montado sobre plástico corrugado';
    return;
  end if;
  pid_base := ids[1];

  -- La variante EXACTA que la promo replica. Sin esto el vínculo apunta a un
  -- producto de 4 precios ($10.500 a $48.000) y no dice cuál: es justo el bug de
  -- 1,86× que esta curación existe para cerrar.
  select array_agg(v.id) into ids
  from public.product_variants v
  where v.product_id = pid_base and v.is_active
    and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = '1 x 0.65 mt'
    and v.color is not distinct from null;

  if ids is null then
    raise notice 'ABORTADO (variante base no encontrada): % / %', 'Impresión exterior / montado sobre plástico corrugado', '1 x 0.65 mt';
    return;
  elsif array_length(ids, 1) > 1 then
    raise notice 'ABORTADO (variante base ambigua, % filas): % / %', array_length(ids, 1), 'Impresión exterior / montado sobre plástico corrugado', '1 x 0.65 mt';
    return;
  end if;
  vid_base := ids[1];

  -- ── 2. La PROMO: se le agrega el vínculo, sin pisar lo que ya tiene ───────
  select array_agg(p.id) into ids
  from public.products p join public.categories c on c.id = p.category_id
  where p.is_active
    and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = 'promocion inmobiliarias 6 carteles 1 x 0.65 mt'
    and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = 'carteleria en plastico corrugado';

  if ids is null then
    raise notice 'SKIPPED (promo no encontrada o renombrada): %', 'Promocion Inmobiliarias 6 carteles 1 x 0.65 mt';
    return;
  elsif array_length(ids, 1) > 1 then
    raise notice 'SKIPPED (promo ambigua, % filas): %', array_length(ids, 1), 'Promocion Inmobiliarias 6 carteles 1 x 0.65 mt';
    return;
  end if;
  pid_promo := ids[1];

  -- El vínculo se MERGEA (||) sobre los atributos que ya están: nicho,
  -- min_unidades, material, unidad_venta, multiplica. Reescribir el jsonb entero
  -- los perdería, y min_unidades es el que dispara todo el camino.
  -- Los UUID van como texto: es lo que ya hace el resto del esquema.
  update bot.producto_meta
     set atributos = coalesce(atributos, '{}'::jsonb) || jsonb_build_object(
           'producto_base', pid_base::text,
           'variante_base', vid_base::text),
         updated_at = now()
   where producto_id = pid_promo;

  if not found then
    raise notice 'SKIPPED (la promo no tiene fila en bot.producto_meta — correr antes curacion-e0-2026-07-26.sql)';
    return;
  end if;

  raise notice 'OK: promo % -> base % / variante %', pid_promo, pid_base, vid_base;
end
$curador$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (read-only). Tiene que devolver 1 fila, con los dos campos
-- resueltos a nombres reales y el precio del hermano visible.
-- Lo que hay que mirar:
--   · producto_base = 'Impresión exterior / montado sobre plástico corrugado'
--   · variante_base = '1 x 0.65 mt'   ← NO 'a3'. Si dice a3, el vínculo está mal.
--   · min_unidades  = 6               ← tiene que seguir estando (el || no lo pisó)
-- ═══════════════════════════════════════════════════════════════════════════
select p.name                       as promo,
       m.atributos->>'min_unidades' as min_unidades,
       m.atributos->>'nicho'        as nicho,
       pb.name                      as producto_base,
       vb.name                      as variante_base,
       vb.price                     as precio_base
from bot.producto_meta m
join public.products p on p.id = m.producto_id
left join public.products         pb on pb.id::text = m.atributos->>'producto_base'
left join public.product_variants vb on vb.id::text = m.atributos->>'variante_base'
where m.atributos ? 'producto_base';
