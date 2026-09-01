-- ═══════════════════════════════════════════════════════════════════════════
-- DE-A2 — word-boundary en los patrones anti-injection en español
--
-- Preparada por Claude, APLICA MARTIN (regla: yo preparo, vos aplicás).
--
-- QUÉ ROMPE. En bot.injection_patterns tres patrones ES no tenían word-boundary
-- (\y en Postgres; \b es backspace y no sirve como boundary). Sin \y, el patrón
-- matchea DENTRO de palabras legítimas del rubro:
--   'nuevo rol'  → dispara con "quiero un nuevo ROLlo de vinilo"
--   'ignor..rol' → dispara con "ignora el ROLlo anterior"
-- Resultado: cliente legítimo marcado como injection y bloqueado.
--
-- FIX. Envolver los tokens de palabra con \y. El seed en firewall-tier1.sql ya
-- quedó corregido para instalaciones nuevas; esto arregla las filas YA cargadas.
-- Nota: firewall-tier1.sql NO es re-corrible sobre esta tabla (el insert usa
-- `on conflict do nothing` sin constraint único en `patron` → duplicaría filas),
-- por eso el update puntual en vez de re-seed.
--
-- IDEMPOTENTE. Los update matchean por el patrón viejo; correrlo dos veces no hace
-- nada la segunda vez (ya no existe el patrón viejo).
-- ═══════════════════════════════════════════════════════════════════════════

update bot.injection_patterns
   set patron = 'ignor[aá].*\y(instrucciones|reglas|rol)\y'
 where patron = 'ignor[aá].*(instrucciones|reglas|rol)';

update bot.injection_patterns
   set patron = 'olvid[aá].*\y(instrucciones|reglas|rol)\y'
 where patron = 'olvid[aá].*(instrucciones|reglas|rol)';

update bot.injection_patterns
   set patron = '\ynuevo rol\y'
 where patron = 'nuevo rol';

-- ── VERIFICACIÓN ─────────────────────────────────────────────────────────────
-- select patron, nota from bot.injection_patterns where nota like '%ES%' order by id;
-- -- los tres deben mostrar \y alrededor de los tokens.
