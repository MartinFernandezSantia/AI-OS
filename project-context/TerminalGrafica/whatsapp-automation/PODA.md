# PODA — qué es canon, qué se archiva

> Checklist de una sola vez. Objetivo: que de ~90 archivos, el "canon" que Martin
> **abre** sean ~8. El resto NO se borra (regla del AIOS): se mueve a `archives/`
> dentro de esta carpeta, con git como respaldo. **Nada se mueve hasta que Martin
> apruebe.** Cuando se ejecute, este archivo también se archiva.

## CANON — lo único que abrís seguido (8 archivos)

- `MAPA.md` — la fuente única de verdad (pipeline, dónde vive todo, glosario, el bucle)
- `plans/handoff-proximas-sesiones.md` — el **backlog vivo** (§3) y las preguntas a TG (§4).
  Ojo: su descripción de arquitectura es de v9, ya la reemplaza el MAPA. Sirve por el backlog.
- `data-model.md` — el esquema de la DB que ve el bot
- `mantenimiento-y-monitoreo.md` — operación y monitoreo
- `prod-readiness-review.md` — punch list de prod + el cambio de pricing de Meta (oct-2026)
- `n8n/flows/faq-bot-v10-live.json` — el flow vivo
- `tests/validate-v10-agents.js` — el test que corre contra v10
- `db/` (las `.sql` aplicadas) — la historia migratoria de la base, se conserva entera

## ARCHIVAR — muerto o superado, mover a `archives/`

**Flows viejos** (`n8n/flows/`): `faq-bot-v1..v8.json`, `faq-bot-v9-test.json`,
`faq-bot-BUGGED.json`, `tmp-dbl.json`, `.tmp/`.
→ Se conservan v10-live (vivo) y v9.json (rollback inmediato).

**Tests de v8/v9** (obsoletos contra v10): `code-harness.js` (los 354 casos son de v8 — la trampa),
`validate-v8-import.js`, `regen-arp2-twin.js` (el nodo ARP ya no existe en v10),
`suite-2..7-*.md`, `fase1-prompt-y-antiflood-test.md`.
→ Se conserva `suite-8-v10.md` + `ronda-2026-07-31-hallazgos.md` (última ronda).

**Planes de versiones ≤ v9** (`plans/`): `v6-build-plan.md`, `v8-*.md`, `v9-*.md`, `r7-*.md`,
`e0-atomizacion-catalogo.md`, `increment-b-precios.md`, `suite5-ronda2-fixes.md`,
`matriz-situaciones-universidad.md`, `mejoras-bot-post-test-20260718.md`,
`faq-bot-v7-cotizador.md`, `catalogo-limpio-producto-meta.md`.
→ Se conservan los 2 `consejo-*.md` como registro de decisiones de arquitectura, y
`catalogo-sync-workflow.md` (diseño futuro sin construir, sigue en backlog).

**Decks de rondas pasadas** (`decks/`): todos (`r7-*`, `rediseno-*`, `v8-2-*`, `v8-3-*`).

**Docs n8n viejos**: `n8n/roadmap.md` (v1→v4), `n8n/catalog-v5-build.md`,
`n8n/v6-seccion-6-7-decidir-switch.md`, `n8n/prompts/system-prompt-tg.md` (prompt de v5; el real
vive en los nodos del flow).

**Logs de curación intermedios** (`db/*.md`): archivar los `.md` explicativos por ronda
(`curacion-2026-07-2*.md`). **Los `.sql` NO se tocan** (son la historia aplicada de la base).

## CONFIRMAR con Martin antes de mover (no lo sé desde el código)

- `tests/build-v10-agents.js` + `build-v10-agents-parte2.js` — ¿es así como **generás/mantenés**
  v10 (build reproducible, como era `build-v9.js`)? Si sí, es CANON, no se archiva.
- `db/cotizador-v7.sql` / `cotizador-v7b.sql` — ¿las funciones de precio que usa v10 son estas o
  ya las reemplazó otra migración? Si están vivas, CANON.
- `preguntas-para-tg.md` vs `preguntas-tg.md` — parecen duplicado. ¿Cuál es el vigente?
- `README.md` — vigente para infra/compliance, pero su sección "Próximos pasos" describe el
  flow v1. ¿Lo actualizo a v10 o lo dejo?
- `n8n/setup-guide.md` — ¿sigue siendo la guía de instalación válida para el KVM 4?

## Índice de lo archivado

Cuando se ejecute, `archives/` lleva un `INDICE.md` con una línea por archivo (fecha + qué era),
para que la historia sea rastreable sin ensuciar el canon. git guarda el detalle completo.
