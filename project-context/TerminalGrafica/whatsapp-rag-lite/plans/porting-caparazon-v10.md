# Plan — Portar el caparazón de producción del v10 al bot RAG lite (variante Chatwoot)

> Estado: **F1–F5 CONSTRUIDO** (2026-08-11; commits `54ec20e` F1, `0d2bc24` F2, `d20a7d8` F3+F4, `a2bf91e` F5; flow Chatwoot 60 nodos). F0 = runbook de Martin (Settings del workflow → Error Workflow → `tg-bot-error`). Pendiente Martin: re-importar + probar en vivo (ver §Verificación). Diferido a pedido de Martin: **F6 (escalación con labels)** y drop-Chatwoot.

## Context

El bot RAG lite pasa a ser el **bot principal en producción** de TG (reemplaza al faq-bot v10). Hoy la variante Chatwoot (`faq-bot-rag-lite-chatwoot.json`, 31 nodos) tiene el núcleo LLM (Agente + Verificador + Corrector + precios + memoria de decisiones) + HMAC + un filtro de entrantes básico, pero le falta el **caparazón de producción** que el v10 sí tiene: filtro de ingreso, firewall, debounce/idempotencia/ráfaga, verificación de entrega, logging operativo y error-handling global.

**Decisiones tomadas (Martin, esta sesión):**
- WhatsApp de TG es **Cloud API oficial** → a futuro se puede prescindir de Chatwoot (webhook de Meta directo a n8n + tablas propias). Es un **track aparte, NO ahora**.
- **Prioridad = producción ya** → se conserva Chatwoot (funciona, ya es el store de la conversación) y se porta el caparazón.
- **Memoria = A2** (leer el historial del canal como el v10). Arregla el bug conocido `{P1}` (el buffer de n8n guardaba el placeholder, no el precio real inyectado después) y usa a Chatwoot como fuente única de verdad.
- **Alcance = MVP-producción (F0–F4)**. Tier-2 (LLM guard) y escalación con labels quedan diferidos.

**Outcome buscado:** paridad de caparazón suficiente para desactivar el v10 y poner el RAG lite de titular sin perder protección.

## Restricción de arquitectura del builder (`scripts/build-flow.mjs`)

- El builder emite 2 flows por copia profunda + swap de extremos. El bloque `flow` (chat, 28 nodos) **NO se toca**; todo vive en el bloque `flowCw`.
- El nodo **"Cuando llega un mensaje"** conserva el nombre y sigue emitiendo `{sessionId, chatInput, _chatwoot}` para **no tocar el medio**; el debounce/ráfaga solo cambia `chatInput` al texto MERGEADO.
- **Regla de oro:** cualquier nodo del caparazón toma `accountId/conversationId` de `Decidir` (flat) o de `$('Chatwoot Webhook').body`; el ÚNICO punto de conversión `_chatwoot`(anidado)↔flat es el adaptador de entrada y `Preparar Envío` (salida).

## Fases (MVP-producción)

Marca: **[barato]** = copia nodo v10 + SQL/func existente; **[reescritura]** = adaptador/lógica de builder.

### F0 — Cimientos, sin tocar el flujo del bot **[barato]**
- Verificar deps compartidas ya existentes: enum `bot.accion` (**enumerar sus valores** — ver R8), tablas `bot.decisiones`/`bot.errores`, funciones `bot.firewall_check`/`bot.firewall_strike`, cred `KxbAlYAWQ95ZZKQ5`, `Bot Readonly DB` (vxRQvyIwYEqGpJqc), `$env.CHATWOOT_WEBHOOK_SECRET`, cred OpenRouter.
- Cablear `tg-bot-error.json` (Error Trigger → Armar Error → Log Error a `bot.errores`) como **error-workflow a nivel instancia** para `faq-bot-rag-lite-chatwoot` (settings de n8n, no cambia el JSON).

