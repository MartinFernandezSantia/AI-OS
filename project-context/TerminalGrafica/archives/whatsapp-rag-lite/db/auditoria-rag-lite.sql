-- =====================================================================
-- AUDITORÍA SEMANAL DEL BOT RAG LITE — set estandarizado de consultas
-- =====================================================================
-- El primer mes de producción es de testeo: la idea NO es leer registros a
-- mano, sino correr SIEMPRE las mismas queries para ver qué está fuera de la
-- media y abrir SOLO esas conversaciones.
--
-- Fuente ÚNICA (greenfield): bot.log — una fila por turno, funde el viejo
-- bot.decisiones (operativo) + bot.rag_decisiones (memoria del cerebro):
--   action           enum bot.accion (incl. firewall_* que auto-loguea fw_log)
--   resolution_level firewall | canned | llm | escalated
--   state            ok | corrected | regenerated | rejected
--   products/prices  qué recomendó / precios; verification = veredicto del Verificador
--   signals          {entregado, envioFallido, latencia_ms, …}   (latencia PLEGADA acá)
--   customer_message / bot_message = las dos puntas del turno
--
-- Todo READ-ONLY. Ventana por defecto: últimos 7 días.
-- =====================================================================


-- =====================================================================
-- A. SALUD OPERATIVA
-- =====================================================================

-- A1. PULSO DE LA SEMANA — volumen y mezcla de acciones. La foto de arranque.
-- select
--   action,
--   count(*)                                              as turnos,
--   round(100.0 * count(*) / sum(count(*)) over (), 1)    as pct
-- from bot.log
-- where created_at > now() - interval '7 days'
-- group by action
-- order by turnos desc;

-- A2. TASA DE ENTREGA — cuántos turnos NO llegaron al cliente. Objetivo: 0.
--     Un log que dice que entregó y no entregó es el peor bug (por eso Chequear
--     Envio valida el id de Chatwoot, no el status HTTP).
-- select
--   count(*)                                                              as turnos,
--   count(*) filter (where action = 'envio_fallido')                      as fallidos_enum,
--   count(*) filter (where (signals->>'envioFallido')::boolean is true)   as fallidos_senal,
--   round(100.0 * count(*) filter (where action = 'envio_fallido') / nullif(count(*),0), 2) as pct_fallido
-- from bot.log
-- where created_at > now() - interval '7 days';

-- A3. LOS ENVÍOS FALLIDOS, UNO POR UNO — para abrir la ejecución en n8n.
-- select created_at, session_id, signals, execution_id
-- from bot.log
-- where created_at > now() - interval '7 days' and action = 'envio_fallido'
-- order by created_at desc;

-- A4. FIREWALL — cuántas veces disparó (fw_log auto-loguea con action firewall_*).
-- select action, count(*) as veces
-- from bot.log
-- where created_at > now() - interval '7 days' and action::text like 'firewall%'
-- group by action order by veces desc;


-- =====================================================================
-- B. LATENCIA (signals->>'latencia_ms') — cerebro + entrega, sin el debounce
-- =====================================================================

-- B1. DISTRIBUCIÓN — promedio, mediana, p95 y máximo. Define qué es "normal".
-- with l as (
--   select (signals->>'latencia_ms')::numeric as ms
--   from bot.log
--   where created_at > now() - interval '7 days' and signals ? 'latencia_ms'
-- )
-- select
--   count(*)                                              as turnos,
--   round(avg(ms))                                        as ms_prom,
--   percentile_cont(0.50) within group (order by ms)::int as ms_p50,
--   percentile_cont(0.95) within group (order by ms)::int as ms_p95,
--   max(ms)                                               as ms_max
-- from l;

-- B2. OUTLIERS DE LATENCIA — turnos que tardaron > 3× la mediana. Se abren a mano
--     (suelen ser el Verificador trayendo catálogo + una corrección).
-- with l as (
--   select created_at, session_id, action, execution_id,
--          (signals->>'latencia_ms')::numeric as ms
--   from bot.log
--   where created_at > now() - interval '7 days' and signals ? 'latencia_ms'
-- ), base as (select percentile_cont(0.50) within group (order by ms) as p50 from l)
-- select l.created_at, l.session_id, l.action, l.ms, l.execution_id
-- from l, base
-- where l.ms > 3 * base.p50
-- order by l.ms desc limit 25;


