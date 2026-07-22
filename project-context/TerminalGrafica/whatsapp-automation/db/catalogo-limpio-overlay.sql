-- =============================================================================
-- Catálogo limpio v10.8 — overlay bot.producto_meta / variante_meta / rubro_meta
-- =============================================================================
-- Preparada por Claude, APLICA MARTIN (regla: yo preparo, vos aplicás).
-- Diseño contrastado con Fable en 4 rondas: plans/catalogo-limpio-producto-meta.md
-- (ahí está el diff completo para tu revisión ÚNICA antes de aplicar).
--
-- Qué hace:
--   1. DDL aditivo en schema bot (display_name/auto_sinonimo/oculto en producto_meta;
--      tablas nuevas variante_meta y rubro_meta). NO toca public.* — el motor del
--      mostrador no se entera de nada.
--   2. Recrea las vistas: el overlay se aplica AHÍ (taxonomia OR REPLACE; variantes
--      DROP+CREATE por la columna nueva variante_origen → re-grant condicional).
--      Get Catálogo renderiza y Get Precio matchea la MISMA columna coalesced:
--      coherencia por construcción, cero cambios en nodos Code.
--   3. Seed por CLAVE NATURAL (nombre normalizado + columna color), nunca uuids
--      hardcodeados: el proyecto de testing y el prod futuro no comparten ids.
--      Lookups INTO STRICT: 0 o 2+ filas = falla ruidoso.
--   4. Asserts: tripwire de semántica color por ORDEN DE PRECIOS (los nombres de
--      regla no sirven: las 4 del 75 gr se llaman igual), no-colisión de valores
--      NUEVOS (el dup preexistente Sobre Ingles queda grandfathered), substring-
--      hazard de sinónimos nuevos (firma del hijack rank-1), anti-header mecánico
--      para rubros mono-producto, anti-fusión de headers del group by.
--   Todo en UNA transacción: si un assert falla, NO se aplica nada.
--
-- Idempotente: re-ejecutable sin duplicar (upserts + if not exists).
-- Después de aplicar: re-importar faq-bot-v6.json y TOGGLEAR el workflow (cache).
-- =============================================================================

begin;

-- Helpers de sesión (pg_temp: desaparecen al cerrar; las vistas NO los usan)
create or replace function pg_temp.norm(t text) returns text language sql immutable
as $f$ select translate(lower(coalesce(t,'')), 'áéíóúñ', 'aeioun') $f$;
create or replace function pg_temp.likeesc(t text) returns text language sql immutable
as $f$ select replace(replace(pg_temp.norm(t), '%', '\%'), '_', '\_') $f$;
-- unión de sinónimos con dedupe NORMALIZADO (dos grafías que solo difieren en
-- tildes son el mismo token para el matching — enmienda Fable R4)
create or replace function pg_temp.union_sin(a text[], b text[]) returns text[] language sql
as $f$ select coalesce(array_agg(s), '{}') from (select min(u.s) as s from unnest(coalesce(a,'{}') || coalesce(b,'{}')) u(s) group by pg_temp.norm(u.s)) x $f$;

-- ---------------------------------------------------------------------------
-- 1. DDL aditivo
-- ---------------------------------------------------------------------------
alter table bot.producto_meta
  add column if not exists display_name  text,
  add column if not exists auto_sinonimo boolean not null default true,
  add column if not exists oculto        boolean not null default false;

