-- =============================================================================
-- EXPORT DEL CATÁLOGO A JSON — v4 (modelo producto-bot para RAG)
-- =============================================================================
-- Nueva fuente: bot.producto / bot.producto_item (la unidad es el PRODUCTO-BOT,
-- no el producto de public). El precio y el contexto de cobro salen POR ITEM de
-- bot.variantes, así price-display funciona aunque un producto-bot agrupe variantes
-- de varios productos public con formas de cobro distintas.
--
-- NO reemplaza a v3: coexisten. v3 sigue alimentando la app de curación vieja hasta
-- que se adapte; v4 alimenta el RAG ingest (whatsapp-rag-lite).
--
-- Uso (Martin): correr en el SQL editor del Supabase de TESTING → guardar como
--   db/export-actualizado-catalogo-v4.json → re-ingestar (pnpm rag:ingest).
-- SOLO SELECT. schema_version = 4.
--
-- Claves de metadata que consume el bot (estables, para no tocar los nodos):
--   producto_id = bot.producto.clave  (clave natural, NO uuid: testing y prod difieren)
--   nombre_canonico = nombre_bot      (lo resuelve el chunk; el flujo de precios matchea por nombre)
-- =============================================================================

select json_build_object(
  'exportado', now(),
  'schema_version', 4,

  -- familias con su nota (el chunk hornea la nota al embedding de sus productos)
  'familias', (
    select coalesce(json_agg(json_build_object(
        'clave',  f.clave,
        'nombre', f.nombre,
        'nota',   f.nota
      ) order by f.clave), '[]'::json)
    from bot.familia f
  ),

  -- un objeto por producto-bot visible
  'productos', (
    select coalesce(json_agg(prod order by prod->>'familia', prod->>'nombre_bot'), '[]'::json)
    from (
      select json_build_object(
        'producto_id',  p.clave,                 -- clave natural = clave de metadata
        'clave',        p.clave,
        'nombre_bot',   p.nombre_bot,
        'familia',      p.familia,
        'familia_nota', f.nota,
        'sinonimos',    p.sinonimos,
        'casos_de_uso', p.casos_de_uso,
        'nicho',        p.nicho,
        'nota',         p.nota,
        'peso',         p.peso,
        'oculto',       p.oculto,
        -- items = variantes de public que cuelgan, con su contexto de cobro por item
        'items', (
          select coalesce(json_agg(json_build_object(
              'variante_id',        v.id,
              'nombre_variante_bot', coalesce(pi.nombre_variante_bot, vm.display_variante, v.name),
              'variante_origen',    v.name,
              'color',              v.color,
              'unidad',             bv.unidad,
              'precio_lista',       bv.precio_lista,
              'precio_actualizado', bv.precio_actualizado,
              -- flags/atributos de cobro POR ITEM (lo que price-display necesita)
              'por_pagina',         coalesce(bv.por_pagina, false),
              'por_pack',           coalesce(bv.por_pack, false),
              'atributos',          coalesce(bv.atributos, '{}'::jsonb),
              'rangos_cantidad',    bv.rangos_cantidad,
              -- metadata de reglas (marca de confiabilidad del precio)
              'mostrable',          bv.mostrable,
              'tiene_override',     bv.tiene_override,
              'solo_descuentos',    bv.solo_descuentos,
              'n_reglas_cantidad',  bv.n_reglas_cantidad
            ) order by coalesce(pi.nombre_variante_bot, vm.display_variante, v.name)), '[]'::json)
          from bot.producto_item pi
          join public.product_variants v on v.id = pi.variante_id and v.is_active
          left join bot.variante_meta vm on vm.variante_id = v.id
          left join bot.variantes bv     on bv.variante_id = v.id
          where pi.producto_id = p.id and not pi.oculto
        )
      ) as prod
      from bot.producto p
      left join bot.familia f on f.clave = p.familia
      where not p.oculto
    ) s
  )
) as export;
