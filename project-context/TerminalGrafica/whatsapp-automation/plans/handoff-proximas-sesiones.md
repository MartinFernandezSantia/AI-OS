# Handoff — Bot WhatsApp Terminal Gráfica (`faq-bot-v6`)

> Estado y roadmap **forward-looking** para las próximas sesiones.
> El log histórico detallado vive en la memoria `chatwoot-whatsapp-impl-status`.
> El plan de build original está en [`v6-build-plan.md`](./v6-build-plan.md).
> Última actualización: **2026-07-21**.
>
> **Reglas de trabajo que no cambian:** rol A (informador acotado, no configurador) · mundo cerrado (lo no listado no existe para el bot) · Claude prepara migraciones, **Martin las aplica** (Claude no toca la BD) · el bot corre en la VM de dev con el número de test, NO es prod de TG · commits en rama, nunca a `main` de `projects/`.

---

## Estado actual (hecho y commiteado)

Núcleo del bot **completo y calibrado**: `Webhook HMAC → Firewall Tier-1 → Filtro → Debounce → Decidir → Switch → (cache catálogo) → Armar Mensajes → Guardrails Tier-2 → LLM → Parsear → answer/handoff/noop → logging`.

- **System Prompt v9** — rol A, árbol de ruteo con prioridad, mundo cerrado anti-confabulación, regla "¿algo más?", email de primera mención. (v7 `fdc0e9c` → v8 `dad26d6` → v9 `1f36c0b`)
- **Backstop determinístico anti-repetición** en `Parsear Respuesta` (`674fd2d`).
- **Firewall Tier-1 + Tier-2** (jailbreak+topical) construidos; `retryOnFail` en los refusals para no re-strikear desde el historial (`d0e9691`).
- **Error workflow** `tg-bot-error.json` + tabla `bot.errores` (`fc769e9`).
- **Motivo del handoff** logueado en `bot.decisiones.notas` (`7dd335f`).
- ✅ Cierre de Martin 2026-07-21: cred openRouter creada, migraciones aplicadas, workflows importados (error workflow seteado), rondas suite-2 + v9 corridas.

---

## Precios (Increment B) — CONSTRUIDO 2026-07-21, pendiente de aplicar/testear

Plan y decisiones: [`increment-b-precios.md`](./increment-b-precios.md). Resumen del diseño:

