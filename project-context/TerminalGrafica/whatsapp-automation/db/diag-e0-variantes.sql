-- ============================================================================
-- Diagnóstico: cuáles de las 139 variantes de E0 NO resolvieron.
-- Read-only. Reproduce exactamente el WHERE de la migración.
-- ============================================================================
with esperado(prod, rubro, vari, col) as (values
  ('impresiones', 'impresiones inkjet/ricoh/riso/epson', 'obra 75 gr s/f', 'false'),
  ('impresiones', 'impresiones inkjet/ricoh/riso/epson', 'obra 75 gr s/f', 'true'),
  ('impresiones', 'impresiones inkjet/ricoh/riso/epson', 'obra 75 gr d/f', 'false'),
  ('impresiones', 'impresiones inkjet/ricoh/riso/epson', 'obra 75 gr d/f', 'true'),
  ('impresion a4 papel obra de 106 gr', 'impresiones inkjet/ricoh/riso/epson', 's/f', 'false'),
  ('impresion a4 papel obra de 106 gr', 'impresiones inkjet/ricoh/riso/epson', 's/f', 'true'),
  ('impresion a4 papel obra de 106 gr', 'impresiones inkjet/ricoh/riso/epson', 'd/f', 'false'),
  ('impresion a4 papel obra de 106 gr', 'impresiones inkjet/ricoh/riso/epson', 'd/f', 'true'),
  ('obra 80 gr', 'impresiones laser color', 'a3', null),
  ('obra 80 gr', 'impresiones laser color', 'a3+', null),
  ('obra 80 gr', 'impresiones laser color', 'a4', null),
  ('obra 80 gr', 'impresiones laser color', 'oficio', null),
  ('obra 80 gr', 'impresiones laser color', 'oficio', null),
  ('obra 106 gr', 'impresiones laser color', 'a3', null),
  ('obra 106 gr', 'impresiones laser color', 'a3+', null),
  ('obra 106 gr', 'impresiones laser color', 'a4', null),
  ('obra 106 gr', 'impresiones laser color', 'oficio', null),
  ('obra 106 gr', 'impresiones laser color', 'oficio', null),
  ('ilustracion brillo 150 gr', 'impresiones laser color', 'a3', null),
  ('ilustracion brillo 150 gr', 'impresiones laser color', 'a3+', null),
  ('ilustracion brillo 150 gr', 'impresiones laser color', 'a4', null),
  ('ilustracion brillo 150 gr', 'impresiones laser color', 'oficio', null),
  ('ilustracion brillo 150 gr', 'impresiones laser color', 'oficio', null),
  ('ilustracion mate 250 gr', 'impresiones laser color', 'a3', null),
  ('ilustracion mate 250 gr', 'impresiones laser color', 'a3+', null),
  ('ilustracion mate 250 gr', 'impresiones laser color', 'a4', null),
  ('ilustracion mate 250 gr', 'impresiones laser color', 'oficio', null),
  ('ilustracion mate 250 gr', 'impresiones laser color', 'oficio', null),
  ('ilustracion mate 250 gr', 'impresiones laser color', 'troquelado', null),
  ('ilustracion mate 300 gr', 'impresiones laser color', 'a3', null),
  ('ilustracion mate 300 gr', 'impresiones laser color', 'a3+', null),
  ('ilustracion mate 300 gr', 'impresiones laser color', 'a4', null),
  ('ilustracion mate 300 gr', 'impresiones laser color', 'oficio', null),
  ('ilustracion mate 300 gr', 'impresiones laser color', 'oficio', null),
  ('opalina obra 250 gr', 'impresiones laser color', 'a3', null),
  ('opalina obra 250 gr', 'impresiones laser color', 'a3+', null),
  ('opalina obra 250 gr', 'impresiones laser color', 'a4', null),
  ('opalina obra 250 gr', 'impresiones laser color', 'oficio', null),
  ('opalina obra 250 gr', 'impresiones laser color', 'oficio', null),
  ('papel autoadhesivo brillo / split', 'soportes especiales', 'a3', null),
  ('papel autoadhesivo brillo / split', 'soportes especiales', 'a4', null),
  ('papel autoadhesivo brillo / split', 'soportes especiales', 'medio corte (troquelado)', null),
  ('papel kraft 130 gr', 'soportes especiales', 'a3', null),
  ('papel kraft 130 gr', 'soportes especiales', 'a4', null),
  ('papel kraft 300 gr', 'soportes especiales', 'a3', null),
  ('papel kraft 300 gr', 'soportes especiales', 'a4', null),
  ('vegetal', 'soportes especiales', 'a4', null),
  ('vegetal', 'soportes especiales', 'oficio / a3', null),
  ('impresion exterior / montado sobre plastico corrugado', 'carteleria en plastico corrugado', '1 x 0.65 mt', null),
  ('impresion exterior / montado sobre plastico corrugado', 'carteleria en plastico corrugado', '1 x 1 mt', null),
  ('impresion exterior / montado sobre plastico corrugado', 'carteleria en plastico corrugado', '2 x 1 mt', null),
  ('impresion exterior / montado sobre plastico corrugado', 'carteleria en plastico corrugado', 'a3', null),
  ('promocion inmobiliarias 6 carteles 1 x 0.65 mt', 'carteleria en plastico corrugado', 'promocion cartel plastico corrugado 1x0.65 mt', null),
  ('carteleria en pvc c/ papel obra/130 gr', 'carteleria en pvc', '100x 70 cm', null),
  ('carteleria en pvc c/ papel obra/130 gr', 'carteleria en pvc', '35x50 cm', null),
  ('carteleria en pvc c/ papel obra/130 gr', 'carteleria en pvc', '50x70 cm', null),
  ('carteleria en pvc c/ papel obra/130 gr', 'carteleria en pvc', '60x90 cm', null),
  ('carteleria en pvc c/ papel obra/130 gr', 'carteleria en pvc', 'a3', null),
  ('carteleria en pvc c/ papel obra/130 gr', 'carteleria en pvc', 'm2', null),
  ('carteleria en pvc c/vinilo brillo/mate', 'carteleria en pvc', '100x 70 cm', null),
  ('carteleria en pvc c/vinilo brillo/mate', 'carteleria en pvc', '35x50 cm', null),
  ('carteleria en pvc c/vinilo brillo/mate', 'carteleria en pvc', '50x70 cm', null),
  ('carteleria en pvc c/vinilo brillo/mate', 'carteleria en pvc', '60x90 cm', null),
  ('carteleria en pvc c/vinilo brillo/mate', 'carteleria en pvc', 'a3', null),
  ('carteleria en pvc c/vinilo brillo/mate', 'carteleria en pvc', 'm2', null),
  ('carton', 'cartones', '100x 70 cm', null),
  ('carton', 'cartones', '35x50 cm', null),
  ('carton', 'cartones', '50x70 cm', null),
  ('carton', 'cartones', '60x90 cm', null),
  ('carton', 'cartones', 'a3', null),
  ('montado sobre carton', 'encartonado', '100x 70 cm', null),
  ('montado sobre carton', 'encartonado', '35x50 cm', null),
  ('montado sobre carton', 'encartonado', '50x70 cm', null),
  ('montado sobre carton', 'encartonado', '60x90 cm', null),
  ('montado sobre carton', 'encartonado', 'a3', null),
  ('encapsulado', 'laminado/brillo mate', 'a3', null),
  ('encapsulado', 'laminado/brillo mate', 'a4', null),
  ('encapsulado', 'laminado/brillo mate', 'metro', null),
  ('laminados', 'laminado/brillo mate', 'a3', null),
  ('laminados', 'laminado/brillo mate', 'a4', null),
  ('laminados', 'laminado/brillo mate', 'metro', null),
  ('perforaciones', 'taller', '500', null),
  ('perforaciones', 'taller', '1000', null),
  ('puntas redondeadas', 'taller', '100', null),
  ('puntas redondeadas', 'taller', '500', null),
  ('puntas redondeadas', 'taller', '1000', null),
  ('emblocados (lado corto o largo) c/carton.', 'taller', 'a3', null),
  ('emblocados (lado corto o largo) c/carton.', 'taller', 'a4', null),
  ('emblocados (lado corto o largo) c/carton.', 'taller', 'a5', null),
  ('emblocados (lado corto o largo) c/carton.', 'taller', 'a6', null),
  ('emblocados (lado corto o largo) c/carton.', 'taller', 'oficio', null),
  ('anillado metalico a4/a3', 'taller', 'hasta 3/4', null),
  ('anillado metalico a4/a3', 'taller', '1"', null),
  ('anillado metalico a4/a3', 'taller', '1" 1/8', null),
  ('anillado metalico a4/a3', 'taller', '1" 1/4', null),
  ('anillado metalico a4/a3', 'taller', '1" 1/2', null),
  ('100 tarjetas color/negro', 'piezas graficas/productos', 'simple faz', null),
  ('100 tarjetas color/negro', 'piezas graficas/productos', 'doble faz', null),
  ('100 tarjetas color/negro', 'piezas graficas/productos', 'simple faz encapsuladas', null),
  ('100 tarjetas color/negro', 'piezas graficas/productos', 'doble faz encapsuladas', null),
  ('500 tarjetas color/negro', 'piezas graficas/productos', 'simple faz', null),
  ('500 tarjetas color/negro', 'piezas graficas/productos', 'doble faz', null),
  ('500 tarjetas color/negro', 'piezas graficas/productos', 'simple faz encapsuladas', null),
  ('500 tarjetas color/negro', 'piezas graficas/productos', 'doble faz encapsuladas', null),
  ('1000 tarjetas color/negro', 'piezas graficas/productos', 'simple faz', null),
  ('1000 tarjetas color/negro', 'piezas graficas/productos', 'doble faz', null),
  ('1000 tarjetas color/negro', 'piezas graficas/productos', 'simple faz encapsuladas', null),
  ('1000 tarjetas color/negro', 'piezas graficas/productos', 'doble faz encapsuladas', null),
  ('100 tarjetas papel kraft 280 gr', 'piezas graficas/productos', 'simple faz', null),
  ('100 tarjetas papel kraft 280 gr', 'piezas graficas/productos', 'doble faz', null),
  ('folletos 10x15 cm papel ilustracion brillo 150 gr', 'piezas graficas/productos', 'x500', null),
  ('folletos 10x15 cm papel ilustracion brillo 150 gr', 'piezas graficas/productos', 'x1000', null),
  ('folletos 10x15 cm papel ilustracion brillo 150 gr', 'piezas graficas/productos', 'x2000', null),
  ('folletos 10x15 cm papel ilustracion brillo 150 gr', 'piezas graficas/productos', 'x3000', null),
  ('folletos 10x15 cm papel obra de 75 gr b/n', 'piezas graficas/productos', 'x500', null),
  ('folletos 10x15 cm papel obra de 75 gr b/n', 'piezas graficas/productos', 'x1000', null),
  ('folletos 10x15 cm papel obra de 75 gr b/n', 'piezas graficas/productos', 'x2000', null),
  ('folletos 10x15 cm papel obra de 75 gr b/n', 'piezas graficas/productos', 'x3000', null),
  ('folletos 10x15 cm papel obra de 75 gr color inkjet', 'piezas graficas/productos', '500', null),
  ('folletos 10x15 cm papel obra de 75 gr color inkjet', 'piezas graficas/productos', '1000', null),
  ('folletos 10x15 cm papel obra de 75 gr color inkjet', 'piezas graficas/productos', '2000', null),
  ('folletos 10x15 cm papel obra de 75 gr color inkjet', 'piezas graficas/productos', '3000', null),
  ('impresion autocad lineal color/negro', 'autocad lineal', 'a3', null),
  ('impresion autocad lineal color/negro', 'autocad lineal', 'a4', null),
  ('impresion autocad lineal color/negro', 'autocad lineal', 'oficio', null),
  ('lineal obra 90 gr color/negro', 'ploteados', '25% cobertura', null),
  ('lineal obra 90 gr color/negro', 'ploteados', '50% cobertura', null),
  ('lineal obra 90 gr color/negro', 'ploteados', '100% cobertura', null),
  ('lineal obra 90 gr color/negro', 'ploteados', 'lineal', null),
  ('papel 130 gr recubierto / encapado', 'ploteados', '25% cobertura', null),
  ('papel 130 gr recubierto / encapado', 'ploteados', '50% cobertura', null),
  ('papel 130 gr recubierto / encapado', 'ploteados', '100% cobertura', null),
  ('papel 130 gr recubierto / encapado', 'ploteados', 'lineal', null),
  ('papel obra vegetal color/negro', 'ploteados', '25% cobertura', null),
  ('papel obra vegetal color/negro', 'ploteados', '50% cobertura', null),
  ('papel obra vegetal color/negro', 'ploteados', '100% cobertura', null),
  ('papel obra vegetal color/negro', 'ploteados', 'lineal', null),
  ('talonarios rifas 100 numeros', 'piezas graficas/productos', 'escala de rifas 10x7cm', null),
  ('talonarios rifas 100 numeros', 'piezas graficas/productos', 'escala de rifas 15x7cm', null)
)
select e.prod, e.rubro, e.vari, e.col,
       (select count(*) from public.products p
          join public.categories c on c.id = p.category_id
         where p.is_active
           and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = e.prod
           and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = e.rubro) as n_productos,
       (select count(*) from public.product_variants v
          join public.products p on p.id = v.product_id
          join public.categories c on c.id = p.category_id
         where v.is_active and p.is_active
           and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = e.prod
           and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = e.rubro
           and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = e.vari
           and v.color is not distinct from e.col) as n_variantes
  from esperado e
 where (select count(*) from public.product_variants v
          join public.products p on p.id = v.product_id
          join public.categories c on c.id = p.category_id
         where v.is_active and p.is_active
           and translate(lower(trim(p.name)), 'áéíóúñ', 'aeioun') = e.prod
           and translate(lower(trim(c.name)), 'áéíóúñ', 'aeioun') = e.rubro
           and translate(lower(trim(v.name)), 'áéíóúñ', 'aeioun') = e.vari
           and v.color is not distinct from e.col) <> 1
 order by e.prod, e.vari;

-- Y el complemento: qué variantes VIVAS quedaron sin atributos.
select t.nombre_canonico, v.variante, v.variante_origen, v.color, v.precio_lista
  from bot.variantes v
  join bot.taxonomia t on t.producto_id = v.producto_id
 where v.atributos = '{}'::jsonb
 order by t.nombre_canonico, v.variante;
