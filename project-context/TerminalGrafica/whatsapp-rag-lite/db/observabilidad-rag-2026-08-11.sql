-- =====================================================================
-- OBSERVABILIDAD DEL BOT RAG LITE — columnas de telemetría en bot.decisiones
-- (pedido de Martin, 2026-08-11: "primer mes = testeo, recolectar la mejor
--  data posible para auditar semana a semana sin mirar registros a mano").
--
-- El RAG lite loguea el turno LLM en bot.decisiones (nodo Log Turno). Este
-- script agrega dos señales para poder detectar turnos FUERA DE LA MEDIA:
--   · latencia_ms — cuánto tardó el procesamiento (cerebro + entrega), SIN el
--     debounce fijo de 3s. Lo estampa el adaptador ("Cuando llega un mensaje",
--     campo _t0) y lo cierra Log Turno con Date.now() - _t0.
--   · uso_llm    — tokens del turno (jsonb {llamadas, tokens_in, tokens_out,
--     nodos{}}). Log Turno suma el `tokenUsage` de cada nodo de modelo que corrió
--     (Agente='Modelo', Verificador, Corrector, Guardrails). SIN costo USD: los
--     nodos langchain sólo dan conteo de tokens; el costo se estima por tarifa en
--     db/auditoria-rag-lite.sql (sección D). CAVEAT: si un modelo corrió varias
--     veces en el turno (el Agente hace ≥2 por el tool-call), .all() puede traer
--     sólo la última → posible subconteo del Agente. Verificar contra 1 ejecución.
--
-- Preparada por Claude, APLICA MARTIN (regla: yo preparo, vos aplicás).
-- Aditiva e idempotente: corre en el SQL editor sobre cualquier estado.
--
-- ORDEN: aplicar ANTES de re-importar el workflow, y después ABRIR Y GUARDAR el
-- nodo "Log Turno" una vez en n8n (el nodo Postgres cachea el schema de la tabla
-- y necesita refrescarlo para aceptar la columna nueva; mismo caveat que
-- decisiones-execution-id.sql).
-- =====================================================================

begin;

alter table bot.decisiones add column if not exists latencia_ms integer;
alter table bot.decisiones add column if not exists uso_llm jsonb;

comment on column bot.decisiones.latencia_ms is
  'Latencia del turno en ms (cerebro + entrega, sin el debounce de 3s). '
  'La estampa el adaptador (_t0) y la cierra Log Turno. Ver db/observabilidad-rag-2026-08-11.sql';

comment on column bot.decisiones.uso_llm is
  'Tokens y costo USD de las llamadas LLM del turno (OpenRouter usage.include). '
  'Claves: llamadas, tokens_in, tokens_out, costo_usd, nodos{}. Ver db/uso-llm-2026-07-28.sql';

-- Índices parciales: las auditorías filtran por fecha y sólo miran filas con dato.
create index if not exists decisiones_latencia_idx
  on bot.decisiones (created_at)
  where latencia_ms is not null;

create index if not exists decisiones_uso_llm_rag_idx
  on bot.decisiones (created_at)
  where uso_llm is not null;

commit;

-- Sanity (tras aplicar + re-importar + abrir/guardar Log Turno + un mensaje real):
--   select created_at, accion, latencia_ms, uso_llm
--   from bot.decisiones order by created_at desc limit 3;   -- latencia_ms con valor
