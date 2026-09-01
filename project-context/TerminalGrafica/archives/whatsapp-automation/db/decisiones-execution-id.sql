-- =============================================================================
-- Observabilidad — execution_id de n8n en bot.decisiones (pedido de Martin,
-- ronda suite-3 2026-07-21): cada log del bot referencia la ejecución que lo
-- generó, para poder abrir el flujo fallido/exitoso en n8n al debuggear.
-- =============================================================================
-- Preparada por Claude, APLICA MARTIN (regla: yo preparo, vos aplicás).
-- Aditiva e idempotente: se puede correr en el SQL editor sobre cualquier estado.
-- Sin re-grant: los grants existentes son a nivel tabla.
--
-- ORDEN IMPORTANTE: aplicar esto ANTES de re-importar el workflow, y después
-- ABRIR Y GUARDAR cada nodo Log (Log Respuesta / Log Escalación / Log Precio)
-- una vez en n8n: el nodo Postgres cachea el schema de la tabla y necesita
-- refrescarlo para aceptar la columna nueva.
-- =============================================================================

alter table bot.decisiones add column if not exists execution_id text;

-- Sanity (tras aplicar + re-importar + mandar un mensaje al bot):
--   select created_at, accion, execution_id from bot.decisiones
--   order by created_at desc limit 3;   -- execution_id con valor
