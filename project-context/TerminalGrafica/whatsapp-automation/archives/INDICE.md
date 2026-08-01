# Archivo — índice

Lo que se sacó del canon el **2026-08-01** durante la poda de propiedad del bot.
Nada se borró: está acá y en el historial de git. El canon vivo quedó descrito en
`../MAPA.md`. Si necesitás el detalle histórico de una versión, buscá acá.

## `flows/` — versiones viejas del flow n8n
`faq-bot-v1..v8.json` (evolución del bot), `faq-bot-v9-test.json` (variante de test de v9),
`faq-bot-BUGGED.json` y `tmp-dbl.json` (snapshots rotos/temporales).
→ Vivos quedaron `faq-bot-v10-live.json` (el que corre) y `faq-bot-v9.json` (rollback inmediato).

## `tests/` — harness y suites de v8/v9
`code-harness.js` (los 354 casos, **de v8** — busca nodos que v10 no tiene, era la trampa),
`validate-v8-import.js`, `regen-arp2-twin.js` (el nodo ARP ya no existe en v10),
`suite-2..7-*.md` (rondas de test superadas por la suite-8), `fase1-*` (antiflood inicial).
→ Vivos: `validate-v10-agents.js` + tests v10 + `suite-8-v10.md` + rondas 07-31.

## `plans/` — planes de build de versiones ≤ v9
Todos los `v6/v8/v9-*`, `r7-*`, `e0-atomizacion`, `increment-b`, `suite5-ronda2`,
`faq-bot-v7-cotizador`, `catalogo-limpio-producto-meta`, `matriz-situaciones`, `mejoras-post-test`.
→ Vivos: los 2 `consejo-*` (registro de arquitectura), `catalogo-sync-workflow` (diseño futuro),
`handoff-proximas-sesiones` (backlog vivo), `ownership-y-limpieza-2026-08-01`.

## `decks/` — slide decks de rondas pasadas
`r7-atomizacion-y-split`, `rediseno-resolucion`, `v8-2-ronda-completa`, `v8-3-pasada-adversarial`.

## `n8n/` — docs de setup/arquitectura viejos
`roadmap.md` (v1→v4), `catalog-v5-build.md`, `v6-seccion-6-7-decidir-switch.md`,
`prompts/system-prompt-tg.md` (prompt de v5; el real vive en los nodos del flow).
→ Vivo: `n8n/setup-guide.md`.

## raíz — `preguntas-para-tg.md`
El mensaje de 25 preguntas que Martin **ya le envió a TG** (copia estática, registro).
→ Vivo quedó `preguntas-tg.md` (el maestro / fuente de verdad de lo pendiente).

## `db/` — logs explicativos de curación (solo los `.md`)
`curacion-2026-07-23/24/24b/27/28.md` y `curacion-e0-2026-07-26.md`.
→ **Todos los `.sql` de curación se conservaron** en `db/` (son la historia aplicada de la base).