- **Alcance v1 (decisión Martin):** solo `mostrable`; `tiene_reglas` sigue a cotización por email. Motor de reglas NO entra en n8n.
- **Catálogo anotado:** `Get Catálogo` marca con `*` las opciones con precio de lista → el LLM sabe QUÉ tiene número (nunca CUÁNTO) y redirige el resto a email con sus palabras.
- **Contrato:** nueva action `precio` (`producto` + `variante` + reply con marcador `{{PRECIO}}`). **El LLM nunca tipea el número**: lo inyecta n8n desde `bot.variantes` (mismas filas que el motor del mostrador).
- **Rama nueva:** `Switch Acción → Get Precio → Armar Respuesta Precio → Enviar Precio → Log Precio` (`accion='informo_precio'`, `filas_sql`, notas con resultado). Fallbacks determinísticos: sin match / ambiguo / `tiene_reglas` / stale (>30d) → redirect a email respetando `avisoDado`; patrón de plata tipeado por el LLM → plantilla fija.
- **Formato (decisión Martin):** `$12.345,67` (es-AR, dos decimales), SIN leyenda de IVA (lo maneja la gráfica al tomar el pedido).
- **Frescura:** columna nueva `price_updated_at` + trigger (solo ante cambio real de `price`; `bulk_upsert_products` usa UPDATE plano así que no re-fresca sin cambio) + `bot.variantes` recreada con `precio_actualizado`.
- **v10.1 (revisión adversarial Fable 2026-07-21, tras el test en vivo de Martin):** el gate estricto dejaba sin número a TODO el laser color (la consulta #1). Desbloqueo de las 54 variantes bloqueadas SOLO por reglas `discount` (el motor solo puede bajar ese precio → techo garantizado): columna `solo_descuentos` en la vista, mismo `*` en el catálogo, **caveat neutro** inyectado dentro de `{{PRECIO}}` ("precio de lista; el precio final del trabajo te lo confirma el equipo" — sin prometer descuentos: son `confirmation=true`, discrecionales). + **Backstop doble faz** (pedido d/f sobre variante no-d/f → sin número) + **agujero 2a cerrado** (spec extra no listada sobre opción `*` → 2c sin número) + **fix funnel 2c** (sin candidatos con `*` → derivar apenas identificado el producto). Detalle completo en el plan.

**v10.2 (decisión Martin "desbloquear todo", 2026-07-21):** escalera determinística completa en `Armar Respuesta Precio` — override / qr-múltiple / precio $0 → email; exactamente 1 regla de cantidad → **tabla de rangos verbatim** (cap 6, guion por línea, exacta: los qr son `confirmation=false` y reemplazan el precio); sin reglas → número limpio; resto → número + caveat neutro. Cobertura 181/185. Descartado con Fable: pseudo-variantes en catálogo (LLM haciendo bracket-mapping = precio fantasma indetectable), números en el prompt, workflow materializador (vista SQL lo reemplaza). Bug real cazado: 2 variantes $0 eran `mostrable` (habrían contestado "$0,00"). Frescura/vigencia de reglas: diferido a pedido de Martin.

### Pendiente de Martin para activar Increment B
1. Aplicar `db/precio-freshness.sql` como migración timestamped en el quote-system (recrea `bot.variantes` con `precio_actualizado` + `solo_descuentos` + `tiene_override` + `n_reglas_cantidad` + `rangos_cantidad` → re-grant incluido). Sanity: ~79 mostrable / ~54 solo_descuentos / ~25 con 1 regla de cantidad / ~2 override.
2. Re-importar `faq-bot-v6.json` (prompt v10.1 + escalera v10.2). Verificar que `Get Precio`/`Log Precio` tomaron la cred **Bot Readonly DB** y `Enviar Precio` la de **Chatwoot API Token**.
3. Correr [`tests/suite-3-precios.md`](../tests/suite-3-precios.md) (mensajes listos para pegar, catálogo real, prerequisitos incluidos — OJO: bustear/esperar el cache de catálogo 10 min tras aplicar la migración, si no la ronda corre sin `*`).
4. Re-correr suite-2 (no-regresión: el prompt cambió v9→v10.1) vigilando que las preguntas de desambiguación de producto no se hayan suprimido.
5. **Gate de go-live (no bloquea el test):** mandar a TG las DOS preguntas del plan: (a) ¿precio de lista con caveat sí o no? ¿lista al día? + foto de la lista del mostrador (cierra el gap fotocopias); (b) ¿tabla de cantidad completa por WhatsApp (screenshoteable por la competencia) o solo "desde $X según cantidad"? ¿precio base para los ítems con adicionales?

---

## Cola después de precios (con sus gates)

### Token-reduction — **gate: verificar caching primero (Martin, 10 min)**
Magnitud total ~$9-11/mes → solo levers de riesgo cero. Orden:
1. **Prompt caching** (Gemini implícito, OpenRouter passthrough). El prefijo system+catálogo (~11k) ya es elegible. **Verificar empírico**: 2 requests idénticos desde n8n → mirar cached tokens en el Activity de OpenRouter. Si funciona: *opcional* reordenar `avisoNote`/`repeatNote` al FINAL (pegados al user) para cachear también el historial + no truncar en ventana deslizante.
2. **Tier-2 guard-on-trigger** — medir 2 semanas (guard vs bot); si redundante con v9, correrlo solo ante señal barata. ~15%.
3. **Comprimir v9 ~30%** — una pasada, gate promptfoo, árbol + ejemplos anclados + contrato JSON **verbatim**.
4. Scoping determinístico de opciones — **DIFERIDO** (con caching cuesta centavos; la limpieza del catálogo lo achica gratis).
> Rechazado: retrieval por categoría con clasificador LLM (rompe el mundo cerrado → falsos handoffs).

### Handoff → asíncrono honesto — **gate: formalizar con TG + SLA (Martin+TG)**
TG no quiere empleados mirando Chatwoot; un humano lento tras una charla fluida enoja al cliente. Decisión: **"handoff asíncrono honesto"**.
- **El contrato del LLM NO se toca** (action handoff + árbol reglas 1/4 → preserva telemetría `motivo` + freno anti-confabulación).
- Downstream: cae `Asignar a Humano` (+ regla Resolved→Remove-Agent); quedan `Label` + `Nota Privada`; se agrega **notificación por email a TG** (re-agrega Brevo, confirmar deliverability); **`Mensaje Escalación` reescrito honesto** (sin "en breve te responden"; mail + tel 0223 476-0019 + local + horario).
- Reclamos: heurística JS sobre `motivo` (reclamo/enojo) → email URGENTE.
- **Gates de Martin:** (1) es **cambio de alcance** vs lo vendido a TG (incluía takeover en vivo) → formalizar por escrito primero; (2) decidir **SLA de reclamos** con TG.

### Archivos (audio / imagen / otros)
Hoy hay un solo "no puedo procesar archivos". flash-lite tiene **audio nativo** → transcribir/entender sin servicio extra; imagen (foto de lo que quieren imprimir) → describir. Rutas nuevas por tipo. Plan propio.

### Limpieza sistemática del catálogo (idea B)
- Descubrir faltantes (fotocopias = consulta #1, y otros): **foto de la lista de precios del mostrador** (pedir a TG) + minar la casilla de mail; `bot.decisiones` como red reactiva permanente.
- Limpiar en **capa de presentación** (`bot.producto_meta` overlay: `display_name`, re-agrupar cantidad-en-nombre como eje, ejes + centinela "FIN de opciones" por producto), **sin tocar** `products`/`product_variants` (motor del mostrador). LLM propone el mapping offline, **Martin revisa el diff una vez**, queda persistido.
- **Guard de vocabulario en log-only** (Code node, 0 tokens): red anti-confabulación + **detector de servicios faltantes** en el mismo nodo.

### Resiliencia LLM — dato de campo 2026-07-21
Durante la ronda suite-3, OpenRouter tiró "google/gemini-2.5-flash-lite is temporarily rate-limited upstream" (pool compartido saturado, no la cuenta de Martin). El path de degradación funcionó como se diseñó (retry 3x → escalar a humano; ojo: deja la conversación ASIGNADA y el bot no la retoma hasta desasignar). Levers para antes de prod, decidir junto con la sucesión de modelo (flash-lite muere 16-oct): **BYOK** (key propia de Google AI Studio en OpenRouter, ~5% fee, límites propios) y/o **array `models` de fallback** de OpenRouter (ojo: un modelo distinto corre sin calibrar — solo si el fallback pasa promptfoo).

### promptfoo — **gate final, Martin decide cuándo**
Se corre cuando Martin dé por cerrado el build. Golden cases: confabulación (regex `tapa|cartulina|metálico|\d+ ?gr`), JSON siempre parseable, los casos del árbol de ruteo, la costura 4/5. Es el gate anti-regresión de todo lo calibrado.

### Futuro lejano (no antes de prod)
- Auto-sync del catálogo/metadata cuando TG cambia la BD de quote-system (hoy pull con cache 10min; gap real = sinónimos/usos curados a mano → check semanal de 1 línea alcanza, no un workflow).
- Deploy a prod en **KVM 4 de TG** (sin contratar aún) + avisar a TG del cobro Meta por mensaje desde **1-oct-2026**.

---

## Mapa de commits de la última tanda (2026-07-20/21)
`7dd335f` motivo handoff · `674fd2d` backstop anti-repetición · `fdc0e9c` v7 · `dad26d6` v8 · `d0e9691` retry firewall · `1f36c0b` v9 · `fc769e9` error workflow.
