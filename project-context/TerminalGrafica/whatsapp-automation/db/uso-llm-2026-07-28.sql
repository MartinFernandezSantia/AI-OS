-- =====================================================================
-- TELEMETRÍA DE COSTO POR TURNO — columna bot.decisiones.uso_llm
--
-- El bot hace hasta 4 llamadas LLM por turno (respuesta, filtro, aclarador,
-- compositor), todas por OpenRouter. El dashboard de OpenRouter da el total
-- consumido pero NO permite atar una generación a una conversación: no se puede
-- responder "cuánto cuesta una consulta de precio" ni "qué conversación se fue
-- de rango".
--
-- Con `usage: {include: true}` en el body, OpenRouter devuelve tokens Y el costo
-- real en USD de cada generación — contemplando caching y descuentos del
-- provider, o sea más exacto que multiplicar por la tarifa de lista.
--
-- Forma del jsonb:
--   {"llamadas": 3, "tokens_in": 4210, "tokens_out": 180, "costo_usd": 0.00051,
--    "nodos": {"respuesta": {"in": 3800, "out": 90, "usd": 0.00042},
--              "filtro":    {"in": 260,  "out": 30, "usd": 0.00004},
--              "compositor":{"in": 150,  "out": 60, "usd": 0.00005}}}
--
-- `nodos` sólo trae los que corrieron ese turno (el aclarador casi nunca).
--
-- Contexto de escala, para leer los números con perspectiva: a las tarifas de
-- gemini-2.5-flash-lite el turno completo ronda fracciones de centavo, mientras
-- que el mensaje de WhatsApp cuesta ~USD 0,026 desde el 1-oct-2026. O sea el LLM
-- es ~50-100× más barato que el mensaje: lo que conviene optimizar es la CANTIDAD
-- DE TURNOS, no la cantidad de llamadas. Esta columna existe para verificar que
-- eso siga siendo cierto, no para exprimir el LLM.
-- =====================================================================

begin;

alter table bot.decisiones
  add column if not exists uso_llm jsonb;

comment on column bot.decisiones.uso_llm is
  'Tokens y costo USD de las llamadas LLM del turno (OpenRouter usage.include). '
  'Claves: llamadas, tokens_in, tokens_out, costo_usd, nodos{}. Ver db/uso-llm-2026-07-28.sql';

-- Índice parcial: las consultas de costo siempre filtran por fecha y sólo miran
-- las filas que tienen el dato (las anteriores a hoy son null).
create index if not exists decisiones_uso_llm_idx
  on bot.decisiones (created_at)
  where uso_llm is not null;

commit;

-- =====================================================================
-- CONSULTAS (read-only)
-- =====================================================================

-- 1. COSTO DE LA SEMANA, y cuánto pesa el LLM contra el mensaje de WhatsApp.
--    El 0.026 es la tarifa de service message de Meta desde el 1-oct-2026.
-- select
--   count(*) as turnos,
--   sum((uso_llm->>'tokens_in')::bigint)  as tokens_in,
--   sum((uso_llm->>'tokens_out')::bigint) as tokens_out,
--   round(sum((uso_llm->>'costo_usd')::numeric), 4) as llm_usd,
--   round(count(*) * 0.026, 2)                      as whatsapp_usd,
--   round(sum((uso_llm->>'costo_usd')::numeric) / nullif(count(*), 0), 6) as llm_usd_por_turno
-- from bot.decisiones
-- where created_at > now() - interval '7 days' and uso_llm is not null;

-- 2. QUÉ NODO SE COME EL PRESUPUESTO. El de respuesta manda el catálogo entero en
--    el prompt, así que se espera que domine; si otro lo pasa, algo cambió.
-- select clave as nodo,
--        count(*) as veces,
--        sum((v->>'in')::bigint)  as tokens_in,
--        sum((v->>'out')::bigint) as tokens_out,
--        round(sum((v->>'usd')::numeric), 4) as usd
-- from bot.decisiones d, lateral jsonb_each(d.uso_llm->'nodos') as e(clave, v)
-- where d.created_at > now() - interval '7 days'
-- group by clave order by usd desc nulls last;

-- 3. COSTO POR CONVERSACIÓN — las más caras primero. Una conversación cara suele
--    ser una que no resolvió: muchos turnos para llegar al mismo lugar.
-- select conversation_id,
--        count(*) as turnos,
--        round(sum((uso_llm->>'costo_usd')::numeric), 5) as llm_usd,
--        round(sum((uso_llm->>'costo_usd')::numeric) + count(*) * 0.026, 4) as total_usd
-- from bot.decisiones
-- where created_at > now() - interval '7 days' and uso_llm is not null
-- group by conversation_id order by total_usd desc limit 20;

-- 4. ¿EL COSTO SUBE CON EL TIPO DE CONSULTA? Compara por acción.
-- select accion,
--        count(*) as turnos,
--        round(avg((uso_llm->>'costo_usd')::numeric), 6) as usd_promedio,
--        round(avg((uso_llm->>'llamadas')::int), 2)      as llamadas_promedio
-- from bot.decisiones
-- where created_at > now() - interval '7 days' and uso_llm is not null
-- group by accion order by usd_promedio desc nulls last;

-- 5. ¿OPENROUTER MANDA EL COSTO? Si costo_usd sale 0 con tokens > 0, el provider
--    no devolvió `cost` y hay que calcularlo por tarifa. Esperado: 0 filas.
-- select count(*) as turnos_sin_costo
-- from bot.decisiones
-- where created_at > now() - interval '7 days'
--   and uso_llm is not null
--   and (uso_llm->>'costo_usd')::numeric = 0
--   and (uso_llm->>'tokens_in')::bigint > 0;
