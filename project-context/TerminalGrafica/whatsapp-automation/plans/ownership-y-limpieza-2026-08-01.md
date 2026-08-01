# Plan: Tomar propiedad del bot de WhatsApp de TG (2026-08-01)

> Ejecución en curso. Entregables vivos: `MAPA.md` (fuente única de verdad, incluye el bucle),
> `PODA.md` (limpieza pendiente de aprobación). El walkthrough con Martin cierra la transferencia.

## Contexto

Martin dejó todo el desarrollo y el pensamiento del bot de TerminalGrafica en Claude y se volvió
un "vibe coder" que solo testea y espera soluciones mágicas. Resultado: no entiende el sistema,
no puede meter mano, y sospecha que está sobre-complejizado. El bot está en desarrollo con
**entrega inminente** (vendido jul-2026, aún sin entregar).

El diagnóstico real no es solo "el bot es complejo". Son tres problemas apilados:

1. **Conocimiento desparramado** en ~40 documentos, sin un solo mapa.
2. **Medio ilegible:** el flow vivo es un JSON de 190KB con 75 nodos.
3. **Complejidad mezclada:** basura acumulada + complejidad real evaluable + complejidad que carga
   peso (guardas de precio = plata), todas revueltas.

Hallazgo clave de la exploración: **el flow vivo (`v10-live`) no tiene doc de diseño.** Los planes
terminan en v9, que era otra arquitectura. Lo que corre en producción es lo menos documentado.

**Decisiones de Martin:**
- Nivel buscado: **dueño de la lógica** (entiende y decide; Claude ejecuta la mecánica de n8n y
  muestra diffs legibles).
- Estabilidad: **no tocar el flow que anda** por la entrega inminente. Recortes reales de
  complejidad = post-entrega, decididos por él.
- Foco de hoy: **entender y ordenar.**

## Entregables

1. **MAPA.md** — pipeline en 9 etapas con etiqueta `CARGA PESO`/`EVALUABLE`/`CLUTTER`, dónde vive
   cada cosa, estado vivo, glosario, y el bucle de trabajo. ✅ redactado; se cierra en el walkthrough.
2. **PODA.md** — lista canon/archivar/confirmar. ⏳ pendiente de aprobación de Martin antes de mover.
3. **EL BUCLE** — proceso de 5 pasos (Martin observa/decide → Claude ejecuta + diff legible →
   Martin revisa → se registra). ✅ escrito al final del MAPA.
4. **Walkthrough** — recorrer el flow etapa por etapa; Martin pregunta y corrige hasta poder
   explicarlo sin mirar. Verificar test verde en v10.

## Lo que NO hacemos ahora

- No tocamos `faq-bot-v10-live.json` (entrega inminente).
- No recortamos complejidad "evaluable" (Guardrails Tier-2, Relevancia, loops de reintento). Se
  etiqueta hoy, se evalúa post-entrega, lo decide Martin.
- No generamos docs nuevos más allá del MAPA/PODA. El problema fue exceso de artefactos.

## Verificación

1. Martin explica las 9 etapas en sus palabras, sin mirar el flow.
2. El canon queda en ~8 archivos; el resto en `archives/` con índice.
3. Martin corre `WF=faq-bot-v10-live.json node tests/validate-v10-agents.js` y ve verde él mismo.
4. El bucle se estrena en el próximo cambio real.
