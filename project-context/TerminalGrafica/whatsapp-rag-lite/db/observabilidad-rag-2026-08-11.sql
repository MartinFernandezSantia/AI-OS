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
--   · uso_llm    — tokens + costo USD del turno (jsonb {llamadas, tokens_in,
--     tokens_out, costo_usd, modelo, nodos{}, parcial, fuente}). Se llena en DOS
--     FASES (lección del 2026-08-10: el hot-path solo dio ceros en turnos
--     "repregunto" porque intermediateSteps trae ÚNICAMENTE rondas con tool-call
--     — nunca la generación final — y n8n no expone el usage de los sub-nodos
--     ai_languageModel al flujo main):
--       FASE 1 (hot-path, PISO): Preparar Envío suma intermediateSteps del Agente
--       (returnIntermediateSteps) → fuente='intermediateSteps', parcial=true.
--       En turnos sin tool-call es todo 0 y ES ESPERADO.
--       FASE 2 (backfill, TOTAL): el workflow faq-bot-rag-lite-uso-llm (agendado
--       cada 5 min) relee la fila por execution_id vía la API pública de
--       ejecuciones (?includeData=true → runData de los 4 sub-nodos de modelo:
--       Modelo, · Verificador, · Corrector, · Guardrails) y PISA uso_llm →
--       fuente='runData', parcial=false. Si la ejecución no está tras 48h →
--       fuente='no_disponible' (conserva el piso). Fila que quede en
--       'intermediateSteps' = backfill pendiente o caído.
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
  'Tokens y costo USD de las llamadas LLM del turno, en dos fases: hot-path escribe el piso '
  '(fuente=intermediateSteps, 0 en turnos sin tool-call) y el workflow faq-bot-rag-lite-uso-llm '
  'lo pisa con el total real via API de ejecuciones (fuente=runData; no_disponible si se perdio). '
  'Claves: llamadas, tokens_in, tokens_out, costo_usd, costo_estimado, modelo, nodos{}, parcial, fuente.';

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
