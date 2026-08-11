-- =====================================================================
-- AUDITORÍA SEMANAL DEL BOT RAG LITE — set estandarizado de consultas
-- (pedido de Martin, 2026-08-11). El primer mes de producción es de testeo:
-- la idea NO es leer registros a mano, sino correr SIEMPRE las mismas queries
-- para ver qué está fuera de la media y abrir SOLO esas conversaciones.
--
-- Todo es READ-ONLY. Copiá/descomentá la que necesites en el SQL editor.
-- Dos fuentes:
--   · bot.decisiones      — LOG OPERATIVO del turno (accion, entrega, latencia,
--                           uso_llm, execution_id). Un turno LLM = una fila.
--                           El firewall Tier-1 también se auto-loguea acá.
--   · bot.rag_decisiones  — MEMORIA DEL CEREBRO (qué recomendó, veredicto del
--                           Verificador). Sirve para auditar CALIDAD.
-- Se cruzan por conversación: bot.decisiones.conversation_id = bot.rag_decisiones.session_id.
--
-- Nota de cobertura: los caminos ENLATADOS (no-texto, cap, saludo, injection)
-- NO pasan por Log Turno, así que no aparecen en bot.decisiones (salvo el
-- firewall, que se auto-loguea en SQL). Para month-1 alcanza; si hace falta
-- medir esos, hay que sumarles un log (pendiente).
--
-- Ventana por defecto: últimos 7 días. Cambiá el interval donde haga falta.
-- =====================================================================


-- =====================================================================
-- A. SALUD OPERATIVA (bot.decisiones)
-- =====================================================================

-- A1. PULSO DE LA SEMANA — volumen y mezcla de acciones. La foto de arranque.
--     'envio_fallido' > 0 es lo primero a mirar: un log que dice que entregó y no
--     entregó es el peor bug (por eso Chequear Envio valida el id, no el HTTP).
-- select
--   accion,
--   count(*)                                              as turnos,
--   round(100.0 * count(*) / sum(count(*)) over (), 1)    as pct
-- from bot.decisiones
-- where created_at > now() - interval '7 days'
-- group by accion
-- order by turnos desc;

-- A2. TASA DE ENTREGA — cuántos turnos NO llegaron al cliente. Objetivo: 0.
--     Cruza el enum (accion='envio_fallido') con la señal cruda (senales.envioFallido).
-- select
--   count(*)                                                            as turnos,
--   count(*) filter (where accion = 'envio_fallido')                    as fallidos_enum,
--   count(*) filter (where (senales->>'envioFallido')::boolean is true) as fallidos_senal,
--   round(100.0 * count(*) filter (where accion = 'envio_fallido') / nullif(count(*),0), 2) as pct_fallido
-- from bot.decisiones
-- where created_at > now() - interval '7 days';

-- A3. LOS ENVÍOS FALLIDOS, UNO POR UNO — para abrir la ejecución en n8n y ver por qué.
-- select created_at, conversation_id, notas, execution_id
-- from bot.decisiones
-- where created_at > now() - interval '7 days' and accion = 'envio_fallido'
-- order by created_at desc;

-- A4. FIREWALL — cuántas veces disparó (el Tier-1 se auto-loguea con accion firewall_*).
-- select accion, count(*) as veces
-- from bot.decisiones
-- where created_at > now() - interval '7 days' and accion like 'firewall%'
-- group by accion order by veces desc;


-- =====================================================================
-- B. LATENCIA (bot.decisiones.latencia_ms) — requiere observabilidad-rag-*.sql
-- =====================================================================

-- B1. DISTRIBUCIÓN — promedio, mediana, p95 y máximo. Define qué es "normal".
-- select
--   count(*)                                                        as turnos,
--   round(avg(latencia_ms))                                         as ms_prom,
--   percentile_cont(0.50) within group (order by latencia_ms)::int  as ms_p50,
--   percentile_cont(0.95) within group (order by latencia_ms)::int  as ms_p95,
--   max(latencia_ms)                                                as ms_max
-- from bot.decisiones
-- where created_at > now() - interval '7 days' and latencia_ms is not null;

-- B2. OUTLIERS DE LATENCIA — turnos que tardaron > 3× la mediana. Estos se abren
--     a mano: suelen ser el Verificador trayendo catálogo + una corrección.
-- with base as (
--   select percentile_cont(0.50) within group (order by latencia_ms) as p50
--   from bot.decisiones
--   where created_at > now() - interval '7 days' and latencia_ms is not null
-- )
-- select d.created_at, d.conversation_id, d.accion, d.latencia_ms, d.execution_id
-- from bot.decisiones d, base
-- where d.created_at > now() - interval '7 days'
--   and d.latencia_ms is not null
--   and d.latencia_ms > 3 * base.p50
-- order by d.latencia_ms desc
-- limit 25;

-- B3. ¿LA LATENCIA DEPENDE DE LA ACCIÓN? Para saber qué camino es el caro.
-- select accion, count(*) as turnos, round(avg(latencia_ms)) as ms_prom,
--        percentile_cont(0.95) within group (order by latencia_ms)::int as ms_p95
-- from bot.decisiones
-- where created_at > now() - interval '7 days' and latencia_ms is not null
-- group by accion order by ms_prom desc nulls last;


-- =====================================================================
-- C. CALIDAD DEL CEREBRO (bot.rag_decisiones)
--    verificacion jsonb = {aprobado, accion, fallas:[{tipo,producto,detalle}], resumen}
-- =====================================================================