-- =====================================================================
-- C. CALIDAD DEL CEREBRO (state, verification)
--    verification jsonb = {aprobado, accion, fallas:[{tipo,producto,detalle}], resumen}
-- =====================================================================

-- C1. TASA DE CORRECCIÓN — cuántas respuestas tocó el Verificador. Sube = el
--     Agente afirma cosas que no debe.
-- select
--   count(*)                                                          as turnos,
--   count(*) filter (where state is distinct from 'ok')               as corregidos,
--   round(100.0 * count(*) filter (where state is distinct from 'ok') / nullif(count(*),0), 1) as pct_corregido
-- from bot.log
-- where created_at > now() - interval '7 days' and resolution_level = 'llm';

-- C2. FALLAS POR TIPO — qué cazó el Verificador.
-- select
--   f->>'tipo'  as tipo_falla,
--   count(*)    as veces
-- from bot.log d,
--      lateral jsonb_array_elements(coalesce(d.verification->'fallas','[]'::jsonb)) as f
-- where d.created_at > now() - interval '7 days'
-- group by tipo_falla order by veces desc;

-- C3. LAS RESPUESTAS CORREGIDAS, CON EL PORQUÉ — el resumen del Verificador.
-- select created_at, session_id,
--        verification->>'resumen' as por_que,
--        left(bot_message, 160)   as mensaje_final
-- from bot.log
-- where created_at > now() - interval '7 days' and state is distinct from 'ok'
-- order by created_at desc limit 30;

-- C4. DEMANDA NO SERVIDA — qué pidieron los clientes que el bot NO pudo ofrecer (señal de curación).
--     motivo: sin_match (no había nada en catálogo → derivó a mail) | no_trabajado (lista negra, ej.
--     fotocopias; origen 'verificador' = lo cazó el guardrail, no el agente). Un pedido que aparece hoy
--     y se resuelve mañana igual cuenta: es curación de sinónimos, no ruido.
-- select d->>'motivo'            as motivo,
--        lower(d->>'pedido')     as pedido,
--        count(*)                as veces,
--        count(distinct session_id) as clientes,
--        max(created_at)         as ultima_vez
-- from bot.log, jsonb_array_elements(denied_products) d
-- where created_at > now() - interval '7 days'
-- group by motivo, lower(d->>'pedido')
-- order by veces desc, ultima_vez desc;

-- C5. CONTROL DE SUB-REPORTE de C4 — turnos que HUELEN a derivación a mail (nada ofrecido + "mail" en la
--     respuesta) pero con denied_products vacío. Si esto es alto, el campo del LLM sub-reporta → revisar
--     el prompt (pedidos_no_resueltos). Casi toda la señal cruda ya está en columnas existentes.
-- select count(*) as sospechosos
-- from bot.log
-- where created_at > now() - interval '7 days' and resolution_level = 'llm'
--   and products = '[]'::jsonb and denied_products = '[]'::jsonb and bot_message ilike '%mail%';


-- =====================================================================
-- D. CONVERSACIONES FUERA DE RANGO (candidatas a revisión manual)
-- =====================================================================

-- D1. CONVERSACIONES LARGAS — muchos turnos = casi siempre una que NO resolvió.
-- select session_id,
--        count(*)                                         as turnos,
--        count(*) filter (where action = 'envio_fallido') as fallidos,
--        min(created_at)                                  as inicio,
--        max(created_at)                                  as ultimo
-- from bot.log
-- where created_at > now() - interval '7 days'
-- group by session_id
-- having count(*) >= 6
-- order by turnos desc limit 20;

-- D2. RECONSTRUIR UNA CONVERSACIÓN — el hilo completo (poné el session_id).
-- select created_at, action, state,
--        (signals->>'latencia_ms')  as latencia_ms,
--        left(customer_message, 80) as cliente,
--        left(bot_message, 160)     as bot,
--        jsonb_array_length(products) as n_productos,
--        verification->>'resumen'   as veredicto
-- from bot.log
-- where session_id = :sess_id       -- reemplazá por el id
-- order by created_at;
