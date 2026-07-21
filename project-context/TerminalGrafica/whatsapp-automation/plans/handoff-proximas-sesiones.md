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

### Pendiente de Martin para cerrar lo ya construido
1. Crear cred `openRouterApi` en n8n + seleccionarla en `OpenRouter Chat Model` (hoy placeholder).
2. Aplicar migraciones: `db/firewall-tier2-strike.sql`, `db/firewall-tier1-patterns-jailbreak.sql`, `db/bot-errores.sql`.
3. Importar `faq-bot-v6.json` + `tg-bot-error.json`; en el workflow principal setear **Settings → Error Workflow → tg-bot-error**.
4. Correr las rondas de test (suite-2 + ronda v9).

---

## ⭐ PRÓXIMO A ATACAR: Precios (Increment B)

**Objetivo:** que el bot pueda dar info de **precios** de los productos del catálogo.

### Contexto y restricciones duras (de memoria)
- Las filas de precio son **las MISMAS que usa el motor del mostrador** (sistema de presupuestos). **NUNCA recalcular en n8n** = precio fantasma.
- Con el ruleset real: **57% de las variantes (106/185) tienen precio por REGLA** (`tiene_reglas`) → no hay número directo. Solo **~79 (43%) son "mostrable"** (número de lista directo).
- Diseño previo (decisión 2026-06-29): mostrable → mostrar número (plantilla fija); `tiene_reglas` → motor compartido (`lib/quote-utils.ts`) **o** rango + captura; `updated_at > 30d` → auto-silencio; variable sin poder calcular → rango, **nunca número pelado**.
- La vista `bot.variantes` ya existe (nombres/opciones, SIN precio hoy); falta traer el **precio** on-demand.

### Choques con el estado actual (a resolver en el plan)
- **El prompt v9 dice hoy "NO das precios, NO cotizás".** Increment B **relaja** eso para los `mostrable` → hay que reescribir esa parte con cuidado y **re-testear** (y respetar el caching: cambio de prompt = re-medir).
- Nueva rama/nodo: traer el precio **on-demand** solo para el/los producto(s) que el cliente pregunta (no volcar toda la lista: tokens + no exponer la lista completa).
- Interacción con el árbol: hoy la **regla 2** manda "precio → answer + email". Con Increment B, precio de un `mostrable` pasa a **answer CON número**; `tiene_reglas` sigue derivando a cotización.

### Decisiones a tomar en la sesión de plan
1. **Alcance del MVP:** ¿v1 muestra solo `mostrable` (número) y para `tiene_reglas` deriva a cotización por mail? (recomendado — **no** meter el motor de reglas en n8n en v1). ¿O se llama al motor compartido para las reglas? (más complejo, fase posterior).
2. **Cómo se trae el precio:** on-demand por producto mencionado (tipo scoping) vs todo. → on-demand.
3. **Frescura:** `updated_at > 30d` → no mostrar → cotización.
4. **Formato del número:** moneda, ¿IVA incluido?, redondeo — **confirmar con TG**.
5. **Prompt:** cómo relajar "no precios" solo para `mostrable` sin reabrir confabulación de precios inventados (el mundo cerrado también aplica a precios: si no hay número mostrable, NO inventar).

### Archivos/objetos relevantes
- Vistas `bot.taxonomia` / `bot.variantes`; `Get Catálogo` node; `seed-prod-catalog.sql` (catálogo real); motor `lib/quote-utils.ts` (`collectCategoryRules`).

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

### promptfoo — **gate final, Martin decide cuándo**
Se corre cuando Martin dé por cerrado el build. Golden cases: confabulación (regex `tapa|cartulina|metálico|\d+ ?gr`), JSON siempre parseable, los casos del árbol de ruteo, la costura 4/5. Es el gate anti-regresión de todo lo calibrado.

### Futuro lejano (no antes de prod)
- Auto-sync del catálogo/metadata cuando TG cambia la BD de quote-system (hoy pull con cache 10min; gap real = sinónimos/usos curados a mano → check semanal de 1 línea alcanza, no un workflow).
- Deploy a prod en **KVM 4 de TG** (sin contratar aún) + avisar a TG del cobro Meta por mensaje desde **1-oct-2026**.

---

## Mapa de commits de la última tanda (2026-07-20/21)
`7dd335f` motivo handoff · `674fd2d` backstop anti-repetición · `fdc0e9c` v7 · `dad26d6` v8 · `d0e9691` retry firewall · `1f36c0b` v9 · `fc769e9` error workflow.