### F1 — Endurecimiento de ingreso **[barato, drop-in del v10]**
Insertar entre `Verificar HMAC` y `Cuando llega un mensaje`:
- **Filtro Ingreso** (`filter` v2.3, AND): `_hmac.ok` + `body.event=message_created` + `message_type=incoming` + `conversation.channel='Channel::Whatsapp'` + `!conversation.meta.assignee` (no pisar a un humano si tomó la conversación).
- **¿Tiene Texto?** (`if`) → out1 **Respuesta No-Texto** (enlatado audio/imagen/archivo).
- **Firewall Tier-1** (`postgres`, `select * from bot.firewall_check($sid,$content,$convId)`) + **Switch Firewall** (v3.4) → **Mensaje Firewall Refusal** / **Aviso Rate Firewall** / **Descartar Firewall (drop, NoOp)**. La lógica (regex injection + rate + strikes) vive en la función SQL.
- Todos leen `$('Chatwoot Webhook').body` → drop-in.

### F2 — Debounce / Idempotencia / Ráfaga / CAP + memoria A2 **[la capa más valiosa; reuso + reescritura]**
- **Wait 3s** → **Get Historial** (HTTP GET Chatwoot `/messages`, retry x3) → **Decidir** (Code del v10) → **Switch Ruteo** (v3.4, 5 salidas por `Decidir.action`).
- Enlatados de ruteo: **Descartar** (skip, NoOp), **Saludo Bienvenida** (primer-mensaje), **Mensaje Anti-Injection** (injection), **Mensaje Cap Email → Label Cap** (cap 24h/25).
- **Adaptador "Cuando llega un mensaje"** *(reescritura)*: pasa a colgar de `Switch Ruteo[process]`; reforma la salida de `Decidir` a `{sessionId: String(conversationId), chatInput: mergedUser, _chatwoot:{accountId,conversationId}}` + `historialTexto` (de `Decidir.conversation`, últimos 6 turnos). Conserva el nombre → el medio no cambia.
- **A2**: dropear el nodo `Memoria` (memoryBufferWindow) + su conexión `ai_memory` en `flowCw`; extender `Contexto Previo` (compartido, backward-compatible con `|| ''`) para anteponer `historialTexto` al `systemMessage`. Conserva el read-back de `bot.rag_decisiones` (complementario: memoria ESTRUCTURADA de productos ya recomendados; el canal da el texto verbatim con precios reales).
- **Nota Cloud-API (futuro):** `Get Historial` es la única dependencia dura de Chatwoot en la memoria; mantener el boundary `Decidir`/adaptador limpio para que un futuro swap a una tabla `bot.mensajes` sea contenido.

### F3 — Verificación de entrega **[barato-mixto; nació de un incidente real: un 503 logueado como éxito]**
- Reemplazar `Responder → Enviar a Chatwoot` por: **Preparar Envío** *(adaptador: `{output}` → sobre flat `{accountId, conversationId, final, accion, notas, senales}`)* → **Enviar Mensaje** (v10, lee flat) → **Chequear Envío** (entrega = `id` numérico devuelto por Chatwoot, NO el status HTTP; sin id → `accion='envio_fallido'`) → **¿Se Entregó?** → out1 **Label Envío Fallido** → (ambas) **Log Turno**.

### F4 — Logging operativo a `bot.decisiones` **[barato]**
- **Log Turno** (desde `Chequear Envío`) → `bot.decisiones` (conversation_id, mensaje_cliente, accion, nivel_resolucion=`n2_llm`, hubo_handoff, notas, final, execution_id, senales).
- `bot.rag_decisiones` se **conserva** (memoria del cerebro; el read-back depende de ella). `bot.decisiones` = log operativo unificado con el v10.
- **Antes de F4:** enumerar `bot.accion` y mapear el `accion` de éxito del RAG lite a un valor existente del enum (`Log Turno` tiene `onError:continue` → un accion inválido pierde el log EN SILENCIO, ver R8).

