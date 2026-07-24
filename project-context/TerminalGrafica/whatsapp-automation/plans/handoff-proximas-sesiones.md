# Handoff — Bot WhatsApp Terminal Gráfica (`faq-bot-v6`)

> Estado y roadmap **forward-looking** para las próximas sesiones.
> El log histórico detallado vive en la memoria `chatwoot-whatsapp-impl-status`.
> El plan de build original está en [`v6-build-plan.md`](./v6-build-plan.md).
> Última actualización: **2026-07-23 (noche, paquete r6)**.
>
> **Reglas de trabajo que no cambian:** rol A (informador acotado, no configurador) · mundo cerrado (lo no listado no existe para el bot) · Claude prepara migraciones, **Martin las aplica** (Claude no toca la BD) · el bot corre en la VM de dev con el número de test, NO es prod de TG · commits en rama, nunca a `main` de `projects/` · **toda decisión de diseño se contrasta con un agente Fable ANTES de aplicarla; Claude aplica** (ver "Cómo usamos a Fable") · tras editar un nodo Code, correr `node tests/code-harness.js` SIEMPRE.

---

## ⭐ faq-bot-v7 "cotizador" — CONSTRUIDO 2026-07-22 (OK de Martin), pendiente de APLICAR

**Decisión de producto (Martin, 2026-07-22, logueada en `decisions/log.md` del AIOS):**
el cliente se informa TODO (precios, opciones, totales estimados) por WhatsApp; el
email queda SOLO para concretar el pedido. R1 v10.x (libro → email sin cotizar) era el
comportamiento diseñado y Martin lo rechazó como producto tras el replay real.

**Plan validado y aplicado al build: [`faq-bot-v7-cotizador.md`](./faq-bot-v7-cotizador.md)**
(Fable rondas 1-2 + verificación en `quote-utils.ts`). Núcleo: recolección de datos
mínimos en UN mensaje (por OPCIÓN listada, nunca por ejes) + total determinístico
precio × cantidad con brackets en `Armar Respuesta Precio` (el LLM sigue sin tipear
montos) + campos `paginas`/`copias` (n8n multiplica, max() de dos lookups) + flag
`por_pagina` + gate `solo_descuentos` (los recargos NUNCA reciben total) + doble faz
→ tabla sin total (gate TG ítem 31) + cap 10.000 + email reposicionado. Sin nodos
LLM nuevos (C1); split a especialista (C2) con gate numérico fijado en el plan §2.

**Build (todo commiteado):** `db/cotizador-v7.sql` · `n8n/flows/faq-bot-v7.json`
(v6 INTACTO como rollback) · harness 41/41 (13 casos v7 nuevos, 28 v10.x intactos) ·
`tests/suite-5-cotizador.md` (14 casos) · suite-3 anotada ([SUPERSEDED v7] en R1,
R12, C2, B1; E1 promovido a golden principal de primera mención) · suite-2 auditada
(solo 2.3 cambió de sentido).

**ESTADO POST-RONDA 1 DE SUITE-5 (2026-07-22, tarde):** Martin corrió la suite en
WhatsApp real. Maquinaria determinística OK (total, cap, papel_especial, render
páginas); LLM falló en resolución/recolección (12 incidentes I1-I12). **Fable r4:
el gate C2 SE DISPARÓ** (I2 producto equivocado + I8 pack = clase plata; I1 =
oscilación C2(c)). Veredicto: guards = piso (APLICADOS, `cd790a9`: numerales →
`producto_incoherente`, ventana papel K=3 + corrección, `por_pack` v7b, cascada
"por email", regateo/cross-sell al prompt; harness 53/53), C2 = spec lista en el
plan §Ronda 4 (nodo especialista + router determinístico vía bot.decisiones +
action `opciones` con menú renderizado por Code node), refinar el mono-prompt =
descartado para conducta monetaria. Herramienta visual de curación: spec validada
en plan §Ronda 4, build pendiente.

