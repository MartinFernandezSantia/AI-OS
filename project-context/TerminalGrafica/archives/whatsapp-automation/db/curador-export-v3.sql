-- =============================================================================
-- EXPORT DEL CATÁLOGO A JSON — v3 (B-26 etapa 3: nombres de reglas de precio)
-- =============================================================================
-- Reemplaza a curador-export-v2.sql agregando, por producto y por variante, los
-- NOMBRES de las pricing_rules activas que los afectan — con el MISMO predicado de
-- match que bot.variantes (variante | producto | cualquier categoría ancestra), así
-- los nombres coinciden con tiene_override / n_reglas_cantidad / solo_descuentos que
-- ya trae el export. Todas las claves viejas están; sólo se agregan campos.
--
-- Uso (Martin):
--   1. Correrla en el SQL editor del Supabase de TESTING.
--   2. Guardar el resultado como db/export-actualizado-catalogo.json.
--   3. Cargarlo en la app (dashboard de catálogo). schema_version = 3.
--
-- SOLO SELECT: no toca nada. Trae todo lo visible al público, incluidas las filas
-- ocultas por curación y el estado de precio por variante.
--
-- Las reglas se separan en dos niveles para no repetir en cada variante las que en
-- realidad son del producto o de una categoría:
--   producto.reglas  = reglas que apuntan al producto o a una categoría ancestra
--                      (afectan a TODAS sus variantes). Cada una trae `origen`.
--   variante.reglas  = reglas que apuntan SÓLO a esa variante puntual.
-- Match idéntico a cotizador-v7b.sql: r.is_active = true (sin filtrar fechas —
-- conservador: ante regla activa, el bot escala).
-- =============================================================================

with recursive cat_chain as (
  -- cada categoría + toda su cadena de ancestros (start_id = la categoría hoja)
  select id as start_id, id as node_id, parent_id from public.categories
  union all
  select cc.start_id, c.id, c.parent_id
  from cat_chain cc
  join public.categories c on c.id = cc.parent_id
)
select json_build_object(
  'exportado', now(),
  'schema_version', 3,
  'rubros', (
    select coalesce(json_agg(json_build_object(
        'categoria_id', c.id,
        'nombre_vivo', c.name,
        'display_name', rm.display_name,
        'parent_id', c.parent_id
      ) order by c.name), '[]'::json)
    from public.categories c
    left join bot.rubro_meta rm on rm.categoria_id = c.id
    where c.audience = 'publico'
  ),
  'productos', (
    select coalesce(json_agg(prod order by prod->>'categoria', prod->>'nombre_vivo'), '[]'::json)
    from (
      select json_build_object(
        'producto_id', p.id,
        'nombre_vivo', p.name,
        'categoria_id', p.category_id,
        'categoria', c.name,
        'categoria_display', rm.display_name,
        'display_name', m.display_name,
        'nombre_canonico', coalesce(m.display_name, p.name),
        'sinonimos', coalesce(m.sinonimos, '{}'::text[]),
        'sinonimos_efectivos', coalesce(m.sinonimos, '{}'::text[])
          || case
               when m.display_name is not null
                and m.display_name <> p.name
                and coalesce(m.auto_sinonimo, true)
                and not exists (
                      select 1 from unnest(coalesce(m.sinonimos, '{}'::text[])) s
                      where translate(lower(s), 'áéíóúñ', 'aeioun')
                          = translate(lower(p.name), 'áéíóúñ', 'aeioun'))
               then array[p.name]
               else '{}'::text[]
             end,
        'casos_de_uso', coalesce(m.casos_de_uso, '{}'::text[]),
        'familias', coalesce(m.familias, '{}'::text[]),
        'atributos', coalesce(m.atributos, '{}'::jsonb),
        'auto_sinonimo', coalesce(m.auto_sinonimo, true),
        'oculto', coalesce(m.oculto, false),
        'por_pagina', coalesce(m.por_pagina, false),
        'por_pack', coalesce(m.por_pack, false),
        'nombre_origen', m.nombre_origen,
        -- NUEVO v3: reglas de nivel producto/categoría (afectan a todas las variantes)
        'reglas', (
          select coalesce(json_agg(x order by x->>'tipo', x->>'nombre'), '[]'::json)
          from (
            select distinct jsonb_build_object(
              'nombre', r.name,
              'tipo', r.rule_type,
              'confirmacion', coalesce(r.confirmation, false),
              'origen', case when t.product_id = p.id then 'producto'
                             else 'categoría: ' || cc_src.name end
            ) as x
            from public.pricing_rule_targets t
            join public.pricing_rules r on r.id = t.pricing_rule_id
            left join public.categories cc_src on cc_src.id = t.category_id
            where r.is_active = true
              and (
                    t.product_id = p.id
                 or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = p.category_id)
              )
          ) sub
        ),
        'variantes', (
          select coalesce(json_agg(json_build_object(
              'variante_id', v.id,
              'nombre_vivo', v.name,
              'display_variante', vm.display_variante,
              'variante', coalesce(vm.display_variante, v.name),
              'color', v.color,
              'unidad', v.unit,
              'precio_lista', v.price,
              'precio_actualizado', v.price_updated_at,
              'oculto', coalesce(vm.oculto, false),
              'mostrable', bv.mostrable,
              'solo_descuentos', bv.solo_descuentos,
              'tiene_override', bv.tiene_override,
              'n_reglas_cantidad', bv.n_reglas_cantidad,
              'atributos', coalesce(m.atributos, '{}'::jsonb) || coalesce(vm.atributos, '{}'::jsonb),
              'atributos_propios', coalesce(vm.atributos, '{}'::jsonb),
              'rangos_cantidad', bv.rangos_cantidad,
              -- NUEVO v3: reglas que apuntan SÓLO a esta variante puntual
              'reglas', (
                select coalesce(json_agg(jsonb_build_object(
                    'nombre', r.name,
                    'tipo', r.rule_type,
                    'confirmacion', coalesce(r.confirmation, false),
                    'origen', 'variante'
                  ) order by r.rule_type, r.name), '[]'::json)
                from public.pricing_rule_targets t
                join public.pricing_rules r on r.id = t.pricing_rule_id
                where r.is_active = true and t.product_variant_id = v.id
              )
            ) order by v.name), '[]'::json)
          from public.product_variants v
          left join bot.variante_meta vm on vm.variante_id = v.id
          left join bot.variantes bv     on bv.variante_id = v.id
          where v.product_id = p.id and v.is_active
        )
      ) as prod
      from public.products p
      join public.categories c on c.id = p.category_id
      left join bot.producto_meta m on m.producto_id = p.id
      left join bot.rubro_meta rm on rm.categoria_id = c.id
      where p.is_active and c.audience = 'publico'
    ) s
  )
) as export;
