-- =============================================================================
-- EXPORT DEL CATÁLOGO A JSON — v2 (post E0)
-- =============================================================================
-- Reemplaza a `curador-export.sql`, que es de antes de la atomización y NO trae
-- `familias`, `atributos` ni `rangos_cantidad` — justo las tres columnas que
-- hacen falta para (a) medir la cobertura de la búsqueda por palabra clave y
-- (b) verificar las escaleras de cantidad. El curador visual sigue leyendo este
-- archivo: las claves viejas están todas, sólo se agregan campos.
--
-- Uso (Martin):
--   1. Correrla en el SQL editor del Supabase de TESTING.
--   2. Guardar el resultado como `db/export-actualizado-catalogo.json`
--      (sirve el "download JSON" del editor, que envuelve en [{"export": {...}}],
--      o copiar la celda pelada: las dos formas se leen igual).
--
-- SOLO SELECT: no toca nada. Trae todo lo visible al público, incluidas las
-- filas ocultas por curación (hay que poder des-ocultarlas) y el estado de
-- precio por variante.
--
-- Se lee de las VISTAS `bot.taxonomia` y `bot.variantes` y no de las tablas
-- crudas, para que el export sea exactamente lo que ve el bot: la vista ya
-- resuelve display_name, el merge de atributos producto||variante y el
-- auto-sinónimo. La única excepción es `oculto`, que la vista filtra y acá
-- necesitamos ver, así que esas filas se recuperan aparte.
-- =============================================================================

select json_build_object(
  'exportado', now(),
  'schema_version', 2,
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
        -- lo que el bot usa para resolver un nombre
        'nombre_canonico', coalesce(m.display_name, p.name),
        'sinonimos', coalesce(m.sinonimos, '{}'::text[]),
        -- el auto-sinónimo NO está en la columna: lo agrega la vista bot.taxonomia
        -- cuando el display difiere del nombre vivo. Se replica acá para que el
        -- export muestre el set REAL contra el que matchea el bot.
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
        -- E0
        'familias', coalesce(m.familias, '{}'::text[]),
        'atributos', coalesce(m.atributos, '{}'::jsonb),
        'auto_sinonimo', coalesce(m.auto_sinonimo, true),
        'oculto', coalesce(m.oculto, false),
        'por_pagina', coalesce(m.por_pagina, false),
        'por_pack', coalesce(m.por_pack, false),
        'nombre_origen', m.nombre_origen,
        'variantes', (
          select coalesce(json_agg(json_build_object(
              'variante_id', v.id,
              'nombre_vivo', v.name,
              'display_variante', vm.display_variante,
              -- lo que el bot muestra y contra lo que matchea
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
              -- E0: atributo EFECTIVO = producto || variante (variante gana),
              -- la misma regla que aplica la vista bot.variantes
              'atributos', coalesce(m.atributos, '{}'::jsonb) || coalesce(vm.atributos, '{}'::jsonb),
              'atributos_propios', coalesce(vm.atributos, '{}'::jsonb),
              -- la escalera de cantidad, cruda como la devuelve el motor
              'rangos_cantidad', bv.rangos_cantidad
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
