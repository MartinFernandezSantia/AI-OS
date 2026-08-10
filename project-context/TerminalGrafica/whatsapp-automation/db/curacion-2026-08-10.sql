-- =====================================================================
-- CURACIÓN 2026-08-10 — Correcciones de datos del empleado de TG (RAG-lite)
--
-- Qué resuelve. Martin probó el bot RAG y un empleado de TG pasó correcciones
-- de catálogo. Estas son las que se resuelven en DATOS (las de comportamiento
-- fueron al prompt del Agente, commit AIOS b5307b0; y dos de precio quedan
-- diferidas: rango de planos y encapado del encartonado).
--
-- MODELO v4 (producto-bot materializado). A diferencia de las curaciones
-- viejas (upsert a bot.producto_meta resolviendo public.products por nombre),
-- acá se EDITA DIRECTO bot.producto por su CLAVE NATURAL (columna `clave`).
-- El export v4 (curador-export-v4.sql) lee estas columnas y las hornea al chunk.
-- La reconciliación es insert-only → estos UPDATE persisten.
--
-- NUNCA se toca public.products / public.product_variants (precio y color salen
-- de ahí vía la vista bot.variantes). Cada UPDATE avisa por NOTICE si no matcheó
-- ninguna fila (clave renombrada / distinta en este entorno).
--
-- Uso (Martin): correr en el SQL editor de Supabase → revisar NOTICE →
-- re-correr db/curador-export-v4.sql → guardar export-actualizado-catalogo-v4.json →
-- re-ingestar: pnpm rag:ingest --apply (el texto del chunk cambió).
-- =====================================================================

begin;

-- 1) Ocultar "Cartón" (solo se ofrecen los encartonados = "Montado sobre cartón").
do $$
declare n int;
begin
  update bot.producto set oculto = true where clave = 'carton|cartones';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'SKIPPED 1: no se encontró carton|cartones'; end if;
end $$;

-- 2) OPP (los dos): agregar caso de uso "resistente al agua" + nota. Es el ÚNICO
--    papel que se imprime resistente al agua (láser); simil vinilo, menor calidad.
do $$
declare n int;
begin
  update bot.producto
    set casos_de_uso = (
          select array_agg(distinct x order by x)
          from unnest(casos_de_uso || array['para impresiones resistentes al agua']) x),
        nota = 'Único papel que se imprime resistente al agua (láser). Es tipo vinilo plástico, de menor calidad.'
    where clave in ('opp brillo|soportes especiales',
                    'opp mate, holografico, plata, cristal, glitter o kraft|soportes especiales');
  get diagnostics n = row_count;
  if n < 2 then raise notice 'SKIPPED 2: se esperaban 2 filas OPP, se actualizaron %', n; end if;
end $$;

-- 3) Impresión láser ilustración mate 250 A5: se imprime a color (hoy color=null).
do $$
declare n int;
begin
  update bot.producto set nota = 'Se imprime a color.'
    where clave = 'impresion laser papel ilustracion mate 250 gr a5|laser';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'SKIPPED 3: no se encontró el A5 láser'; end if;
end $$;

-- 4) Imanes: la impresión es laminada, en lámina A3.
do $$
declare n int;
begin
  update bot.producto set nota = 'La impresión es laminada, en lámina A3.'
    where clave = 'imanes (impresion laminada y corte)|iman';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'SKIPPED 4: no se encontró imanes'; end if;
end $$;

-- 5) Obra 75: papel estándar para impresiones comunes; obra 75 = obra 80.
do $$
declare n int;
begin
  update bot.producto set nota = 'Papel estándar para impresiones comunes. Obra 75 y obra 80 son equivalentes.'
    where clave = 'impresion papel obra 75 gr|impresiones inkjet/ricoh/riso/epson';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'SKIPPED 5: no se encontró obra 75'; end if;
end $$;

-- 6) Cocodrilo → "Broche cocodrilo" (el empleado lo describió como un brochesito).
--    Pendiente confirmación de TG (pregunta 80): si NO es un broche, revertir.
do $$
declare n int;
begin
  update bot.producto set nombre_bot = 'Broche cocodrilo'
    where clave = 'cocodrilo|plastificado';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'SKIPPED 6: no se encontró cocodrilo'; end if;
end $$;

-- 7) Carpetas de presentación A4: son personalizadas (las imprime la gráfica).
--    OJO: siguen en la familia "libreria", cuya nota dice "se venden sueltos, no
--    es un trabajo a medida" → contradice. Pendiente decisión (pregunta 81): la
--    nota de acá aclara, pero si querés mover de familia, es otro cambio.
do $$
declare n int;
begin
  update bot.producto set nota = 'Personalizadas: las imprimimos con tu diseño.'
    where clave = 'carpetas-75139b';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'SKIPPED 7: no se encontró carpetas de presentación'; end if;
end $$;

-- 8) Montado sobre cartón (encartonado): NO incluye la impresión; se cobra aparte
--    (impresión en encapado). Acá solo la nota informativa; sumar el precio del
--    encapado es Workstream C (motor de cotización). Pendiente wording TG (preg. 82).
do $$
declare n int;
begin
  update bot.producto set nota = 'El montado sobre cartón NO incluye la impresión. La impresión se hace en papel encapado y se cobra aparte.'
    where clave = 'montado sobre carton|encartonado';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'SKIPPED 8: no se encontró montado sobre carton'; end if;
end $$;

commit;
