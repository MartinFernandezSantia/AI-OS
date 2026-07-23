-- =============================================================================
-- CURADOR VISUAL — export del catálogo a JSON (paso 1 de 3)
-- =============================================================================
-- Uso (Martin):
--   1. Correr esta query en el SQL editor del Supabase de testing.
--   2. Guardar el resultado como `catalogo-export.json` — sirve tanto el
--      "download JSON" del editor (viene envuelto como [{"export": {...}}])
--      como copiar la celda pelada; el curador acepta ambas formas y repara
--      solo el encoding si el archivo se guardó roto (Ã³ en vez de ó).
--   3. Abrir tools/curador-catalogo.html en el navegador y cargar ese archivo.
--
-- La query es SOLO SELECT (no toca nada). Trae TODO lo visible al público,
-- incluidas las filas ocultas por la curación (el curador debe poder des-ocultar)
-- y el estado de precio por variante (para renderizar las marcas */** como las
-- ve el LLM). El timestamp `exportado` keyea la sesión de trabajo en el browser
-- (localStorage) y el SQL generado condiciona cada upsert al nombre vivo
-- exportado (staleness: si el mostrador renombró algo en el medio, esa fila se
-- saltea con NOTICE en vez de pisarse).
-- =============================================================================

select json_build_object(
  'exportado', now(),
  'schema_version', 1,
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
        'sinonimos', coalesce(m.sinonimos, '{}'::text[]),
        'casos_de_uso', coalesce(m.casos_de_uso, '{}'::text[]),
        'auto_sinonimo', coalesce(m.auto_sinonimo, true),
        'oculto', coalesce(m.oculto, false),
        'por_pagina', coalesce(m.por_pagina, false),
        'por_pack', coalesce(m.por_pack, false),
        'nombre_origen', m.nombre_origen,
        'variantes', (
          select coalesce(json_agg(json_build_object(
              'variante_id', v.id,
              'nombre_vivo', v.name,
              'color', v.color,
              'unidad', v.unit,
              'precio_lista', v.price,
              'display_variante', vm.display_variante,
              'oculto', coalesce(vm.oculto, false),
              'mostrable', bv.mostrable,
              'solo_descuentos', bv.solo_descuentos,
              'tiene_override', bv.tiene_override,
              'n_reglas_cantidad', bv.n_reglas_cantidad
            ) order by v.name), '[]'::json)
          from public.product_variants v
          left join bot.variante_meta vm on vm.variante_id = v.id
          left join bot.variantes bv on bv.variante_id = v.id
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
