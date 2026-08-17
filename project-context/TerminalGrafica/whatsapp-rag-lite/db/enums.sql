-- =============================================================================
-- BOT — ENUMS EXTERNOS (prerequisito de schema-bot.sql)
-- =============================================================================
-- Preparada por Claude, APLICA MARTIN (regla: yo preparo, vos aplicás).
--
-- schema-bot.sql (greenfield) ASUME que el enum `bot.accion` ya existe: es el tipo
-- de la columna bot.log.action y lo que castea bot.fw_log(). En dev venía del
-- proyecto whatsapp-automation (enum-accion-*.sql, construido por migraciones
-- incrementales). Para una base greenfield desde CERO se crea acá de una sola vez,
-- con el set FINAL de 17 valores (no la cadena de ALTER ... ADD VALUE).
--
-- ORDEN DE APLICACIÓN EN PROD (greenfield):
--   1. db/enums.sql        ← este archivo
--   2. db/schema-bot.sql
--   3. db/firewall.sql
--   4. passwords de bot_runtime + bot_curator
--
-- Los otros enums del bot (bot.sale_unit, bot.resolution_level) los define
-- schema-bot.sql, NO acá. `bot.nivel_resolucion` (modelo viejo) se OMITE a
-- propósito: el firewall greenfield no lo usa (escribe resolution_level='firewall'
-- del enum bot.resolution_level). Ver auditoría en db/PROD-APPLY / plan.
--
-- Idempotente: si el tipo ya existe (p. ej. base de dev), NO lo toca. Para hacer
-- top-up de valores sobre un enum viejo usá las migraciones de whatsapp-automation.
-- =============================================================================

create schema if not exists bot;

-- bot.accion — las acciones que el firewall/router escriben en bot.log.action.
-- Set final (17 valores), confirmado en base 2026-08-05 (enum-envio-fallido-*.sql).
do $$ begin
  if not exists (select 1 from pg_type t
                   join pg_namespace n on n.oid = t.typnamespace
                  where t.typname = 'accion' and n.nspname = 'bot') then
    create type bot.accion as enum (
      'fallback_error',
      'firewall_drop_blocklist',
      'firewall_drop_rate',
      'firewall_drop_silenciado',
      'firewall_refusal',
      'firewall_silence_rate',
      'firewall_strike_max',
      'firewall_tier2_abuso',
      'firewall_tier2_jailbreak',
      'firewall_tier2_offtopic',
      'firewall_tier2_strike_max',
      'handoff',
      'informo_capacidad',
      'informo_precio',
      'noop',
      'repregunto',
      'envio_fallido'
    );
    raise notice 'Tipo bot.accion creado (17 valores).';
  else
    raise notice 'Tipo bot.accion ya existe: sin cambios.';
  end if;
end $$;

-- =============================================================================
-- Verificación (correr en una ejecución APARTE, no en la misma que el create):
--   select unnest(enum_range(null::bot.accion))::text as valor order by 1;
--   -- deben aparecer los 17 valores.
-- =============================================================================