**C2 Y CURADOR CONSTRUIDOS (2026-07-23, OK de Martin, Fable r5 — plan §Ronda 5):**
split del cotizador (Prompt Cotizador + router determinístico + action opciones
con menú renderizado + volver), harness 63/63; curador visual
(`db/curador-export.sql` + `tools/curador-catalogo.html`) con SQL por clave
natural replayable en prod.

**RUNBOOK MARTIN (en orden):**
1. Si quedó pendiente: aplicar `db/cotizador-v7b.sql` (por_pack + seeds — REVISAR
   los NOTICEs; si algo no es pack, `set por_pack=false`).
2. **Grant del router — RESUELTO 2026-07-23:** el grant pelado falló con
   `role "bot_readonly" does not exist` porque en TESTING ese rol nunca se creó:
   la cred "Bot Readonly DB" conecta como owner (ya inserta en `bot.decisiones`
   vía Log Respuesta), así que `Get Ruta Cotizador` lee SIN ningún grant.
   Nada que hacer en testing. Para prod quedó `db/c2-router-grant.sql` (bloque
   guardado, no-op si el rol no existe). Sanity post-ronda sigue vigente: debe
   aparecer `pregunto_opciones`/`cotizador_answer` en `bot.decisiones` y el
   menú numerado en WhatsApp.
3. Re-importar `faq-bot-v7.json` (60 nodos: C2 = Get Ruta Cotizador, Prompt
   Cotizador, Get Opciones, Armar Menu Opciones, Enviar Menu, Log Menu, Forzar
   Ruta General + **isla refrescar-catalogo**, ver abajo). Verificar creds de los
   Postgres nuevos (Bot Readonly DB) y de Enviar Menu (Chatwoot API Token);
   abrir/guardar **Log Menu** (schema cache) + **TOGGLE**. v6 sigue desactivado
   de rollback.
   - **Isla refrescar-catalogo (commit 6710925):** 3 nodos SIN conexión al flujo
     principal. Bookmark `http://localhost:5678/webhook/refrescar-catalogo` (GET)
     → purga el cache del catálogo al instante (responde `cache_purgado: true`).
     OJO: solo la URL de PRODUCCIÓN persiste el purgado (staticData no se guarda
     en ejecuciones manuales) — el botón Execute del editor NO sirve. Reemplaza
     el toggle post-SQL. En prod: cerrar el path por firewall o header secreto.
