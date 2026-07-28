-- ═══════════════════════════════════════════════════════════════════════════
-- ENUMS DE bot.decisiones — los valores que el código escribe y la base rechaza
--
-- QUÉ RESUELVE. `bot.decisiones.accion` es un enum de 5 valores y el código venía
-- escribiendo otros. El INSERT rebota entero con "invalid input value for enum
-- bot.accion" — y como el nodo n8n tiene onError:continueRegularOutput y el
-- firewall envuelve su insert en `exception when others then null`, el fallo es
-- MUDO por partida doble. Sin fila no hay memoria entre turnos, ni telemetría.
--
-- No es nuevo: viene de v7. Estaba TAPADO por el bug de la columna nula (commit
-- 1dd3040, 2026-07-28): el INSERT fallaba antes de llegar al enum, así que el enum
-- nunca se ejercitaba. Arreglar aquél destapó éste.
--
-- CÓMO SE REPARTE EL TRABAJO. Martin decidió (2026-07-28) normalizar el CÓDIGO en
-- vez de ensanchar el enum, para no tener dos etiquetas con el mismo significado:
--
--   pregunto_opciones  -> `repregunto`         ← lo hace el código (bloque 13a/b)
--   cotizador_answer   -> `informo_capacidad`  ← lo hace el código (bloque 13b)
--   noop               -> AL ENUM              ← este archivo
--   firewall_*         -> AL ENUM              ← este archivo
--
-- POR QUÉ `noop` NO SE MAPEA. Callarse no es informar, ni preguntar, ni escalar.
-- El candidato más cercano, `fallback_error`, sería activamente falso: `noop` es
-- una decisión exitosa (el LLM eligió no contestar, o el verificador confirmó el
-- silencio), y meterlo ahí ensuciaría el índice
--   create index on bot.decisiones (accion) where veredicto_humano is null
-- que alimenta el digest de revisión humana — llenaría la cola de falsos errores.
-- Además `Armar Mensajes LLM` filtra por el string 'noop' para saltear el ruido
-- del debounce: traducirlo rompería la ruta del cotizador.
--
-- POR QUÉ LOS `firewall_*` TAMPOCO. Son categorías reales de bloqueo (blocklist,
-- rate limit, silenciado, refusal, strike). Colapsarlas perdería la información
-- que hace útil al log de seguridad. Hoy NINGUNA entra: el firewall no viene
-- registrando nada, y por el `exception when others then null` nadie lo notó.
--
-- `nivel_resolucion` tiene el mismo problema con 'firewall' — va acá también.
--
-- IDEMPOTENTE. `add value if not exists`. Se puede correr dos veces.
--
-- OJO — NO SE PUEDE CORRER DENTRO DE UNA TRANSACCIÓN. Postgres exige que
-- `ALTER TYPE ... ADD VALUE` vaya en autocommit. En el SQL Editor de Supabase
-- pegalo tal cual (ya corre en autocommit). Si lo corrés por psql, NO lo envuelvas
-- en begin/commit.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Antes de tocar nada: qué acepta HOY ────────────────────────────────
-- Correr esto PRIMERO y guardar la salida. Si el enum real ya trae valores que
-- este archivo agrega, es que la base y las migraciones versionadas están
-- desincronizadas — no rompe (el `if not exists` lo cubre) pero conviene saberlo.
select 'accion' as enum, unnest(enum_range(null::bot.accion))::text as valor
union all
select 'nivel_resolucion', unnest(enum_range(null::bot.nivel_resolucion))::text
order by 1, 2;

-- ── 2. El silencio deliberado ─────────────────────────────────────────────
alter type bot.accion add value if not exists 'noop';

-- ── 3. El firewall (Tier-1) ───────────────────────────────────────────────
-- Los escribe bot.fw_log() desde db/firewall-tier1.sql:86.
alter type bot.accion add value if not exists 'firewall_drop_blocklist';
alter type bot.accion add value if not exists 'firewall_drop_silenciado';
alter type bot.accion add value if not exists 'firewall_drop_rate';
alter type bot.accion add value if not exists 'firewall_silence_rate';
alter type bot.accion add value if not exists 'firewall_refusal';
alter type bot.accion add value if not exists 'firewall_strike_max';

-- ── 4. El firewall (Tier-2) ───────────────────────────────────────────────
-- db/firewall-tier2-strike.sql:68 escribe el literal; :75 escribe
-- 'firewall_tier2_' || p_reason, o sea CARDINALIDAD ABIERTA: cualquier razón
-- nueva que se agregue del lado del código va a rebotar acá otra vez.
-- Se cubren las razones que hoy existen; si aparece una nueva, se agrega igual.
-- (Un enum es la estructura equivocada para un campo de cardinalidad abierta —
-- queda anotado como deuda, no se resuelve hoy.)
alter type bot.accion add value if not exists 'firewall_tier2_strike_max';
alter type bot.accion add value if not exists 'firewall_tier2_jailbreak';
alter type bot.accion add value if not exists 'firewall_tier2_offtopic';
alter type bot.accion add value if not exists 'firewall_tier2_abuso';

-- ── 5. El nivel de resolución del firewall ────────────────────────────────
-- db/firewall-tier1.sql:87 escribe 'firewall', que tampoco existe.
alter type bot.nivel_resolucion add value if not exists 'firewall';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (read-only). Correr DESPUÉS.
--
-- Lo que hay que ver:
--   · `accion` tiene los 5 originales + noop + los firewall_*
--   · `nivel_resolucion` tiene n1_sql, n2_llm, ninguno, firewall
--   · NO aparecen `pregunto_opciones` ni `cotizador_answer` — esos los normalizó
--     el código; si aparecen, alguien ensanchó el enum por otro lado y quedaron
--     dos etiquetas para lo mismo.
-- ═══════════════════════════════════════════════════════════════════════════
select 'accion' as enum, unnest(enum_range(null::bot.accion))::text as valor
union all
select 'nivel_resolucion', unnest(enum_range(null::bot.nivel_resolucion))::text
order by 1, 2;

-- Y que las filas empiecen a entrar. Después de una ronda real, esto tiene que
-- devolver algo — hasta hoy la rama normal escribía CERO filas.
--   select accion, count(*) from bot.decisiones
--    where created_at > now() - interval '1 hour' group by 1 order by 2 desc;
