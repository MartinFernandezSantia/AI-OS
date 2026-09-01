-- =============================================================================
-- EXPORT DEL CATÁLOGO A JSON — v4 (modelo producto-bot para RAG) · GREENFIELD
-- =============================================================================
-- Fuente: bot.product / bot.variant (schema greenfield: schema-bot.sql). La unidad
-- es el PRODUCTO-BOT (N variantes de public que cuelgan). El PRECIO no se guarda en
-- bot: se resuelve acá desde public.product_variants + public.pricing_rules por
-- variant_id (misma lógica que la vieja vista bot.variantes / cotizador-v7), así
-- price-display funciona aunque un producto-bot agrupe variantes con cobros distintos.
--
-- Reemplaza al export viejo (leía bot.producto/producto_item/variantes/variante_meta/
-- familia, que el greenfield eliminó). Emite el MISMO JSON schema_version=4 que ya
-- consume el ingest (lib/catalog/{types,loader,rag-chunk}.ts) — sin familias/peso.
--
-- Uso (Martin): correr en el SQL editor del Supabase de TESTING → guardar como
--   db/export-actualizado-catalogo-v4.json → re-ingestar (pnpm rag:ingest).
-- SOLO SELECT. schema_version = 4.
--
-- Claves de metadata que consume el bot (estables, para no tocar los nodos):
--   producto_id = bot.product.key   (clave natural, NO uuid: testing y prod difieren)
--   nombre_canonico = bot_name       (lo resuelve el chunk; el flujo de precios matchea por nombre)
-- =============================================================================