-- ON DELETE CASCADE deliberado (NUNCA restrict: un delete del admin del mostrador
-- no puede fallar por una tabla nuestra). Si el motor algún día borra-y-recrea
-- variantes, la fila meta desaparece sin rastro y el dupe resucita como
-- 'fallback: ambiguo' en bot.decisiones (ya monitoreado) — query de reconciliación
-- en las sanity de abajo.
create table if not exists bot.variante_meta (
  variante_id      uuid primary key references public.product_variants(id) on delete cascade,
  display_variante text not null,
  oculto           boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists bot.rubro_meta (
  categoria_id uuid primary key references public.categories(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Vistas con overlay (contrato de columnas intacto para n8n)
-- ---------------------------------------------------------------------------
-- taxonomia: mismas columnas → CREATE OR REPLACE alcanza (grants se conservan).
-- Auto-sinónimo del nombre viejo: solo si hay display distinto, con dedupe
-- normalizado contra el array curado, y gated por auto_sinonimo (false SOLO en
-- IMPRESIONES: 'impresiones' es el término rubro-genérico que la poda elimina;
-- auto-appendearlo resucitaría el hijack por rank 1 — ronda 3 del contraste).
create or replace view bot.taxonomia as
select
  p.id                                  as producto_id,
  coalesce(m.display_name, p.name)      as nombre_canonico,
  coalesce(rm.display_name, c.name)     as categoria,
  coalesce(rmp.display_name, cpar.name) as categoria_padre,
  coalesce(m.sinonimos, '{}')
    || case
         when m.display_name is not null
          and m.display_name <> p.name
          and coalesce(m.auto_sinonimo, true)
          and not exists (
                select 1 from unnest(coalesce(m.sinonimos, '{}')) s
                where translate(lower(s), 'áéíóúñ', 'aeioun')
                    = translate(lower(p.name), 'áéíóúñ', 'aeioun'))
         then array[p.name]
         else '{}'::text[]
       end                              as sinonimos,
  coalesce(m.casos_de_uso, '{}')        as casos_de_uso
from public.products p
join public.categories c          on c.id = p.category_id
left join public.categories cpar  on cpar.id = c.parent_id
left join bot.producto_meta m     on m.producto_id = p.id
left join bot.rubro_meta rm       on rm.categoria_id = c.id
left join bot.rubro_meta rmp      on rmp.categoria_id = cpar.id
where p.is_active = true
  and c.audience = 'publico'
  and not coalesce(m.oculto, false);

-- variantes: columna nueva variante_origen (nombre vivo, solo telemetría y
-- reconciliación) → DROP + CREATE + re-grant, mismo patrón que precio-freshness.
-- El filtro oculto aplica a variante Y a producto (si se oculta un producto, sus
-- variantes también desaparecen del matching — si no, rank 3 lo resucitaría).
drop view if exists bot.variantes;

create view bot.variantes as
with recursive cat_chain as (
  select id as start_id, id as node_id, parent_id from public.categories
  union all
  select cc.start_id, c.id, c.parent_id
  from cat_chain cc
  join public.categories c on c.id = cc.parent_id
)
select b.*, (not b.tiene_reglas) as mostrable
from (
  select
    v.id                                as variante_id,
    v.product_id                        as producto_id,
    coalesce(vm.display_variante, v.name) as variante,
    v.name                              as variante_origen,
    v.color                             as color,
    v.unit                              as unidad,
    v.price                             as precio_lista,
    v.price_updated_at                  as precio_actualizado,
    exists (
      select 1
      from public.pricing_rule_targets t
      join public.pricing_rules r on r.id = t.pricing_rule_id
      where r.is_active = true
        and (
              t.product_variant_id = v.id
           or t.product_id         = v.product_id
           or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = p.category_id)
        )
    ) as tiene_reglas,
    coalesce((
      select bool_and(r.rule_type = 'discount')
      from public.pricing_rule_targets t
      join public.pricing_rules r on r.id = t.pricing_rule_id
      where r.is_active = true
        and (
              t.product_variant_id = v.id
           or t.product_id         = v.product_id
           or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = p.category_id)
        )
    ), false) as solo_descuentos,
    exists (
      select 1
      from public.pricing_rule_targets t
      join public.pricing_rules r on r.id = t.pricing_rule_id
      where r.is_active = true
        and r.rule_type = 'override'
        and (
              t.product_variant_id = v.id
           or t.product_id         = v.product_id
           or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = p.category_id)
        )
    ) as tiene_override,
    (
      select count(*)::int
      from public.pricing_rule_targets t
      join public.pricing_rules r on r.id = t.pricing_rule_id
      where r.is_active = true
        and r.rule_type = 'quantity_range'
        and (
              t.product_variant_id = v.id
           or t.product_id         = v.product_id
           or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = p.category_id)
        )
    ) as n_reglas_cantidad,
    (
      select r.effect->'ranges'
      from public.pricing_rule_targets t
      join public.pricing_rules r on r.id = t.pricing_rule_id
      where r.is_active = true
        and r.rule_type = 'quantity_range'
        and (
              t.product_variant_id = v.id
           or t.product_id         = v.product_id
           or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = p.category_id)
        )
      limit 1
    ) as rangos_cantidad
  from public.product_variants v
  join public.products  p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  left join bot.variante_meta vm on vm.variante_id = v.id
  left join bot.producto_meta pm on pm.producto_id = p.id
  where v.is_active = true
    and p.is_active = true
    and c.audience  = 'publico'
    and not coalesce(vm.oculto, false)
    and not coalesce(pm.oculto, false)
) b;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'bot_readonly') then
    grant select on bot.variantes to bot_readonly;
    raise notice 'Grant SELECT de bot.variantes re-otorgado a bot_readonly.';
  else
    raise notice 'Rol bot_readonly no existe: sin grants (n8n como owner ya accede).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Seed por clave natural + 4. Asserts (una sola transacción con el DDL)
-- ---------------------------------------------------------------------------
do $$
declare
  p75 uuid; p106 uuid; pmed uuid; piman uuid; proll uuid; pobra80 uuid;
  ptonner uuid; puv uuid; pcorrug uuid; pmontado uuid; pcarton uuid; pauto uuid;
  pani24 uuid; pani48 uuid; pani72 uuid; pani96 uuid; pania3 uuid;
  ppla4 uuid; pploficio uuid; ppla3 uuid;
  pvmate uuid; pmicro uuid; psobre uuid; ptacneg uuid; pembl uuid;
  popp uuid; poppb uuid; pcorte uuid; pfoll1 uuid; pfoll2 uuid; pfoll3 uuid;
  cinkjet uuid; cpiezas uuid; csolv uuid; cmed uuid;
  v uuid;
  q1 numeric; q2 numeric; q3 numeric; q4 numeric;
  viejo text[];
  rec record;