4. Verificar el dato del anillado 24hs (query §Ronda 4 tabla I12) y confirmar si
   entre los casos 5→7 de ronda 1 hubo conversación nueva (si sí, la "dirección
   repetida" fue correcta per-conversation).
5. **Ronda 2 de suite-5 — ✅ CORRIDA 2026-07-23** (ver bloque r6 abajo: el loop
   de fixes de esta ronda ya está construido).
6. **Pasada 1 de curación — ✅ HECHA Y APLICADA 2026-07-23** con la skill
   `/tg-curar-catalogo` (pivot del curador visual, que queda de fallback).
   Artefactos: `db/curacion-2026-07-23.sql` (aplicado) + `.md` de decisiones +
   preguntas 35-41 en `preguntas-tg.md`. Verificado contra export post-aplicación:
   displays con acento, anillados I14 consolidados en línea única «Anillado
   plástico a4/oficio» (48/72/96 hs ocultos), 3 ocultos, por_pack refinado.
7. promptfoo cuando declares el build cerrado.

**RONDA 2 CORRIDA + PAQUETE r6 CONSTRUIDO (2026-07-23 noche):** Martin corrió la
ronda 2 completa (1-28). La maquinaria C2 funcionó (menú numerado, elección por
número, stickiness, firewall, anti-regateo, cap); fallaron la RESOLUCIÓN del LLM
(claves inventadas tipo "Impresiones a4 s/f b/n" → 0 filas → email, casos
4/14/18), el escape mono-variante de Get Precio (el anillado curado no matcheaba:
menú → "1" → email, caso 7), el descarte de ítems en multi-ítem (cupo 3, caso 11),
la UX del menú (orden string, 12 líneas, menú de 1 opción, casos 5/12/21), el leak
del "24 hs" (caso 13) y silencios del repeatNote ante pregunta repetida/"???".
**Diagnóstico completo + fixes: [`suite5-ronda2-fixes.md`](./suite5-ronda2-fixes.md).**
Paquete r6 (harness 81/81, contrastado con ronda adversarial r6-review — 7
hallazgos, 5 corregidos en el mismo paquete, ver plan §4; vigilar H7 `(variante
rescatada: mono)` en ronda 3): sin_match/ambiguo → REPREGUNTA ruteada al especialista
(nunca email; email solo para precios que el sistema no puede dar), guard de nicho
medicina, guard faz inversa, mono-variante siempre matchea, menú con orden
natural + pivot de packs + colapso de opción única + "vale mandar solo el número",
cupo opciones 4, prompts anti-fusión + multi-ítem + naturalidad, repeatNote con
excepción de pregunta repetida, curación b (`db/curacion-2026-07-23b.sql`: 4
variantes únicas → '.', ancho de lona al display del producto).

**RUNBOOK MARTIN — aplicar r6 + Aclarador + curaciones (en orden):**
1. Aplicar en el SQL editor, juntos: `db/curacion-2026-07-23b.sql` (4 variantes
   '.', anclaje apuntes/libro) **y** `db/curacion-2026-07-24.sql` (curación 1c:
   Sobre Inglés fantasma oculto, Kraft 130/300 empatado, Folletos 10x15).
   Revisar NOTICEs: 0 SKIPPED esperados.
2. GET `/webhook/refrescar-catalogo` (URL de producción de la isla — purga cache).
3. Re-importar `n8n/flows/faq-bot-v7.json` — **ahora 68 nodos** (antes 60): +8 del
   **Aclarador** (`¿Necesita Aclarador?`, `Armar Prompt Aclarador`, `Llamar LLM
   Aclarador`, `Aplicar Aclarador`, `¿Resolver?`, `Get Precio 2`, `Armar Respuesta
   Precio 2`, `Pre-Envío Precio`). **Verificar creds de los nodos nuevos:** `Get
   Precio 2` → Bot Readonly DB; `Llamar LLM Aclarador` → OpenRouter API (mismas
   creds que las existentes, n8n debería auto-mapear — confirmar). Abrir/guardar
   `Log Precio` (ahora lee de `Pre-Envío Precio`) y `Log Menu` (schema cache) +
   TOGGLE.
4. **Ronda 3**: replay mínimo del plan §5 (4, 5, 7, 11, 12, 13, 14, 15→18, 20,
   21, 25 repetido + "???", C2 faltantes, regresión 1/9/10/22-24/27/28) + los
   casos del Aclarador: "papel kraft" (→ debe PREGUNTAR 130 o 300, no elegir uno),
   "folletos 10x15" (→ ofrece los tres), un pedido con nombre mutado
   (→ resuelve al producto real y da el precio, sin mail). Marcadores nuevos en
   `bot.decisiones.notas`: `aclarador: resolver/preguntar/opciones/nada`,
   `(repregunta)`, `(variante rescatada: mono)`, `menu_pack`, `menu_unico`.
5. Preguntas TG nuevas: **36** (medicina), **37** (Sobre Inglés $0), **38**
   (sinónimos de urgencia del anillado).
6. promptfoo cuando declares el build cerrado.

**NOTA sobre el Aclarador (2ª llamada LLM):** cambio de diseño OK de Martin
2026-07-24 (decisions/log.md). Reemplaza la repregunta fija por un fallback que
resuelve o pide el dato que distingue, jailbreak-safe (mensaje actual como dato,
NO la historia). Detalle en `suite5-ronda2-fixes.md` §RC-0. El gemelo `Armar
Respuesta Precio 2` se deriva del original; si editás `Armar Respuesta Precio`,
regenerá con `node tests/regen-arp2-twin.js --write` (o el harness de 94 casos lo
caza).

**PRÓXIMA SESIÓN:** Martin trae resultados de ronda 3 → loop de fixes. Contexto:
`plans/suite5-ronda2-fixes.md` (diagnóstico + decisiones abiertas: pivot de packs
ON, 2ª llamada LLM post-menú descartada por ahora), catálogo real en
`db/export-actualizado-catalogo.json` (2026-07-23 21:25 — OJO: NO refleja la
curación b; si hay que diagnosticar displays, pedir re-export), harness
`node tests/code-harness.js` tras tocar Code nodes, cache vía isla (no toggle).

---

## Catálogo limpio (`producto_meta`) — ✅ APLICADO 2026-07-22 (runbook ejecutado por Martin)

**Sesión 2026-07-22: plan + build completos, contraste Fable en 4 rondas (build go).**
Todo el detalle y el diff para revisión está en
[`catalogo-limpio-producto-meta.md`](./catalogo-limpio-producto-meta.md). Resumen:

- **Hallazgo clave:** las "duplicadas" de IMPRESIONES/106gr NO eran duplicados — se
  distinguen por la columna `color` ('false'=b/n, 'true'=color) que nada usaba. El
  dedupe = exponer el eje en el nombre (8 renames vía `bot.variante_meta` nueva),
  con tripwire de orden de precios como única confirmación válida de la semántica.
- **Overlay completo en vistas** (contrato n8n intacto, cero cambios en nodos Code):
  `display_name`/`auto_sinonimo`/`oculto` en producto_meta + `variante_meta` +
  `rubro_meta` + auto-sinónimo del nombre viejo (gated: false en IMPRESIONES — el
  hijack rank-1 de la ronda 3) + `variante_origen` para telemetría.
- **Podas anti-hijack:** rubro-genéricos de IMPRESIONES y 106gr (display del 106 en
  PLURAL deliberado), 'apuntes' pelado de medicina (bug vivo: precio especial a
  cualquiera), + **Tier A del seed legacy** (scan Fable R4: 'lona mate' rompía la
  resolución exacta de Lona Mate, 'perforado', 'troquelado', 'tacos', 'folletos',
  OPP holografico/plata/etc.) + duplicación deliberada de 'volantes' en los 3
  folletos. Altas: espiralado→anillados, enmicado→plastificados, stickers, CV como
  caso de uso ×2, sinónimos anti-header ×6.
- **v10.8 en `faq-bot-v6.json`:** catálogo reagrupado por rubro (`RUBRO: X` +
  productos con `- ` debajo, bloque separado por línea en blanco) + leyenda nueva
  en el prompt. Harness 28/28.
- **`tests/suite-4-mostrador.md`:** 23 casos en lenguaje de cliente.

**RUNBOOK MARTIN — ejecutado 2026-07-22 (queda como referencia).** Nota del replay:
R1 dio la derivación a email tal como estaba diseñado; ese resultado disparó la
decisión de producto del v7 (sección ⭐).
1. Revisar el diff del plan (sección "EL DIFF") — tu revisión única.
2. Aplicar `db/catalogo-limpio-overlay.sql` (transaccional: si un assert falla no
   aplica nada; mirar los NOTICE de podas y HAZARD LEGACY del output).
3. Si quedó pendiente de la sesión anterior: `db/precio-freshness.sql` +
   `db/decisiones-execution-id.sql` van ANTES (la overlay recrea `bot.variantes`
   sobre la versión con `precio_actualizado`).
4. Re-importar `faq-bot-v6.json` (v10.8) + verificar creds + abrir/guardar los 3
   nodos Log + **toggle** (cache).
5. Correr: Ronda 2 de suite-3 (R1-R16) + **suite-4** + regresión suite-2. R5 debe
   SEGUIR dando ambiguo para "sobre inglés".

**Próxima sesión (según lleguen respuestas TG):** gates del plan (a4 → poda-o-
duplicación ya decidida, imanes, Sobre Ingles, módulos solo-medicina, 106 laser vs
Riso) + carga de servicios nuevos (fotocopias, escaneo, PPT por hoja) + Tier B de
sinónimos flaggeados + revisar NOTICEs HAZARD LEGACY como input del próximo tier.

---

## Cómo usamos a Fable (workflow vigente — pedido de Martin)

Instrucción original de Martin (2026-07-21, verbatim): *"Desplegá un bot Fable para
contrastar tus decisiones sobre las soluciones a los problemas que vamos encontrando,
vos las aplicas."*

**El patrón:** al inicio de la sesión, Claude despliega UN agente Fable (Agent tool) y
lo **continúa vía SendMessage durante toda la sesión** (mantiene el contexto acumulado
de todas las rondas — no spawnear uno nuevo por pregunta). Para cada problema:
1. Claude diagnostica y arma una propuesta CON alternativas y su descarte razonado.
2. Se la manda a Fable pidiéndole explícitamente que **refute** (no que valide): bordes,
   falsos positivos, casos que la propuesta fabrica.
3. Fable valida, enmienda o rechaza; **Claude aplica** lo que sobrevive, con caso de
   harness + golden de suite + commit por tema.

**Por qué funciona (evidencia de la sesión 2026-07-21):** Fable enmendó o mejoró casi
todas las propuestas — rank 3 devolviendo TODAS las variantes (ambiguo honesto en vez
de sin_match), el gap "dirección de correo" en la cascada de 1ª mención ANTES de que
apareciera en un test, el rechazo de cantidad-first sin marcador (trampa UX de preguntar
e ignorar), el sobre-disparo del ancla libro (encuadernar-ya-impreso), la clase C-cara
de la matriz, y el lookup de brackets como espejo del motor (orden original del array).
El costo es ~1-3 min por contraste; el retorno fue real en cada ronda.

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

**Post-ronda 1 de suite-3 (2026-07-21, misma noche):** Martin corrió la suite (con la vista ya al día tras el incidente de la vista vieja). Anduvo: inyección limpia, tabla de rangos, anti-repetición, todos los backstops, ambiguo y override. Falló y se arregló con el paquete Fable **v10.3** (`7d21ad0`): caso libro (entrevista sin salida + re-preguntar datos dados + ofrecer el mail sin darlo → ancla "trabajo compuesto" en 2c + regla "la dirección se escribe"), misses de resolución (variante `.` y "Autocad Lineal" → Get Precio v2 con tiers exacto/sinónimo/contains + fallback mono-variante clase `.` + catálogo publica "única"), render feo (". de X"), D4→noop (ancla "pregunta directa nunca es noop"), 1ª mención inconsistente (backstop determinístico en Parsear con guard "me repetís el mail"), execution_id en logs. Y **v10.4** (`d27ff48`): multi-precio vía campo opcional `mas` (máx 2 extras, render determinístico, single intacto; tabla de extra se ofrece, no se renderiza).

### Pendiente de Martin para activar Increment B
1. Aplicar `db/precio-freshness.sql` (si no quedó al día tras el incidente: es idempotente) **+ `db/decisiones-execution-id.sql`** (columna execution_id). Sanity: ~79 mostrable / ~54 solo_descuentos / ~25 con 1 regla de cantidad / ~2 override.
2. Re-importar `faq-bot-v6.json` (v10.3 + v10.4). Verificar creds (`Get Precio`/`Log Precio` → Bot Readonly DB; `Enviar Precio` → Chatwoot API Token; `OpenRouter Chat Model` → cred openRouter) y **abrir y guardar los 3 nodos Log** (el nodo Postgres cachea el schema; sin eso no toma execution_id). Togglear el workflow (resetea cache de catálogo).
3. Correr la **Ronda 2** de [`tests/suite-3-precios.md`](../tests/suite-3-precios.md) (§R1-R9: libro, clase ".", multi-precio, 1ª mención, D4). Lo que pasó en ronda 1 no se repite.
4. Re-correr suite-2 (no-regresión: prompt v9→v10.4) vigilando que las preguntas de desambiguación de producto no se hayan suprimido.
5. **Gate de go-live: RESUELTO por Martin (2026-07-21).** (a) Precios de lista SÍ (nunca gremio — cubierto por construcción: `audience='gremio'` filtrado en las vistas; lo que no vaya se limpia en el catálogo del bot); la lista actual está bien y va a conectarse al sistema diario del mostrador. (b) Cantidad-first: preguntar cuántas y dar el bracket exacto; sin cantidad → tabla (aplicado como v10.7). (c) Precio por página para libros SÍ, con "el precio final se cotiza vía mail" (= v10.5). Nota interna vigente: los trabajos compuestos quedan EXCLUIDOS de cualquier estimado con cantidad — doble faz, brackets por carilla y terminaciones hacen deshonesta cualquier multiplicación.

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

### Frescura de precios — RESUELTO: check ELIMINADO (2026-07-21, v10.7)
Martin confirmó que la lista de precios va a estar conectada al sistema que la gráfica
usa todos los días → la fuente es viva y el bot no es el eslabón débil. Se eliminó la
rama `fallback: stale` de la escalera (desarma la bomba del ~20-ago: todo `price_updated_at`
nació en el now() de la migración). Queda el **airbag**: tag `(precio>90d)` en `notas`
de `bot.decisiones`, sin efecto al cliente — si aparece, la conexión con el sistema
diario dejó de ser verdad y hay que revisar. Columna y trigger quedan en la DB.

### Paquete de preguntas a TG — MOVIDO a `preguntas-tg.md` (2026-07-22)
Única fuente de verdad: [`../preguntas-tg.md`](../preguntas-tg.md) — consolidado de
TODAS las sesiones: 4 gates del catálogo limpio, 7 directas de catálogo, 11 servicios
implícitos, segunda línea, foto de la lista del mostrador, y los 3 temas comerciales
a avisar (cobro Meta 1-oct, handoff asíncrono como cambio de alcance, SLA de
reclamos). Incluye la tabla de "ya resuelto — no re-preguntar" (plazos, envíos, USB,
medidas, espiralado/enmicado, etc.). Criterio transversal intacto: cada respuesta
aterriza como DATO, nunca como regla nueva de prompt.

### Limpieza sistemática del catálogo (idea B)
- Descubrir faltantes (fotocopias = consulta #1, y otros): **foto de la lista de precios del mostrador** (pedir a TG) + minar la casilla de mail; `bot.decisiones` como red reactiva permanente.
- **Ítems de taller (rubro "Taller": encuadernado, refilado, troquelados, etc.) — definir con TG (pedido Martin 2026-07-21):** cuándo aplican estos ítems y cada cuánto son, o si se deja simple como está hoy. Entra en la conversación del catálogo refinado.
- Limpiar en **capa de presentación** (`bot.producto_meta` overlay: `display_name`, re-agrupar cantidad-en-nombre como eje, ejes + centinela "FIN de opciones" por producto), **sin tocar** `products`/`product_variants` (motor del mostrador). LLM propone el mapping offline, **Martin revisa el diff una vez**, queda persistido.
- **Guard de vocabulario en log-only** (Code node, 0 tokens): red anti-confabulación + **detector de servicios faltantes** en el mismo nodo.
- **Dedupe del cluster IMPRESIONES — ✅ HECHO 2026-07-22** (sección ⭐; pendiente de
  aplicar). Post-aplicación: `fallback: ambiguo` debe DESAPARECER de las consultas de
  impresiones con producto+variante definidos — vigilarlo en `bot.decisiones`.

### Resiliencia LLM — dato de campo 2026-07-21
Durante la ronda suite-3, OpenRouter tiró "google/gemini-2.5-flash-lite is temporarily rate-limited upstream" (pool compartido saturado, no la cuenta de Martin). El path de degradación funcionó como se diseñó (retry 3x → escalar a humano; ojo: deja la conversación ASIGNADA y el bot no la retoma hasta desasignar). Levers para antes de prod, decidir junto con la sucesión de modelo (flash-lite muere 16-oct): **BYOK** (key propia de Google AI Studio en OpenRouter, ~5% fee, límites propios) y/o **array `models` de fallback** de OpenRouter (ojo: un modelo distinto corre sin calibrar — solo si el fallback pasa promptfoo).

### promptfoo — **gate final, Martin decide cuándo**
Se corre cuando Martin dé por cerrado el build. Golden cases: confabulación (regex `tapa|cartulina|metálico|\d+ ?gr`), JSON siempre parseable, los casos del árbol de ruteo, la costura 4/5. Es el gate anti-regresión de todo lo calibrado.

### Futuro lejano (no antes de prod)
- ~~Auto-sync del catálogo/metadata~~ → **PLANEADO 2026-07-22** como watchdog
  semanal + redactor de curación: [`catalogo-sync-workflow.md`](./catalogo-sync-workflow.md)
  (contraste Fable ronda 5; stateless + nombre_origen, 9 checks determinísticos,
  LLM solo redactor con filtro word-subset, **Telegram a Martin SIEMPRE** (decisión
  Martin: reemplaza Brevo), Martin aplica). Prerrequisitos: aplicar catálogo limpio
  + bot de Telegram (BotFather + chat_id + cred n8n). Build = sesión propia.
- Deploy a prod en **KVM 4 de TG** (sin contratar aún) + avisar a TG del cobro Meta por mensaje desde **1-oct-2026**.

---

## Mapa de commits — sesión 2026-07-22 (catálogo limpio v10.8)

`6c758bc` plan catálogo limpio (diff + log Fable 4 rondas) · `3e8e750` migración
overlay (`db/catalogo-limpio-overlay.sql`) · `e68ceab` v10.8 reagrupado por rubro ·
`f435f92` suite-4 mostrador (23 casos).
Estado al cierre: build completo y harness 28/28; TODO pendiente de aplicación por
Martin (runbook en la sección ⭐).

## Mapa de commits — sesión 2026-07-21/22 (ronda 2 en vivo → v10.7)

`c532533` "única" oculta en render · `ae448fb` tabla sin pie · `4ae7d32` variante solo
desde DB (fix "X de X") · `e8ad5a0` rank 3 + leyenda rubro + nombre canónico (clase OPP) ·
`162bf82` R11 recalibrado (2c directo = camino ideal) · `d184220` log stale/taller ·
`06dccef` cascada 1ª mención (fix "a nuestro email nuestro mail") · `debc09a` v10.5
oferta por página (libros) · `f1da716` matriz 34 situaciones universitarias · `1723fa3`
v10.6 multi-ítem reactivo · `39ff2d5` v10.7 cantidad-first + stale out + datos
operativos · `04f81e2` ronda 6 docs (13 respuestas de Martin).
Estado al cierre: harness 28/28; workflow con TODO aplicado pendiente de re-import +
toggle + Ronda 2 (R1-R16) + regresión suite-2.

## Mapa de commits de la última tanda (2026-07-20/21)
`7dd335f` motivo handoff · `674fd2d` backstop anti-repetición · `fdc0e9c` v7 · `dad26d6` v8 · `d0e9691` retry firewall · `1f36c0b` v9 · `fc769e9` error workflow.
