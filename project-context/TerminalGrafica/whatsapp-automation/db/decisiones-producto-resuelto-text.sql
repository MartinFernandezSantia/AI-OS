-- =============================================================================
-- FIX de logging — bot.decisiones.producto_resuelto: uuid -> text
-- (bug vivo detectado por Martin 2026-08-05, ejecución conv 403 "Plotter en papel?")
-- =============================================================================
-- Preparada por Claude, APLICA MARTIN (regla: yo preparo, vos aplicás).
--
-- SÍNTOMA: Log Turno rebota con
--   invalid input syntax for type uuid: "Impresiones láser color ... | ..."
-- y, como el nodo tiene onError:continueRegularOutput, FALLA EN SILENCIO.
--
-- CAUSA: la columna quedó tipada `uuid` (diseño viejo: referencia a UN producto).
-- Pero v10 escribe ahí los NOMBRES canónicos de TODOS los productos resueltos,
-- unidos por ' | ' (Leer Verificador: (hechos||[]).map(h=>h.producto).join(' | ')).
-- Un string con pipes nunca es un uuid → el INSERT rebota.
--
-- IMPACTO: rebota SOLO cuando producto_resuelto trae un nombre, o sea en TODO
-- turno donde el bot resolvió un producto y cotizó. Los turnos sin producto
-- (null es válido para uuid) y las escalaciones (Log Escalación no mapea esta
-- columna) sí logueaban. Neto: las COTIZACIONES EXITOSAS — las que más importa
-- auditar — son exactamente las que faltan en bot.decisiones. Mismo patrón que
-- el tapón del 2026-07-28 (Log Turno escribía null en `accion`).
--
-- FIX: la columna tiene que ser text. v10 guarda nombres legibles y varios a la
-- vez; un uuid único no modela eso. Se corrige el tipo, no el código.
-- =============================================================================

-- 0) CONFIRMAR ANTES DE APLICAR: ver el tipo actual (y si hay OTRA columna uuid
--    que también reciba texto).
--   select column_name, data_type
--   from information_schema.columns
--   where table_schema = 'bot' and table_name = 'decisiones'
--   order by ordinal_position;

-- 1) EL FIX (necesita rol owner en Supabase; el rol readonly del bot no alcanza).
--    Idempotente: si ya es text, el ALTER es un no-op inofensivo.
alter table bot.decisiones
  alter column producto_resuelto type text using producto_resuelto::text;

-- 2) DESPUÉS DE APLICAR: abrir y GUARDAR el nodo Log Turno en n8n una vez.
--    El nodo Postgres cachea el schema de la tabla; si no se refresca puede
--    seguir tratando la columna como uuid. (Mismo cuidado que en
--    decisiones-execution-id.sql.)

-- 3) SANITY (tras aplicar + refrescar el nodo + mandar un mensaje de producto):
--   select created_at, accion, producto_resuelto from bot.decisiones
--   where producto_resuelto is not null
--   order by created_at desc limit 3;   -- ahora debería aparecer la cotización
