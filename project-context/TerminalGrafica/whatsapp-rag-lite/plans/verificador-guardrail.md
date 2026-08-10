# Plan — Rescopear el Verificador del bot RAG lite (guardrail de política + validación de producto gateada por etapa)

Estado: **IMPLEMENTADO** en `scripts/build-flow.mjs` (2026-08-10). Pendiente de Martin: importar/cablear el flow en n8n y probar en vivo (medir tokens).

## Contexto

En los tests del bot RAG lite (n8n), la fase posterior al Agente principal —el pre-fetch de catálogo + el **Verificador**— es la que falla. El Agente principal **no** viene cometiendo errores de producto, pero el Verificador genera **falsos positivos** al validar esos productos. Cada falso positivo disparaba una **regeneración** (vuelve al Agente principal, camino caro) y una ejecución de ~15k tokens terminaba en ~50k.

Decisión (afinada tras la revisión de Fable): en vez de eliminar del todo la validación de producto, se hacen dos cosas a la vez:
1. **Matar la regeneración** — la causa real del salto de tokens. El Verificador solo puede `aprobar` o `corregir`; nunca re-dispara al Agente.
2. **Gatear la validación de producto por etapa** — el veredicto comparativo contra el catálogo corre SOLO cuando el bot realmente ofreció productos (`etapa` = `recomendacion` o `seguimiento`). Fuera de esas etapas no se trae catálogo: ahí el Verificador es solo un guardrail de política liviano.

Resultado: tope duro de tokens (sin regeneraciones), menos superficie de falso positivo, y sin perder las barreras de política ni la alarma de invención de nombres.

## Alcance del Verificador (implementado)

### A) Checks de política — SIEMPRE (toda etapa, sin catálogo)
1. **no_trabajado** — la imprenta NO hace X (hoy: fotocopias; lista ampliable). Se evalúa primero.
2. **info_no_permitida** — no prometer/afirmar plazos, tiempos, envíos, stock, ni toma/estado de pedidos. Frontera taxativa: atributos, precios y formas de cobro NO se auditan acá.
3. **derivacion_prematura** — no empujar al mail antes de que el cliente pida avanzar. Acotado al turno actual. "Cotizar por mail" / "el total se cierra por mail" NO son derivación.
4. **fuera_de_rol** — responder solo info del negocio y del rol del bot.
5. **pedido_o_archivo_por_canal** — no tomar el pedido ni pedir archivos por el chat. Matiz: derivar archivo + pedido al mail (`terminalgrafica@gmail.com`) está bien → se aprueba.

### B) Veredicto comparativo de producto — SOLO si `etapa` ∈ {recomendacion, seguimiento}
`fusion_variantes` y `producto_inventado`, contra las fichas reales inyectadas por `Armar Verificación`. En otras etapas no se inyecta catálogo.

### C) Observabilidad — SIEMPRE
`faltantes` (nombre afirmado sin fila exacta, sin LLM) se computa siempre y se adjunta al objeto `verificacion` (→ columna `verificacion` de `bot.rag_decisiones`).

### Diferido / cubierto
- **cohesividad con mensajes anteriores** → diferida a la integración con Chatwoot.
- **respuesta no vacía** → ya cubierta en `Preparar Respuesta` (guard determinista).

### Acciones y sesgo
- Solo `aprobar` / `corregir`. `regenerar` eliminado.
- Sesgo invertido: "marcá solo violaciones claras; ante la duda, aprobá".

## Cambios aplicados en `scripts/build-flow.mjs`
- `sistemaVerif`: reescrito (política siempre + comparación condicional + fast-path redefinido + sesgo invertido).
- `esquemaVerif`: `accion` = [aprobar, corregir]; `tipo` = 7 nuevos.
- `sistemaCorrector`: blindaje ("si no ves la observación, dejá el mensaje tal cual") + `{Pn}` legítimo + nuevos tipos.
- `Traer Catálogo Real`: se conserva (query inofensiva, 0 filas fuera de recom/seguimiento).
- `Armar Verificación`: gatea la inyección de catálogo por `etapa`; computa `faltantes` siempre.
- `Leer Veredicto`: adjunta `faltantes` a `verificacion`; colapsa cualquier acción ≠ aprobar a corregir.
- Borrados: nodos `¿Reintentar? (máx 3)` y `Feedback Reintento`. `Ruteo Acción`: 2 salidas.
- Comentarios de cabecera + sticky `Nota` actualizados. No se tocó el `esquemaSalida` del Agente.

## Verificación
- `pnpm flow:build` → OK (28 nodos). `pnpm test` → 29/29 verdes.
- Pendiente en vivo (n8n, nodo Chat interno): saludo→aprobado; pedido real en recomendacion→aprobado sin regeneración; fusión forzada→corregir; fotocopias→no_trabajado; promesa de plazo→info_no_permitida; off-topic→fuera_de_rol; archivo por chat→corregir vs archivo al mail→aprobado; opción sin precio→"cotizar por mail" aprobado. Medir tokens en la vista de ejecuciones (Claude no las ve; Martin pasa el dato). `estado='corregido'` = proxy de falsos positivos.

## Notas para después
- Cohesividad con historial al integrar Chatwoot.
- Const `POLITICA` compartida entre los 3 prompts (elimina el sync manual de mail/`no_trabajado`).