begin
  -- ==== resolución de productos por clave natural (STRICT: 0 o 2+ filas = error) ====
  select id into strict p75      from public.products where is_active and pg_temp.norm(name) = 'impresiones';
  select id into strict p106     from public.products where is_active and pg_temp.norm(name) = 'impresion a4 papel obra de 106 gr';
  select id into strict pmed     from public.products where is_active and pg_temp.norm(name) = 'impresion de modulos/apuntes medicina';
  select id into strict piman    from public.products where is_active and pg_temp.norm(name) = 'iman. impresion laminada y corte.';
  select id into strict proll    from public.products where is_active and pg_temp.norm(name) = 'porta banner roll up 0..85 x 2.00 mt';
  select id into strict pobra80  from public.products where is_active and pg_temp.norm(name) = 'obra 80 gr';
  select id into strict ptonner  from public.products where is_active and pg_temp.norm(name) = 'impresiones a3 tonner negro';
  select id into strict puv      from public.products where is_active and pg_temp.norm(name) = 'vinilo, lona brillo/mate uv';
  select id into strict pcorrug  from public.products where is_active and pg_temp.norm(name) = 'impresion exterior / montado sobre plastico corrugado';
  select id into strict pmontado from public.products where is_active and pg_temp.norm(name) = 'montado sobre carton';
  select id into strict pcarton  from public.products where is_active and pg_temp.norm(name) = 'carton';
  select id into strict pauto    from public.products where is_active and pg_temp.norm(name) = 'papel autoadhesivo brillo / split';
  select id into strict pani24   from public.products where is_active and pg_temp.norm(name) = 'anillado plastico a4/oficio 24 hs';
  select id into strict pani48   from public.products where is_active and pg_temp.norm(name) = 'anillado plastico a4/oficio 48 hs';
  select id into strict pani72   from public.products where is_active and pg_temp.norm(name) = 'anillado plastico a4/oficio 72 hs';
  select id into strict pani96   from public.products where is_active and pg_temp.norm(name) = 'anillado plastico a4/oficio 96 hs';
  select id into strict pania3   from public.products where is_active and pg_temp.norm(name) = 'anillado plastico a3';
  select id into strict ppla4    from public.products where is_active and pg_temp.norm(name) = 'plastificado a4';
  select id into strict pploficio from public.products where is_active and pg_temp.norm(name) = 'plastificado oficio';
  select id into strict ppla3    from public.products where is_active and pg_temp.norm(name) = 'plastificado a3';
  select id into strict pvmate   from public.products where is_active and pg_temp.norm(name) = 'vinilo mate';
  select id into strict pmicro   from public.products where is_active and pg_temp.norm(name) = 'microperforado';
  -- 'Sobre Ingles' está duplicado entre Libreria y Soportes Especiales (dup
  -- grandfathered, gated TG) → clave natural calificada por categoría
  select p.id into strict psobre from public.products p join public.categories c on c.id = p.category_id
   where p.is_active and pg_temp.norm(p.name) = 'sobre ingles' and pg_temp.norm(c.name) = 'libreria';
  select id into strict ptacneg  from public.products where is_active and pg_temp.norm(name) = 'tacos / emblocados 10x7 cm negro';
  select id into strict pembl    from public.products where is_active and pg_temp.norm(name) = 'emblocados (lado corto o largo) c/carton.';
  select id into strict popp     from public.products where is_active and pg_temp.norm(name) = 'opp mate/holografico/plata/crystal/glitter/kraft';
  select id into strict poppb    from public.products where is_active and pg_temp.norm(name) = 'opp brillo';
  select id into strict pcorte   from public.products where is_active and pg_temp.norm(name) = 'corte x millar';
  select id into strict pfoll1   from public.products where is_active and pg_temp.norm(name) = 'folletos 10x15 cm papel ilustracion brillo 150 gr';
  select id into strict pfoll2   from public.products where is_active and pg_temp.norm(name) = 'folletos 10x15 cm papel obra de 75 gr b/n';
  select id into strict pfoll3   from public.products where is_active and pg_temp.norm(name) = 'folletos 10x15 cm papel obra de 75 gr color inkjet';

  select id into strict cinkjet from public.categories where pg_temp.norm(name) = 'impresiones inkjet/ricoh/riso/epson';
  select id into strict cpiezas from public.categories where pg_temp.norm(name) = 'piezas graficas/productos';
  select id into strict csolv   from public.categories where pg_temp.norm(name) = 'solvente';
  select id into strict cmed    from public.categories where pg_temp.norm(name) = 'impresion medicina (precio especial)';

  -- ==== TRIPWIRE semántico de la columna color (ANTES de tocar nada) ====
  -- La única confirmación válida de 'false'=b/n / 'true'=color es el orden de
  -- precios (los nombres de regla no sirven: las 4 del 75 gr se llaman igual).
  select price into strict q1 from public.product_variants where is_active and product_id = p75 and name = 'OBRA 75 GR S/F' and color = 'false';
  select price into strict q2 from public.product_variants where is_active and product_id = p75 and name = 'OBRA 75 GR D/F' and color = 'false';
  select price into strict q3 from public.product_variants where is_active and product_id = p75 and name = 'OBRA 75 GR S/F' and color = 'true';
  select price into strict q4 from public.product_variants where is_active and product_id = p75 and name = 'OBRA 75 GR D/F' and color = 'true';
  if not (q1 < q2 and q2 < q3 and q3 < q4) then
    raise exception 'TRIPWIRE 75gr: orden de precios inesperado (%, %, %, %) — la semántica de color no es la asumida; NO aplicar', q1, q2, q3, q4;
  end if;

  -- 106: tres variantes tienen precio_lista $0 → el ancla es el PRIMER BRACKET de
  -- la regla quantity_range propia de cada variante (esperado 180 < 230 < 480 < 680).
  select (r.effect->'ranges'->0->>'value')::numeric into strict q1
    from public.pricing_rule_targets t join public.pricing_rules r on r.id = t.pricing_rule_id
    where r.is_active and r.rule_type = 'quantity_range'
      and t.product_variant_id = (select id from public.product_variants where is_active and product_id = p106 and name = 'S/F' and color = 'false');
  select (r.effect->'ranges'->0->>'value')::numeric into strict q2
    from public.pricing_rule_targets t join public.pricing_rules r on r.id = t.pricing_rule_id
    where r.is_active and r.rule_type = 'quantity_range'
      and t.product_variant_id = (select id from public.product_variants where is_active and product_id = p106 and name = 'D/F' and color = 'false');
  select (r.effect->'ranges'->0->>'value')::numeric into strict q3
    from public.pricing_rule_targets t join public.pricing_rules r on r.id = t.pricing_rule_id
    where r.is_active and r.rule_type = 'quantity_range'
      and t.product_variant_id = (select id from public.product_variants where is_active and product_id = p106 and name = 'S/F' and color = 'true');
  select (r.effect->'ranges'->0->>'value')::numeric into strict q4
    from public.pricing_rule_targets t join public.pricing_rules r on r.id = t.pricing_rule_id
    where r.is_active and r.rule_type = 'quantity_range'
      and t.product_variant_id = (select id from public.product_variants where is_active and product_id = p106 and name = 'D/F' and color = 'true');
  if not (q1 < q2 and q2 < q3 and q3 < q4) then
    raise exception 'TRIPWIRE 106gr: orden de primer-bracket inesperado (%, %, %, %) — NO aplicar', q1, q2, q3, q4;
  end if;

  -- ==== variante_meta: los 8 renames de la zona sucia (eje color al nombre) ====
  select id into strict v from public.product_variants where is_active and product_id = p75 and name = 'OBRA 75 GR S/F' and color = 'false';
  insert into bot.variante_meta (variante_id, display_variante) values (v, 'simple faz b/n')
    on conflict (variante_id) do update set display_variante = excluded.display_variante, updated_at = now();
  select id into strict v from public.product_variants where is_active and product_id = p75 and name = 'OBRA 75 GR D/F' and color = 'false';
  insert into bot.variante_meta (variante_id, display_variante) values (v, 'doble faz b/n')
    on conflict (variante_id) do update set display_variante = excluded.display_variante, updated_at = now();
  select id into strict v from public.product_variants where is_active and product_id = p75 and name = 'OBRA 75 GR S/F' and color = 'true';
  insert into bot.variante_meta (variante_id, display_variante) values (v, 'simple faz color')
    on conflict (variante_id) do update set display_variante = excluded.display_variante, updated_at = now();
  select id into strict v from public.product_variants where is_active and product_id = p75 and name = 'OBRA 75 GR D/F' and color = 'true';
  insert into bot.variante_meta (variante_id, display_variante) values (v, 'doble faz color')
    on conflict (variante_id) do update set display_variante = excluded.display_variante, updated_at = now();
  select id into strict v from public.product_variants where is_active and product_id = p106 and name = 'S/F' and color = 'false';
  insert into bot.variante_meta (variante_id, display_variante) values (v, 'simple faz b/n')
    on conflict (variante_id) do update set display_variante = excluded.display_variante, updated_at = now();
  select id into strict v from public.product_variants where is_active and product_id = p106 and name = 'D/F' and color = 'false';
  insert into bot.variante_meta (variante_id, display_variante) values (v, 'doble faz b/n')
    on conflict (variante_id) do update set display_variante = excluded.display_variante, updated_at = now();
  select id into strict v from public.product_variants where is_active and product_id = p106 and name = 'S/F' and color = 'true';
  insert into bot.variante_meta (variante_id, display_variante) values (v, 'simple faz color')
    on conflict (variante_id) do update set display_variante = excluded.display_variante, updated_at = now();
  select id into strict v from public.product_variants where is_active and product_id = p106 and name = 'D/F' and color = 'true';
  insert into bot.variante_meta (variante_id, display_variante) values (v, 'doble faz color')
    on conflict (variante_id) do update set display_variante = excluded.display_variante, updated_at = now();

  -- ==== producto_meta: displays + PODAS (reemplazo completo) ====
  -- IMPRESIONES → display + array VACÍO (los 4 sinónimos eran rubro-genéricos:
  -- 'impresiones','impresiones a color','imprimir a color','trabajo de imprenta')
  -- + auto_sinonimo=false (ver comentario de la vista) + casos de mostrador nuevos.
  -- NO dice A4: el dato no está en la BD (gate TG). El display en sí arranca con
  -- "Impresiones" → rank 2 sigue mapeando el habla genérica, como multi-match.
  -- Toda PODA (reemplazo completo) reporta el array vivo ANTES de pisarlo:
  -- si entre el seed y hoy hubo curado manual, se ve en el output (Fable R4).
  select sinonimos into viejo from bot.producto_meta where producto_id = p75;
  raise notice 'PODA IMPRESIONES: sinonimos % -> {}', coalesce(viejo, '{}');
  insert into bot.producto_meta (producto_id, display_name, auto_sinonimo, sinonimos, casos_de_uso, updated_at)
  values (p75, 'Impresiones papel obra 75 gr', false, '{}',
          array['para imprimir apuntes','para imprimir exámenes o parciales','para trabajos de la facultad','para imprimir un currículum / cv'], now())
  on conflict (producto_id) do update
    set display_name = excluded.display_name, auto_sinonimo = excluded.auto_sinonimo,
        sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, updated_at = now();

  -- 106 → display PLURAL deliberado (el eco "impresiones" cae por contains en AMBOS
  -- obra → ambiguo → email honesto). Poda de los 2 sinónimos clase-nombrados
  -- ('papel obra impreso','impresion papel obra'); retiene los a4-específicos
  -- (unívocos en el mundo cerrado actual; se revisan si TG confirma que el 75 es a4).
  select sinonimos into viejo from bot.producto_meta where producto_id = p106;
  raise notice 'PODA 106gr: sinonimos % -> {impresion a4, hoja a4 impresa}', coalesce(viejo, '{}');
  insert into bot.producto_meta (producto_id, display_name, sinonimos, updated_at)
  values (p106, 'Impresiones a4 papel obra 106 gr', array['impresion a4','hoja a4 impresa'], now())
  on conflict (producto_id) do update
    set display_name = excluded.display_name, sinonimos = excluded.sinonimos, updated_at = now();

  -- Medicina → poda del hijack activo ('apuntes' pelado mandaba a cualquier
  -- estudiante al precio especial) + anti-header 'impresion medicina' + casos
  -- acotados a medicina.
  select sinonimos into viejo from bot.producto_meta where producto_id = pmed;
  raise notice 'PODA Medicina: sinonimos % -> {apuntes de medicina, modulos medicina, modulos de medicina, modulos carrera medicina, impresion medicina}', coalesce(viejo, '{}');
  insert into bot.producto_meta (producto_id, sinonimos, casos_de_uso, updated_at)
  values (pmed, array['apuntes de medicina','modulos medicina','modulos de medicina','modulos carrera medicina','impresion medicina'],
          array['para la facultad de medicina'], now())
  on conflict (producto_id) do update
    set sinonimos = excluded.sinonimos, casos_de_uso = excluded.casos_de_uso, updated_at = now();

  -- ==== PODAS TIER A (scan Fable R4 del seed legacy — hijacks y colisiones) ====
  -- Anatomía común: sinónimo que nombra una CLASE (o el nombre de OTRO producto)
  -- pero rank-1ea único a un producto → cotización/ruteo confiado del equivocado.
  -- Post-poda, el contains (rank 2) da multi-producto → 2b/ambiguo honesto.
  -- 'lona mate' en Vinilo Mate era un bug VIVO: iguala el nombre exacto del
  -- producto Lona Mate → rank-1 doble → ambiguo para un nombre EXACTO listado.
  select sinonimos into viejo from bot.producto_meta where producto_id = pvmate;
  raise notice 'PODA Vinilo Mate: % -> {vinilo mate, vinil mate, vinilo sin brillo, vinil}', coalesce(viejo, '{}');
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (pvmate, array['vinilo mate','vinil mate','vinilo sin brillo','vinil'], now())
  on conflict (producto_id) do update set sinonimos = excluded.sinonimos, updated_at = now();

  select sinonimos into viejo from bot.producto_meta where producto_id = pmicro;
  raise notice 'PODA Microperforado: % -> {microperforado, micoperforado, tela perforada}', coalesce(viejo, '{}');
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (pmicro, array['microperforado','micoperforado','tela perforada'], now())
  on conflict (producto_id) do update set sinonimos = excluded.sinonimos, updated_at = now();

  -- Autoadhesivo: poda 'troquelado' (nombra el servicio de Taller) y 'adhesivo
  -- brillo' (coin-flip con 'adhesivo brillante' del OPP) + altas stickers/sticker.
  select sinonimos into viejo from bot.producto_meta where producto_id = pauto;
  raise notice 'PODA Autoadhesivo: % -> {autoadhesivo, papel engomado, sticker paper, stickers, sticker}', coalesce(viejo, '{}');
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (pauto, array['autoadhesivo','papel engomado','sticker paper','stickers','sticker'], now())
  on conflict (producto_id) do update set sinonimos = excluded.sinonimos, updated_at = now();

  select sinonimos into viejo from bot.producto_meta where producto_id = psobre;
  raise notice 'PODA Sobre Ingles (Libreria): % -> {sobre clasico, sobre blanco, sobre estampa}', coalesce(viejo, '{}');
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (psobre, array['sobre clasico','sobre blanco','sobre estampa'], now())
  on conflict (producto_id) do update set sinonimos = excluded.sinonimos, updated_at = now();

  -- Tacos 10x7 negro: poda 'tacos' (clase de 6) y 'taco de papel' (par con Taller)
  select sinonimos into viejo from bot.producto_meta where producto_id = ptacneg;
  raise notice 'PODA Tacos 10x7 negro: % -> {emblocados negro, bloque 10x7}', coalesce(viejo, '{}');
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (ptacneg, array['emblocados negro','bloque 10x7'], now())
  on conflict (producto_id) do update set sinonimos = excluded.sinonimos, updated_at = now();

  -- Emblocados Taller: poda 'emblocado' (contains lo cubre) y 'tacos de papel'
  select sinonimos into viejo from bot.producto_meta where producto_id = pembl;
  raise notice 'PODA Emblocados Taller: % -> {bloques de papel, papel emblocado, libretitas emblocadas}', coalesce(viejo, '{}');
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (pembl, array['bloques de papel','papel emblocado','libretitas emblocadas'], now())
  on conflict (producto_id) do update set sinonimos = excluded.sinonimos, updated_at = now();

  -- OPP Mate/Holo: poda 'holografico','glitter' (pisaban por best-rank al producto
  -- de Impresión Uv Holografico/Glitter), 'plata' (radiactivo), 'crystal'
  select sinonimos into viejo from bot.producto_meta where producto_id = popp;
  raise notice 'PODA OPP Mate/Holo: % -> {opp mate, opp}', coalesce(viejo, '{}');
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (popp, array['opp mate','opp'], now())
  on conflict (producto_id) do update set sinonimos = excluded.sinonimos, updated_at = now();

  -- OPP Brillo: poda 'adhesivo brillante' (par coin-flip con el autoadhesivo)
  select sinonimos into viejo from bot.producto_meta where producto_id = poppb;
  raise notice 'PODA OPP Brillo: % -> {opp brillo, plastico brillante, film brillante}', coalesce(viejo, '{}');
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (poppb, array['opp brillo','plastico brillante','film brillante'], now())
  on conflict (producto_id) do update set sinonimos = excluded.sinonimos, updated_at = now();

  -- Corte x Millar: poda 'corte' (genérico de servicio; el corte chico suelto es
  -- justamente el gap TG-gated)
  select sinonimos into viejo from bot.producto_meta where producto_id = pcorte;
  raise notice 'PODA Corte x Millar: % -> {corte por millar, corte masivo, corte en cantidad}', coalesce(viejo, '{}');
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (pcorte, array['corte por millar','corte masivo','corte en cantidad'], now())
  on conflict (producto_id) do update set sinonimos = excluded.sinonimos, updated_at = now();

  -- Folletos ilustración: poda 'folletos' (clase de 3, contains multi la cubre);
  -- 'volantes' se queda pero DUPLICADO deliberadamente en los 3 folletos (abajo):
  -- rank-1 triple → ambiguo/2b honesto, sin perder el funnel (no es substring de
  -- ningún nombre, la poda seca lo mandaría a regla 4).
  select sinonimos into viejo from bot.producto_meta where producto_id = pfoll1;
  raise notice 'PODA Folletos ilustración: % -> {volantes, hojas volantes, flyers 10x15, folleto ilustracion}', coalesce(viejo, '{}');
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (pfoll1, array['volantes','hojas volantes','flyers 10x15','folleto ilustracion'], now())
  on conflict (producto_id) do update set sinonimos = excluded.sinonimos, updated_at = now();

  -- Displays menores
  insert into bot.producto_meta (producto_id, display_name, updated_at)
  values (piman, 'Imanes (impresión laminada y corte)', now())
  on conflict (producto_id) do update set display_name = excluded.display_name, updated_at = now();
  insert into bot.producto_meta (producto_id, display_name, updated_at)
  values (proll, 'Porta Banner Roll up 0.85 x 2.00 mt', now())
  on conflict (producto_id) do update set display_name = excluded.display_name, updated_at = now();

  -- ==== producto_meta: ALTAS de sinónimos/casos (unión con dedupe NORMALIZADO,
  --      preserva curados — pg_temp.union_sin) ====
  -- espiralado → 5 anillados plástico (NO el metálico: espiral = plástico)
  foreach v in array array[pani24, pani48, pani72, pani96, pania3] loop
    insert into bot.producto_meta (producto_id, sinonimos, updated_at)
    values (v, array['espiralado','espiralar'], now())
    on conflict (producto_id) do update
      set sinonimos = pg_temp.union_sin(bot.producto_meta.sinonimos, excluded.sinonimos), updated_at = now();
  end loop;
  -- enmicado → 3 plastificados (NO carnet: 'carnet plastificado' ya lo resuelve)
  foreach v in array array[ppla4, pploficio, ppla3] loop
    insert into bot.producto_meta (producto_id, sinonimos, updated_at)
    values (v, array['enmicado','enmicar'], now())
    on conflict (producto_id) do update
      set sinonimos = pg_temp.union_sin(bot.producto_meta.sinonimos, excluded.sinonimos), updated_at = now();
  end loop;
  -- 'volantes' DUPLICADO deliberado en los 3 folletos (ver poda de Folletos):
  -- pfoll1 ya lo tiene en su reemplazo; unión en los otros dos
  foreach v in array array[pfoll2, pfoll3] loop
    insert into bot.producto_meta (producto_id, sinonimos, updated_at)
    values (v, array['volantes'], now())
    on conflict (producto_id) do update
      set sinonimos = pg_temp.union_sin(bot.producto_meta.sinonimos, excluded.sinonimos), updated_at = now();
  end loop;
  -- iman/imanes → unión defensiva (no-op si el seed de sinónimos ya corrió)
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (piman, array['iman','imanes'], now())
  on conflict (producto_id) do update
    set sinonimos = pg_temp.union_sin(bot.producto_meta.sinonimos, excluded.sinonimos), updated_at = now();
  -- anti-header restantes (medicina ya lo lleva en su poda)
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (ptonner, array['impresiones a3 negro tonner'], now())
  on conflict (producto_id) do update
    set sinonimos = pg_temp.union_sin(bot.producto_meta.sinonimos, excluded.sinonimos), updated_at = now();
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (puv, array['impresion ultra violeta'], now())
  on conflict (producto_id) do update
    set sinonimos = pg_temp.union_sin(bot.producto_meta.sinonimos, excluded.sinonimos), updated_at = now();
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (pcorrug, array['carteleria en plastico corrugado'], now())
  on conflict (producto_id) do update
    set sinonimos = pg_temp.union_sin(bot.producto_meta.sinonimos, excluded.sinonimos), updated_at = now();
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (pmontado, array['encartonado'], now())
  on conflict (producto_id) do update
    set sinonimos = pg_temp.union_sin(bot.producto_meta.sinonimos, excluded.sinonimos), updated_at = now();
  insert into bot.producto_meta (producto_id, sinonimos, updated_at)
  values (pcarton, array['cartones'], now())
  on conflict (producto_id) do update
    set sinonimos = pg_temp.union_sin(bot.producto_meta.sinonimos, excluded.sinonimos), updated_at = now();
  -- CV como caso de uso también en el laser (el LLM ve DOS candidatos y repregunta;
  -- casos_de_uso no matchea en SQL → nunca cotización confiada por esta vía)
  insert into bot.producto_meta (producto_id, casos_de_uso, updated_at)
  values (pobra80, array['para imprimir un currículum / cv'], now())
  on conflict (producto_id) do update
    set casos_de_uso = pg_temp.union_sin(bot.producto_meta.casos_de_uso, excluded.casos_de_uso), updated_at = now();

  -- ==== rubro_meta: solo jerga → humano ====
  insert into bot.rubro_meta (categoria_id, display_name) values (cinkjet, 'Impresiones (Riso/inkjet)')
    on conflict (categoria_id) do update set display_name = excluded.display_name;
  insert into bot.rubro_meta (categoria_id, display_name) values (cpiezas, 'Piezas gráficas')
    on conflict (categoria_id) do update set display_name = excluded.display_name;
  insert into bot.rubro_meta (categoria_id, display_name) values (csolv, 'Lonas y vinilos')
    on conflict (categoria_id) do update set display_name = excluded.display_name;
  insert into bot.rubro_meta (categoria_id, display_name) values (cmed, 'Impresión Medicina')
    on conflict (categoria_id) do update set display_name = excluded.display_name;

  -- =========================================================================
  -- ASSERTS (sobre el estado FINAL de las vistas; si algo falla, nada aplica)
  -- =========================================================================

  -- A3. Displays coalesced de variantes visibles únicos por producto
  if exists (
    select 1 from bot.variantes vv
    group by vv.producto_id, pg_temp.norm(vv.variante)
    having count(*) > 1
  ) then
    raise exception 'ASSERT A3: displays de variante duplicados dentro de un producto (sanity #3)';
  end if;

  -- A4. Valores NUEVOS de esta migración no chocan con otros productos (el dup
  -- preexistente Sobre Ingles queda fuera: solo se validan estos valores).
  -- Los compartidos a propósito (espiralado en 5 anillados) se excluyen entre sí.
  create temp table _nuevos (producto_id uuid, valor text) on commit drop;
  insert into _nuevos values
    (p75,  'impresiones papel obra 75 gr'),
    (p106, 'impresiones a4 papel obra 106 gr'),
    (p106, 'impresion a4'), (p106, 'hoja a4 impresa'),
    (piman, 'imanes (impresion laminada y corte)'), (piman, 'iman'), (piman, 'imanes'),
    (proll, 'porta banner roll up 0.85 x 2.00 mt'),
    (pmed, 'apuntes de medicina'), (pmed, 'modulos medicina'), (pmed, 'modulos de medicina'),
    (pmed, 'modulos carrera medicina'), (pmed, 'impresion medicina'),
    (pani24, 'espiralado'), (pani24, 'espiralar'), (pani48, 'espiralado'), (pani48, 'espiralar'),
    (pani72, 'espiralado'), (pani72, 'espiralar'), (pani96, 'espiralado'), (pani96, 'espiralar'),
    (pania3, 'espiralado'), (pania3, 'espiralar'),
    (ppla4, 'enmicado'), (ppla4, 'enmicar'), (pploficio, 'enmicado'), (pploficio, 'enmicar'),
    (ppla3, 'enmicado'), (ppla3, 'enmicar'),
    (pauto, 'stickers'), (pauto, 'sticker'),
    (ptonner, 'impresiones a3 negro tonner'),
    (puv, 'impresion ultra violeta'),
    (pcorrug, 'carteleria en plastico corrugado'),
    (pmontado, 'encartonado'),
    (pcarton, 'cartones'),
    (pfoll1, 'volantes'), (pfoll2, 'volantes'), (pfoll3, 'volantes');
  if exists (
    select 1
    from _nuevos n
    join bot.taxonomia t on t.producto_id <> n.producto_id
    where (pg_temp.norm(t.nombre_canonico) = n.valor
           or exists (select 1 from unnest(t.sinonimos) s where pg_temp.norm(s) = n.valor))
      and not exists (select 1 from _nuevos n2 where n2.producto_id = t.producto_id and n2.valor = n.valor)
  ) then
    raise exception 'ASSERT A4: un valor nuevo (display/sinónimo) colisiona con otro producto (sanity #4)';
  end if;

  -- A5. Substring-hazard de los valores NUEVOS: un sinónimo rank-1 que es substring
  -- del nombre de OTRO producto es la firma del hijack ('impresiones' ⊆ 3 nombres).
  -- Scoped a nuevos: el espacio legacy se REPORTA como NOTICE (ej. 'carton' ⊆
  -- "Montado sobre carton" es violación preexistente conocida, no bloqueante).
  if exists (
    select 1
    from _nuevos n
    join bot.taxonomia t on t.producto_id <> n.producto_id
    where length(n.valor) >= 4
      and pg_temp.norm(t.nombre_canonico) like '%' || replace(replace(n.valor,'%','\%'),'_','\_') || '%'
      and not exists (select 1 from _nuevos n2 where n2.producto_id = t.producto_id and n2.valor = n.valor)
  ) then
    raise exception 'ASSERT A5: un sinónimo nuevo es substring del nombre de otro producto — hijack rank-1 (sanity #5)';
  end if;
  for rec in
    select s.sin as sinonimo, t.nombre_canonico as propio, t2.nombre_canonico as ajeno
    from bot.taxonomia t
    cross join lateral unnest(t.sinonimos) s(sin)
    join bot.taxonomia t2 on t2.producto_id <> t.producto_id
    where length(pg_temp.norm(s.sin)) >= 4
      and pg_temp.norm(t2.nombre_canonico) like '%' || pg_temp.likeesc(s.sin) || '%'
  loop
    raise notice 'HAZARD LEGACY (revisar a ojo, no bloquea): sinónimo "%" de "%" es substring de "%"', rec.sinonimo, rec.propio, rec.ajeno;
  end loop;

  -- A6. Anti-header mecánico: todo rubro HOJA con exactamente 1 producto visible
  -- debe resolver su header display al producto (rank 1 exacto/sinónimo o rank 2
  -- contains). Las categorías con hijas (LASER, etc.) quedan fuera: agregarles un
  -- sinónimo genérico fabricaría el hijack que esta migración mata.
  for rec in
    select c.id as cat_id, coalesce(rm.display_name, c.name) as header, min(p.id::text)::uuid as unico
    from public.categories c
    left join bot.rubro_meta rm on rm.categoria_id = c.id
    join public.products p on p.category_id = c.id and p.is_active
    left join bot.producto_meta m on m.producto_id = p.id
    where c.audience = 'publico'
      and not coalesce(m.oculto, false)
      and not exists (select 1 from public.categories ch where ch.parent_id = c.id)
    group by c.id, coalesce(rm.display_name, c.name)
    having count(*) = 1
  loop
    if not exists (
      select 1 from bot.taxonomia t
      where t.producto_id = rec.unico
        and (
          pg_temp.norm(t.nombre_canonico) = pg_temp.norm(rec.header)
          or exists (select 1 from unnest(t.sinonimos) s where pg_temp.norm(s) = pg_temp.norm(rec.header))
          or (length(pg_temp.norm(rec.header)) >= 4
              and pg_temp.norm(t.nombre_canonico) like '%' || pg_temp.likeesc(rec.header) || '%')
        )
    ) then
      raise exception 'ASSERT A6 anti-header: el rubro mono-producto "%" no resuelve a su producto — falta sinónimo', rec.header;
    end if;
  end loop;

  -- A7. Headers de rubro únicos (una colisión fusionaría rubros en el group by)
  if exists (
    select 1 from (
      select pg_temp.norm(coalesce(rm.display_name, c.name)) as h
      from public.categories c
      left join bot.rubro_meta rm on rm.categoria_id = c.id
      where c.audience = 'publico'
    ) x group by h having count(*) > 1
  ) then
    raise exception 'ASSERT A7: displays de rubro duplicados — el group by del catálogo fusionaría rubros';
  end if;

  raise notice 'Catálogo limpio v10.8: seed + asserts OK (variante_meta esperado = 8 filas).';