-- C1. TASA DE CORRECCIÓN — cuántas respuestas tocó el Verificador. Sube = el
--     Agente afirma cosas que no debe; bajá revisando C2 para ver de qué se trata.
-- select
--   count(*)                                                          as turnos,
--   count(*) filter (where estado <> 'ok')                            as corregidos,
--   round(100.0 * count(*) filter (where estado <> 'ok') / nullif(count(*),0), 1) as pct_corregido
-- from bot.rag_decisiones
-- where created_at > now() - interval '7 days';

-- C2. FALLAS POR TIPO — qué cazó el Verificador. producto_inventado / fusion_variantes
--     apuntan al catálogo o al prompt; info_no_permitida / fuera_de_rol, a la política.
-- select
--   f->>'tipo'  as tipo_falla,
--   count(*)    as veces
-- from bot.rag_decisiones d,
--      lateral jsonb_array_elements(coalesce(d.verificacion->'fallas','[]'::jsonb)) as f
-- where d.created_at > now() - interval '7 days'
-- group by tipo_falla order by veces desc;

-- C3. LAS RESPUESTAS CORREGIDAS, CON EL PORQUÉ — para leer el resumen del Verificador.
-- select created_at, session_id,
--        verificacion->>'resumen' as por_que,
--        left(mensaje, 160)        as mensaje_final
-- from bot.rag_decisiones
-- where created_at > now() - interval '7 days' and estado <> 'ok'
-- order by created_at desc limit 30;


-- =====================================================================
-- D. TOKENS + COSTO (bot.decisiones.uso_llm) — forma: {llamadas, tokens_in,
--    tokens_out, costo_usd, modelo, nodos:{agente:{in,out,usd}}, parcial}.
--    Se llena en el turno desde intermediateSteps del Agente (returnIntermediateSteps),
--    con el costo USD REAL de OpenRouter. OJO parcial=true: es un PISO — cubre la ronda
--    tool-call del Agente (prompt+catálogo, lo caro) pero NO la generación final ni
--    Verificador/Corrector/Guardrails (esos son sub-nodos, no legibles desde el main).
-- =====================================================================

-- D0. ¿SE ESTÁ POBLANDO? Debe dar ~igual al total de turnos LLM.
-- select count(*) as turnos_con_uso_llm
-- from bot.decisiones
-- where created_at > now() - interval '7 days' and uso_llm is not null;

-- D1. COSTO DE LA SEMANA (real de OpenRouter, PISO) vs. el mensaje de WhatsApp (~0.026 c/u
--     desde 1-oct-2026). Confirma la tesis del v10: el LLM es marginal, lo caro es el mensaje.
-- select
--   count(*)                                          as turnos,
--   sum((uso_llm->>'tokens_in')::bigint)              as tokens_in,
--   sum((uso_llm->>'tokens_out')::bigint)             as tokens_out,
--   round(sum((uso_llm->>'costo_usd')::numeric), 4)   as llm_usd_piso,
--   round(count(*) * 0.026, 2)                         as whatsapp_usd
-- from bot.decisiones
-- where created_at > now() - interval '7 days' and uso_llm is not null;

-- D2. QUÉ NODO SE COME LOS TOKENS. El 'agente' manda el catálogo topK en el prompt →
--     se espera que domine; si el 'verificador' lo pasa, algo se descontroló.
-- select clave as nodo, count(*) as veces,
--        sum((v->>'in')::bigint)  as tokens_in,
--        sum((v->>'out')::bigint) as tokens_out
-- from bot.decisiones d, lateral jsonb_each(d.uso_llm->'nodos') as e(clave, v)
-- where d.created_at > now() - interval '7 days'
-- group by clave order by tokens_in desc nulls last;

-- D3. TOKENS POR ACCIÓN — para ver qué tipo de consulta es la cara en tokens.
-- select accion, count(*) as turnos,
--        round(avg(((uso_llm->>'tokens_in')::numeric) + ((uso_llm->>'tokens_out')::numeric))) as tok_prom,
--        round(avg((uso_llm->>'tokens_in')::numeric))   as in_prom,
--        round(avg((uso_llm->>'tokens_out')::numeric))  as out_prom
-- from bot.decisiones
-- where created_at > now() - interval '7 days' and uso_llm is not null
-- group by accion order by in_prom desc nulls last;


-- =====================================================================
-- E. CONVERSACIONES FUERA DE RANGO (candidatas a revisión manual)
-- =====================================================================

-- E1. CONVERSACIONES LARGAS — muchos turnos = casi siempre una que NO resolvió
--     (el cliente vuelve a preguntar lo mismo). Las de arriba se leen enteras.
-- select conversation_id,
--        count(*)                                        as turnos,
--        count(*) filter (where accion = 'envio_fallido') as fallidos,
--        min(created_at)                                 as inicio,
--        max(created_at)                                 as ultimo
-- from bot.decisiones
-- where created_at > now() - interval '7 days'
-- group by conversation_id
-- having count(*) >= 6
-- order by turnos desc limit 20;

-- E2. RECONSTRUIR UNA CONVERSACIÓN — el hilo completo de una (poné el id).
-- select d.created_at, d.accion, d.latencia_ms,
--        left(d.mensaje_cliente, 80) as cliente,
--        left(d.final, 160)          as bot
-- from bot.decisiones d
-- where d.conversation_id = :conv_id     -- reemplazá por el id
-- order by d.created_at;

-- E3. CRUCE operativo ↔ cerebro para una conversación: qué recomendó y si se corrigió.
-- select r.created_at, r.estado,
--        jsonb_array_length(r.productos) as n_productos,
--        r.verificacion->>'resumen'      as veredicto
-- from bot.rag_decisiones r
-- where r.session_id = :conv_id          -- mismo id que conversation_id
-- order by r.created_at;
