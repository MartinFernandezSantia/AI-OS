-- =====================================================================
-- CURACIÓN 2026-08-12 — Unidad de venta del imán laminado (RAG-lite)
--
-- Qué resuelve. El bot mostraba "por unidad" para "Imanes (impresión laminada
-- y corte)", pero ese producto se cobra POR PLANCHA A3 (los tramos 1-3 $8.000,
-- 4-10 $7.200, 11-20 $6.500 son por plancha, no por imán). "por unidad" confunde.
-- Se cambia unidad_venta 'unidad' → 'plancha_a3'. El COBRO de price-display.ts
-- (whatsapp-rag-lite) mapea 'plancha_a3' → "por plancha A3".
--
-- Dónde vive el dato. unidad_venta está en bot.producto_meta.atributos (NIVEL
-- PRODUCTO: la variante no tiene override — atributos_propios={}). La vista
-- bot.variantes compone m.atributos || vm.atributos y curador-export-v4.sql
-- hornea eso al chunk. producto_meta.producto_id = public.products.id.
--
-- Resuelve el producto por NOMBRE (los UUID difieren entre testing y prod).
-- Merge con || (idempotente): conserva acabado/multiplica, solo pisa unidad_venta.
--
-- Deja registrada la decisión en db/unidades-venta-decisiones.json (u: plancha_a3).
-- Con el dato ya curado, el override por variante_id de price-display.ts queda
-- redundante y se puede sacar (whatsapp-rag-lite: UNIDAD_VENTA_OVERRIDE).
--
-- Uso (Martin): correr en el SQL editor de Supabase TESTING → revisar NOTICE →
--   re-correr db/curador-export-v4.sql → guardar export-actualizado-catalogo-v4.json →
--   re-ingestar: pnpm rag:ingest --apply (el texto del chunk cambió).
-- SOLO toca bot.producto_meta. NUNCA public.products / public.product_variants.
-- =====================================================================

begin;

-- Imanes laminados: unidad_venta 'unidad' → 'plancha_a3' (se cobra por plancha A3).
do $$
declare n int;
begin
  update bot.producto_meta pm
     set atributos = coalesce(pm.atributos, '{}'::jsonb)
                     || jsonb_build_object('unidad_venta', 'plancha_a3'),
         updated_at = now()
    from public.products p
   where p.id = pm.producto_id
     and lower(p.name) = lower('Iman. Impresión laminada y corte.');
  get diagnostics n = row_count;
  if n = 0 then
    raise notice 'SKIPPED: no se encontró "Iman. Impresión laminada y corte." (¿nombre distinto en este entorno o falta fila en producto_meta?)';
  elsif n > 1 then
    raise notice 'OJO: % filas actualizadas, se esperaba 1', n;
  else
    raise notice 'OK: unidad_venta del imán laminado -> plancha_a3';
  end if;
end $$;

commit;
