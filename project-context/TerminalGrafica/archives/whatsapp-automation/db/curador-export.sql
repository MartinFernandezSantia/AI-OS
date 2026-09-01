-- =============================================================================
-- EXPORT DEL CATÁLOGO A JSON — generador greenfield (modelo 2 tablas)
-- =============================================================================
-- Fuente: bot.product + bot.variant (schema greenfield; ver
-- whatsapp-rag-lite/db/schema-bot.sql). Reemplaza a curador-export-v2/v3/v4.sql
-- (que leían producto_meta/producto_item/familia/vistas — TODO eso murió).
--
-- El PRECIO y el contexto de reglas salen SIEMPRE de public (product_variants +
-- pricing_rules), NUNCA de bot: acá se INLINEA la lógica que antes vivía en la
-- vista bot.variantes (tiene_reglas/override/quantity_range/rangos), porque esa
-- vista ya no existe. Así price-display funciona aunque un producto-bot agrupe
-- variantes de varios productos public con formas de cobro distintas.
--
-- Inglés = SOLO tablas/columnas: las CLAVES del JSON quedan en español (las
-- consume el ingest/tipos/fixtures sin cambios). unidad_venta = bot.variant.sale_unit
-- (token español); pack_unidades = pack_units.
--
-- Uso (Martin): correr en el SQL editor del Supabase → guardar como
--   db/export-catalogo.json → re-ingestar (pnpm rag:ingest). SOLO SELECT.
-- schema_version = 4 (el loader parseExportV4 lo exige; es la única versión viva).
--
-- Claves de metadata que consume el bot (estables, para no tocar los nodos):
--   producto_id = bot.product.key   (clave natural, NO uuid: testing y prod difieren)
--   nombre_canonico = nombre_bot    (lo resuelve el chunk; el flujo de precios matchea por nombre)
-- =============================================================================

with recursive cat_chain as (
  -- cadena de categorías hacia la raíz (para las reglas targeteadas por categoría)
  select id as start_id, id as node_id, parent_id from public.categories
  union all
  select cc.start_id, c.id, c.parent_id
  from cat_chain cc
  join public.categories c on c.id = cc.parent_id
)
select json_build_object(
  'exportado', now(),
  'schema_version', 4,

  'productos', (
    select coalesce(json_agg(prod order by prod->>'nombre_bot'), '[]'::json)
    from (
      select json_build_object(
        'producto_id',  p.key,                 -- clave natural = clave de metadata
        'nombre_bot',   p.bot_name,
        'sinonimos',    p.synonyms,
        'casos_de_uso', p.use_cases,
        'nicho',        p.niche,
        'nota',         p.note,
        'oculto',       p.hidden,
        -- items = variantes de public que cuelgan, con su contexto de cobro POR ITEM
        'items', (
          select coalesce(json_agg(json_build_object(
              'variante_id',        v.id,
              'nombre_variante_bot', coalesce(bv.bot_name, v.name),
              'variante_origen',    v.name,
              'color',              v.color,
              'unidad',             v.unit,                    -- public.unit; MIENTE, no se usa para cobro
              'precio_lista',       v.price,
              'precio_actualizado', v.price_updated_at,
              'por_pack',           bv.by_pack,
              -- atributos EFECTIVOS de cobro (claves en español; las lee price-display):
              -- unidad_venta desde sale_unit (incl. 'pagina', que cubre el viejo por_pagina).
              'atributos', jsonb_strip_nulls(jsonb_build_object(
                              'unidad_venta',  bv.sale_unit,
                              'pack_unidades', bv.pack_units)),
              -- reglas de precio desde public (reemplaza la vista bot.variantes):
              'rangos_cantidad', (
                select r.effect->'ranges'
                from public.pricing_rule_targets t
                join public.pricing_rules r on r.id = t.pricing_rule_id
                where r.is_active and r.rule_type = 'quantity_range'
                  and ( t.product_variant_id = v.id
                     or t.product_id = v.product_id
                     or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = vp.category_id) )
                limit 1
              ),
              -- mostrable = NO tiene ninguna regla activa (precio "limpio")
              'mostrable', not exists (
                select 1
                from public.pricing_rule_targets t
                join public.pricing_rules r on r.id = t.pricing_rule_id
                where r.is_active
                  and ( t.product_variant_id = v.id
                     or t.product_id = v.product_id
                     or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = vp.category_id) )
              ),
              'tiene_override', exists (
                select 1
                from public.pricing_rule_targets t
                join public.pricing_rules r on r.id = t.pricing_rule_id
                where r.is_active and r.rule_type = 'override'
                  and ( t.product_variant_id = v.id
                     or t.product_id = v.product_id
                     or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = vp.category_id) )
              ),
              'solo_descuentos', coalesce((
                select bool_and(r.rule_type = 'discount')
                from public.pricing_rule_targets t
                join public.pricing_rules r on r.id = t.pricing_rule_id
                where r.is_active
                  and ( t.product_variant_id = v.id
                     or t.product_id = v.product_id
                     or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = vp.category_id) )
              ), false),
              'n_reglas_cantidad', (
                select count(*)::int
                from public.pricing_rule_targets t
                join public.pricing_rules r on r.id = t.pricing_rule_id
                where r.is_active and r.rule_type = 'quantity_range'
                  and ( t.product_variant_id = v.id
                     or t.product_id = v.product_id
                     or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = vp.category_id) )
              )
            ) order by coalesce(bv.bot_name, v.name)), '[]'::json)
          -- INNER join a public: una variante inactiva NO se exporta (evita hornear
          -- cobro inventado; el precio/reglas vienen de public, no de bot).
          from bot.variant bv
          join public.product_variants v on v.id = bv.variant_id and v.is_active
          join public.products vp        on vp.id = v.product_id
          where bv.product_id = p.id and not bv.hidden
        )
      ) as prod
      from bot.product p
      where not p.hidden
        -- no emitir un producto-bot que quedaría sin items exportables (chunk degenerado)
        and exists (
          select 1 from bot.variant bv
          join public.product_variants v on v.id = bv.variant_id and v.is_active
          where bv.product_id = p.id and not bv.hidden
        )
    ) s
  )
) as export;