## Diferido (post-MVP)
- **F5 Firewall Tier-2** (LLM guard jailbreak/topical): +1 LLM/turno; ya parcialmente cubierto por el regex de `Decidir` + el check `fuera_de_rol` del Verificador.
- **F6 Escalación con labels**: requiere inventar el trigger de handoff (el RAG lite siempre responde algo); bajo valor porque TG no mira la bandeja de Chatwoot (escalación = mail, ya en el prompt).
- **Track aparte (no ahora):** dropear Chatwoot → Cloud API oficial directo a n8n + tablas `bot.mensajes`/`bot.contactos`.

## Archivos críticos
- `scripts/build-flow.mjs` — toda la integración en el bloque `flowCw` (definir `shellNodes`/`shellConnections` declarativos para no ensuciar el swap actual).
- Nodos v10 a transcribir (en `whatsapp-automation/n8n/v10/nodes/`): `decidir.json` (eje del debounce/ráfaga/CAP; su `conversation` habilita A2), `chequear-envio.json` (define el sobre flat), `filtro-ingreso.json`, `switch-firewall.json`, `firewall-tier-1.json`, `get-historial.json`, `respuesta-no-texto.json`, los enlatados (`mensaje-firewall-refusal`, `aviso-rate-firewall`, `mensaje-anti-injection`, `mensaje-cap-email`, `saludo-bienvenida`), `label-cap`, `label-envio-fallido`, `log-turno`, `preparar-envio`, `enviar-mensaje`.
- `whatsapp-automation/n8n/flows/tg-bot-error.json` (F0, error-workflow global).

## Riesgos (los grandes)
- **R3 (transversal, el grande):** `_chatwoot`(anidado) vs `accountId/conversationId`(flat). El adaptador de entrada y `Preparar Envío` son los únicos puntos de conversión; si el sobre no expone flat, `Enviar Mensaje` arma URL con `undefined` y falla el envío.
- **R4 (A2):** dropear `Memoria` = borrar **nodo + conexión `ai_memory`** en `flowCw` (si no, el import de n8n rompe); confirmar que `Contexto Previo` efectivamente antepone `historialTexto`. Mantener el cap de 6 turnos de `Decidir` (evitar bloat: historial + catálogo topK + rag_decisiones).
- **R8 (F4, silencioso):** enum `bot.accion` → `Log Turno` con `onError:continue` pierde el log si el accion no está en el enum (bug H2 documentado en `router-fail-tier-2`). Enumerar y mapear antes.
- **R11 (cutover):** mismo `path='chatwoot'` → v10 y RAG lite NO conviven activos; poner el RAG lite de titular = **desactivar el v10** = apagar su caparazón de golpe → hay que llegar al MVP F0–F4 ANTES del flip.
- **R5 (F2):** el webhook debe responder inmediato (`responseMode` default `onReceived`) o el `Wait 3s` cuelga la entrega. Confirmar en UI.

## Verificación (end-to-end)
- `pnpm flow:build` (emite ambos; el chat queda byte-idéntico) + `pnpm test` (29 verdes; no se toca precios).
- Importar `flowCw` en n8n; con el **v10 desactivado**, probar en WhatsApp real:
  - Ráfaga de 3 mensajes seguidos → UNA sola respuesta con la ráfaga junta (debounce).
  - Mensaje repetido / doble disparo → no re-responde (idempotencia).
  - Audio o imagen → enlatado "no proceso archivos ni voz".
  - Conversación asignada a un humano → el bot no interviene.
  - Multi-turno con precio → el 2º turno recuerda el precio REAL, no `{P1}` (valida A2).
  - Envío OK → fila en `bot.decisiones`; error de envío → label `envio-fallido` + fila con `accion=envio_fallido`.
- Claude NO ve las ejecuciones: Martin pasa el dato de cada prueba.
