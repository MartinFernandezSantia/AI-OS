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

### Paquete de preguntas a TG — versión FINAL post-respuestas de Martin (2026-07-21)
Ya respondidas por Martin y aplicadas (v10.7): plazos (no se informan → answer derivando),
envíos (no hay), USB (sí en mostrador), medidas grandes (por m²), vegetal x10 (sigue a
email). Quedan para TG, en una sola conversación:

**Directas:** (1) medios de pago y seña (Martin consulta); (2) ¿imanes se venden al
público? (existe Iman con tabla — confirmar); (3) sobres ingleses duplicados en el
sistema (¿unidad vs pack? ¿cuál va?).

**Servicios implícitos** (Martin r4: TG calcula internamente trabajos comunes no
cargados, ej. "fotocopia = valor impresión" — preguntar cómo se calcula cada uno y
desde cuántas unidades; lista podada con criterio de mostrador universitario):
fotocopias b/n y color (¿= valor impresión?); escaneo/digitalización (¿por hoja? ¿lo
mandan por mail?); **impresión de diapositivas/PowerPoint 2-4-6 por hoja** (clásico
universitario — ¿se cobra por hoja o por slide?); plegado/doblado (trípticos — pega con
Folletos); **empastado/tapa dura** (tesis de posgrado) + termoencuadernado; tapas para
anillados (¿EXISTEN como producto? — cierra con datos la confabulación del test 1.2);
foto carnet 4x4; impresión de fotos 10x15/13x18; **póster académico de congreso A0/A1**
(¿se hace en lona/PVC por m²?); impresión en el acto desde mail/WhatsApp/celular
(proceso de mostrador); espiralado (¿sinónimo de anillado? → producto_meta); enmicado
(¿sinónimo de plastificado? → producto_meta); guillotinado/corte chico suelto.
Segunda línea (si la reunión da): sellos, diseño/ajuste de archivo, talonarios AFIP,
transparencias/filminas, papel fotográfico, mapas/planos plegados.

**Criterio transversal:** cada respuesta aterriza como DATO (producto nuevo, sinónimo
en producto_meta, o línea de Info del negocio) — nunca como regla nueva de prompt.

### Limpieza sistemática del catálogo (idea B)
- Descubrir faltantes (fotocopias = consulta #1, y otros): **foto de la lista de precios del mostrador** (pedir a TG) + minar la casilla de mail; `bot.decisiones` como red reactiva permanente.
- **Ítems de taller (rubro "Taller": encuadernado, refilado, troquelados, etc.) — definir con TG (pedido Martin 2026-07-21):** cuándo aplican estos ítems y cada cuánto son, o si se deja simple como está hoy. Entra en la conversación del catálogo refinado.
- Limpiar en **capa de presentación** (`bot.producto_meta` overlay: `display_name`, re-agrupar cantidad-en-nombre como eje, ejes + centinela "FIN de opciones" por producto), **sin tocar** `products`/`product_variants` (motor del mostrador). LLM propone el mapping offline, **Martin revisa el diff una vez**, queda persistido.
- **Guard de vocabulario en log-only** (Code node, 0 tokens): red anti-confabulación + **detector de servicios faltantes** en el mismo nodo.
- **Dedupe del cluster IMPRESIONES — prioridad SUBIDA (2026-07-21):** la oferta de costo por página del ancla libro (v10.5) va a dirigir tráfico exacto a la zona sucia conocida (variantes duplicadas de IMPRESIONES → `ambiguo` → email). Monitorear `filas_sql` y `fallback: ambiguo` en `bot.decisiones`; ese dedupe va primero en la limpieza.

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