end $$;

commit;

-- =============================================================================
-- Sanity (correr a mano tras aplicar)
-- =============================================================================
-- 1. Los 8 renames y su origen:
--    select producto_id, variante, variante_origen, color, precio_lista, n_reglas_cantidad
--    from bot.variantes where variante_origen <> variante order by producto_id, variante;
--    -- esperado: 8 filas, n_reglas_cantidad = 1 en todas
-- 2. Catálogo agrupado como lo ve el LLM (misma query que el nodo Get Catálogo):
--    pegar la query del nodo y mirar: RUBRO: Impresiones (Riso/inkjet) con las dos
--    líneas "Impresiones ... 75 gr" / "Impresiones a4 ... 106 gr", opciones con **.
-- 3. Dup de displays de variante (debe dar 0 filas):
--    select producto_id, variante, count(*) from bot.variantes group by 1,2 having count(*) > 1;
-- 4/5. Colisiones/hazard (deben dar 0 filas — espejo de los asserts):
--    select * from bot.taxonomia t, unnest(t.sinonimos) s
--    where exists (select 1 from bot.taxonomia t2 where t2.producto_id <> t.producto_id
--                  and translate(lower(t2.nombre_canonico),'áéíóúñ','aeioun') = translate(lower(s),'áéíóúñ','aeioun'));
-- 6. Reconciliación variante_meta (para el digest semanal; fila con display == nombre
--    vivo = redundante → borrar; count esperado hoy: 8):
--    select vm.variante_id, vm.display_variante, pv.name as nombre_vivo
--    from bot.variante_meta vm join public.product_variants pv on pv.id = vm.variante_id;
-- 7. El hijack muerto (las dos consultas que motivaron todo):
--    -- "impresiones" pelado ya NO es sinónimo rank-1 de nada:
--    select nombre_canonico from bot.taxonomia t
--    where exists (select 1 from unnest(t.sinonimos) s
--                  where translate(lower(s),'áéíóúñ','aeioun') = 'impresiones');  -- esperado: 0 filas
-- =============================================================================