with recursive
-- Cadena de categorías (cada categoría → sí misma y todos sus ancestros), para que una
-- regla de precio apuntada a una categoría alcance a los productos de sus subcategorías.
cat_chain as (
  select id as start_id, id as node_id, parent_id from public.categories
  union all
  select cc.start_id, c.id, c.parent_id
  from cat_chain cc
  join public.categories c on c.id = cc.parent_id
),
-- Reglas de precio ACTIVAS que aplican a cada variante, resueltas por las 3 vías de target
-- (variante puntual / producto / cualquier categoría de su cadena). Un target apunta por UNA
-- sola vía (las otras columnas van null), así que el join no infla de más — mismo conteo que
-- la vista vieja bot.variantes.
rules as (
  select v.id as variant_id, r.rule_type, r.effect
  from public.product_variants v
  join public.products p on p.id = v.product_id
  join public.pricing_rule_targets t
    on t.product_variant_id = v.id
    or t.product_id         = v.product_id
    or t.category_id in (select cc.node_id from cat_chain cc where cc.start_id = p.category_id)
  join public.pricing_rules r on r.id = t.pricing_rule_id and r.is_active = true
  where v.is_active
),
-- Precio + flags de confiabilidad POR VARIANTE de public (activa, categoría pública). Es lo que
-- antes traía ya horneado la vista bot.variantes.
pricing as (
  select
    v.id                                                          as variant_id,
    v.name                                                        as variante_origen,
    v.color                                                       as color,
    v.unit                                                        as unidad,          -- MIENTE: no se usa para cobro
    v.price                                                       as precio_lista,
    -- public.product_variants NO tiene columna de freshness de precio (nunca se aplicó
    -- precio-freshness.sql a prod). precio_actualizado es opcional en types.ts y NADIE lo
    -- consume (ni rag-chunk ni price-display) → null. Si algún día se agrega la columna,
    -- volver a `v.price_updated_at`.
    null::timestamptz                                             as precio_actualizado,
    -- mostrable = no hay NINGUNA regla activa (precio de lista limpio y confiable)
    not exists (select 1 from rules rr where rr.variant_id = v.id) as mostrable,
    coalesce(
      (select bool_and(rr.rule_type = 'discount') from rules rr where rr.variant_id = v.id),
      false)                                                       as solo_descuentos,
    exists (
      select 1 from rules rr where rr.variant_id = v.id and rr.rule_type = 'override'
    )                                                              as tiene_override,
    (
      select count(*)::int from rules rr
      where rr.variant_id = v.id and rr.rule_type = 'quantity_range'
    )                                                              as n_reglas_cantidad,
    (
      select rr.effect->'ranges' from rules rr
      where rr.variant_id = v.id and rr.rule_type = 'quantity_range' limit 1
    )                                                              as rangos_cantidad
  from public.product_variants v
  join public.products  p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  where v.is_active = true
    and p.is_active = true
    and c.audience  = 'publico'
)
select json_build_object(
  'exportado', now(),
  'schema_version', 4,

  -- un objeto por producto-bot VISIBLE (no oculto) con al menos un item exportable
  'productos', (
    select coalesce(json_agg(prod order by prod->>'nombre_bot'), '[]'::json)
    from (
      select json_build_object(
        'producto_id',  bp.key,                  -- clave natural = clave de metadata
        'nombre_bot',   bp.bot_name,
        'sinonimos',    bp.synonyms,
        'casos_de_uso', bp.use_cases,
        'nicho',        bp.niche,
        'nota',         bp.note,
        'oculto',       bp.hidden,
        -- items = variantes de public que cuelgan (no ocultas), con su cobro resuelto POR ITEM.
        -- INNER join a pricing: una variante inactiva/no-pública no se exporta (no inventa cobro).
        -- OJO: este json_build_object está DUPLICADO en 'trabajos'.componentes (abajo) → cambio de
        -- campos = tocar los DOS bloques.
        'items', (
          select coalesce(json_agg(json_build_object(
              'variante_id',        pr.variant_id,
              'nombre_variante_bot', coalesce(bv.bot_name, pr.variante_origen),
              'variante_origen',    pr.variante_origen,
              'color',              pr.color,
              'unidad',             pr.unidad,
              'precio_lista',       pr.precio_lista,
              'precio_actualizado', pr.precio_actualizado,
              -- cobro curado POR ITEM (lo que price-display consume)
              'por_pack',           coalesce(bv.by_pack, false),
              'atributos',          jsonb_build_object(
                                       'unidad_venta',  bv.sale_unit,
                                       'pack_unidades', bv.pack_units
                                    ),
              'rangos_cantidad',    pr.rangos_cantidad,
              -- marca de confiabilidad del precio (resuelta desde pricing_rules)
              'mostrable',          pr.mostrable,
              'tiene_override',     pr.tiene_override,
              'solo_descuentos',    pr.solo_descuentos,
              'n_reglas_cantidad',  pr.n_reglas_cantidad
            ) order by coalesce(bv.bot_name, pr.variante_origen)), '[]'::json)
          from bot.variant bv
          join pricing pr on pr.variant_id = bv.variant_id
          where bv.product_id = bp.id and not bv.hidden
        )
      ) as prod
      from bot.product bp
      where not bp.hidden
        -- no emitir un producto-bot que quedaría sin items exportables (chunk degenerado)
        and exists (
          select 1
          from bot.variant bv
          join pricing pr on pr.variant_id = bv.variant_id
          where bv.product_id = bp.id and not bv.hidden
        )
    ) s
  ),

  -- un objeto por TRABAJO (combo) VISIBLE con al menos un material exportable. Los materiales se agrupan
  -- por PRODUCTO-BOT: cada 'componente'/parte = un bot.product con sus variantes ALTERNATIVAS ('items').
  -- El bot combina una opción de cada parte. NO se emite 'total': lo CALCULA TS (chunkTrabajo) como la
  -- combinación más barata. El objeto de item es una copia EXACTA del json de item de producto (arriba)
  -- → OJO: cambio de campos = tocar los DOS bloques.
  'trabajos', (
    select coalesce(json_agg(job order by job->>'nombre_bot'), '[]'::json)
    from (
      select json_build_object(
        'producto_id',   bj.key,
        'nombre_bot',    bj.bot_name,
        'sinonimos',     bj.synonyms,
        'casos_de_uso',  bj.use_cases,
        'nicho',         bj.niche,
        'nota',          bj.note,
        'oculto',        bj.hidden,
        'mostrar_total', bj.show_total,
        -- partes: un objeto por producto-bot presente entre los materiales, con sus variantes en 'items'.
        'componentes', (
          select coalesce(json_agg(comp order by comp->>'nombre_bot'), '[]'::json)
          from (
            select json_build_object(
              'producto_id', bp.key,
              'nombre_bot',  bp.bot_name,
              'items', json_agg(json_build_object(
                  'variante_id',        pr.variant_id,
                  'nombre_variante_bot', coalesce(bv.bot_name, pr.variante_origen),
                  'variante_origen',    pr.variante_origen,
                  'color',              pr.color,
                  'unidad',             pr.unidad,
                  'precio_lista',       pr.precio_lista,
                  'precio_actualizado', pr.precio_actualizado,
                  'por_pack',           coalesce(bv.by_pack, false),
                  'atributos',          jsonb_build_object(
                                           'unidad_venta',  bv.sale_unit,
                                           'pack_unidades', bv.pack_units
                                        ),
                  'rangos_cantidad',    pr.rangos_cantidad,
                  'mostrable',          pr.mostrable,
                  'tiene_override',     pr.tiene_override,
                  'solo_descuentos',    pr.solo_descuentos,
                  'n_reglas_cantidad',  pr.n_reglas_cantidad
                ) order by coalesce(bv.bot_name, pr.variante_origen))
            ) as comp
            from bot.job_material jm
            join bot.variant bv on bv.id = jm.bot_variant_id
            join bot.product bp on bp.id = bv.product_id
            join pricing pr on pr.variant_id = bv.variant_id
            where jm.job_id = bj.id and not bv.hidden
            group by bp.id, bp.key, bp.bot_name
          ) c
        )
      ) as job
      from bot.job bj
      where not bj.hidden
        -- no emitir un trabajo sin materiales exportables (chunk degenerado)
        and exists (
          select 1
          from bot.job_material jm
          join bot.variant bv on bv.id = jm.bot_variant_id
          join pricing pr on pr.variant_id = bv.variant_id
          where jm.job_id = bj.id and not bv.hidden
        )
    ) sj
  )
) as export;
