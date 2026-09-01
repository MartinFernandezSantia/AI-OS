-- =====================================================================
-- AUDITORÍA SEMANAL DEL COMPOSITOR (read-only)
--
-- Desde v8.3b (2026-07-28) el gate del compositor NO bloquea: las reglas de
-- conservación corren igual pero sólo registran, con el prefijo `habria_` en
-- `notas`. Estas consultas son la contracara de esa decisión — sin mirarlas, el
-- cambio es "sacamos las defensas y no volvimos a chequear".
--
-- Correr una vez por semana. Lo que se busca NO es el volumen (que sea alto es lo
-- esperado: las reglas rechazaban ~31% de las frases naturales) sino los casos
-- donde la observación señala un problema REAL de plata.
--
-- Único rechazo que queda: `token_residual` (un [[P1]] sin estampar saldría literal
-- al cliente). Si aparece, es un bug del estampado, no una decisión de política.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. RESUMEN: cuánto se observa y de qué tipo, últimos 7 días.
--    Sirve para ver la tendencia. Un salto en una categoría = algo cambió.
-- ---------------------------------------------------------------------
select
  regexp_replace(m[1], ':.*$', '') as observacion,
  count(*) as veces,
  round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1) as pct
from bot.decisiones d,
     lateral regexp_matches(d.notas, '(habria_[a-z_]+(?::[^,\)]*)?)', 'g') as m
where d.created_at > now() - interval '7 days'
group by 1
order by veces desc;

-- ---------------------------------------------------------------------
-- 2. LOS QUE IMPORTAN: observaciones de PLATA.
--
--    `digitos:inventado` y `tokens` son las dos únicas que pueden producir un
--    número equivocado en el mensaje. El resto (largo, lexico, hedge, unidad) son
--    de tono o de resguardo: molestan, no mienten.
--
--    Se muestran borrador y final juntos para poder comparar de un vistazo.
-- ---------------------------------------------------------------------
select d.created_at, d.conversation_id, d.mensaje_cliente,
       substring(d.notas from 'habria_[a-z_]+(?::[^,\)]*)?') as observacion,
       d.borrador,
       d.final
from bot.decisiones d
where d.created_at > now() - interval '7 days'
  and (d.notas like '%habria_digitos:inventado%' or d.notas like '%habria_tokens%')
order by d.created_at desc
limit 50;

-- ---------------------------------------------------------------------
-- 3. EL BUG, NO LA POLÍTICA: tokens sin estampar.
--    Esperado: 0 filas. Si hay alguna, el cliente recibió el borrador porque el
--    estampado falló — hay que mirar el mapa de `Armar Prompt Compositor`.
-- ---------------------------------------------------------------------
select d.created_at, d.conversation_id, d.mensaje_cliente, d.borrador
from bot.decisiones d
where d.created_at > now() - interval '7 days'
  and d.notas like '%compositor:token_residual%'
order by d.created_at desc;

-- ---------------------------------------------------------------------
-- 4. ¿EL COMPOSITOR ESTÁ SIRVIENDO?
--    Cuántos turnos salieron reescritos contra cuántos salieron con el borrador.
--    Era la métrica que no se podía ver mientras el gate bloqueaba: el rechazo y
--    el "no había nada que componer" se mezclaban en el mismo resultado.
-- ---------------------------------------------------------------------
select
  case
    when d.notas like '%compositor:ok%'             then 'reescrito por el compositor'
    when d.notas like '%compositor:off%'            then 'compositor apagado / nada que componer'
    when d.notas like '%compositor:ilegible%'       then 'el LLM no devolvió JSON'
    when d.notas like '%compositor:token_residual%' then 'BUG de estampado'
    else 'sin marca de compositor'
  end as resultado,
  count(*) as turnos,
  count(*) filter (where d.notas like '%habria_%') as con_observacion
from bot.decisiones d
where d.created_at > now() - interval '7 days'
group by 1
order by turnos desc;

-- ---------------------------------------------------------------------
-- 5. CUÁNDO VOLVER A BLOQUEAR
--    Si la consulta 2 muestra un caso donde el número del `final` difiere del que
--    correspondía, esa regla vuelve a bloquear con una línea: en `Aplicar
--    Compositor`, cambiar `obs.push('habria_X')` por `return salir(borrador, 'X')`.
--    El dato para decidirlo ya va a estar, que es el punto de observar en vez de
--    apagar.
-- ---------------------------------------------------------------------
