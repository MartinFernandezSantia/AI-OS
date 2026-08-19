# Bot RAG-lite: menos preguntón + monitoreo de salud de cuenta WhatsApp

## Contexto

Dos pedidos de Martin sobre el bot de WhatsApp RAG-lite de Terminal Gráfica
(`project-context/TerminalGrafica/whatsapp-rag-lite/`):

1. **Menos preguntón** — el bot cierra casi todos los mensajes con una coletilla
   tipo "¿necesitás algo más?" / "¿te sirve?". Molesta y suena a bot. Sacar ese
   remate por defecto.
2. **Monitoreo de límites/salud de WhatsApp** + acción al cruzar umbral.

### Hallazgos que redefinieron el alcance del pedido 2

**a) El messaging-limit de Meta no aplica a este bot.** Los "messaging limits"
por tier (250 / 2.000 / 10.000 / … destinatarios únicos por 24h) **solo miden
conversaciones INICIADAS POR EL NEGOCIO** (templates fuera de la ventana de
servicio de 24h). Este bot es **100% reactivo** (solo responde a quien escribe,
dentro de la ventana de 24h) → esas conversaciones de servicio no consumen el
messaging limit. Trackear el tier no cubre riesgo real. → El riesgo real es la
**salud de la cuenta**: si Meta baja el *quality rating* (verde→amarillo→rojo) o
restringe/banea el número, el bot muere. Eso es lo que hay que vigilar.

**b) La señal autoritativa de Meta viaja por webhook, NO por Chatwoot.**
Investigación del código fuente de Chatwoot v4.16.2-ce (agente): Chatwoot se
suscribe solo a `messages`/`smb_message_echoes`, **no** a `account_update` ni
`phone_number_quality_update`; y si esos payloads llegaran, los descarta sin
procesar (el branch de `incoming_message_base_service.rb` solo maneja `statuses`
y `messages`). Su webhook saliente hacia n8n no tiene ningún evento de salud de
cuenta. → Chatwoot no sirve como fuente.

**c) Meta permite webhooks múltiples.** El override de callback por WABA aplica
solo al campo `messages` (el que usa Chatwoot). Los campos de salud
(`account_update`, `phone_number_quality_update`, `business_capability_update`)
usan el **callback global de la app**, que está libre. → Se puede suscribir la
señal de salud directo a n8n **sin tocar** el webhook de mensajes de Chatwoot.

### Decisiones de Martin

- Capturar la salud por **webhook push a n8n** (autoritativo de Meta,
  instantáneo). Es la opción correcta: un baneo o un quality→RED no espera al
  próximo poll.
- Señales a vigilar:
  - **(1) Salud de cuenta de Meta** (quality rating, restricciones, tier) — fuente
    autoritativa vía webhook.
  - **(2) Rechazos / confident-wrong** desde `bot.log` — señal temprana de mala
    experiencia que además sirve para curar el bot. (Descartado el proxy frágil de
    "clientes que cortan".)
- Al cruzar umbral: el bot **sigue respondiendo** (no cortar servicio) y **alerta**.
- Canal de alerta: **workflow de n8n → Telegram** (no mail, no Chatwoot).

Fuentes Meta:
[aisensy — tiers](https://m.aisensy.com/blog/whatsapp-message-limits-guide/) ·
[unipile — qué es gratis](https://www.unipile.com/is-the-whatsapp-api-free/) ·
[8x8 — payload account_update](https://developer.8x8.com/connect/docs/whatsapp-account-update-webhook/) ·
[Meta webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/)

### Fuente de verdad del código

El flow de n8n **NO se edita a mano** en los `.json`. Se genera desde
`scripts/build-flow.mjs` con `pnpm flow:build`. El prompt del agente vive una sola
vez (const `sistema`) y se comparte entre el flow de chat interno y el de Chatwoot
vía deep-copy → un cambio cubre ambos canales.

---

## Parte 1 — Menos preguntón (prompt del agente)

Archivo único: `scripts/build-flow.mjs`, dentro de la const `sistema`. Causa raíz:
la regla actual (líneas 239-248) **permite** condicionalmente "sumar un cierre" de
una pregunta corta y da ejemplos ("¿te sirve?", "¿te paso algo más?"); además dos
lugares más lo refuerzan/modelan, contradiciéndose entre sí. Por eso el bot sigue
rematando pese a la intención del texto.

Política nueva: **por defecto el mensaje NO cierra con pregunta**; termina en la
información. La única pregunta al final es la de un eje que hace avanzar el pedido
(que ya es etapa `falta_info`, con su propia regla de cerrar en la pregunta). Se
mantiene cordial (cordial ≠ rematar con pregunta), no se despide ni asume que
terminó; intactas la derivación a mail (solo si el cliente lo pide) y la excepción
de repregunta.

Cinco ediciones de texto sobre la const `sistema` (old→new ya redactadas, listas
para `Edit`):

- **239-248** (bloque principal) — reemplazar el permiso "si sumás un cierre, una
  pregunta corta" por "POR DEFECTO NO CIERRES CON UNA PREGUNTA…". *Obligatorio.*
- **209** ("COMPRIMÍ AGRESIVO") — sacar "y si hace falta un cierre, UNA sola
  pregunta corta". *Obligatorio* (reinstalaba el permiso).
- **211-215** (el ejemplo) — el "después" hoy termina en "¿Te sirve?"; quitarlo
  para que el ejemplo enseñe la regla en vez de contradecirla. *Obligatorio*
  (el modelo copia el ejemplo).
- **216-217** (párrafos) — cambiar el ejemplo "entre lo que informás y la pregunta
  de cierre" por casos válidos (intro+lista). *Recomendado.*
- **99-101** ("Preguntar vs proponer") — remitir a la regla global; sacar el matiz
  de "segunda pregunta". *Opcional.*

Cierre: `pnpm flow:build` para regenerar los dos JSON.

---

## Parte 2 — Monitoreo de salud de cuenta + alerta a Telegram

Dos fuentes de señal → un mismo canal de alerta (workflow n8n → Telegram). El bot
**nunca deja de responder**; el monitoreo es 100% observabilidad + aviso.

### 2a. Señal autoritativa de Meta (webhook push a n8n)

**Nuevo workflow de n8n "health-webhook"**, independiente del flow del bot:

1. **Webhook node** (path propio, ej. `/meta-health`) con su **verify token**
   (GET de verificación de Meta) y validación de firma (`X-Hub-Signature-256` con
   el app secret). Endpoint público (mismo patrón de ingreso que el webhook de
   Chatwoot; ver `PROD-SETUP.md` para la excepción WAF de Cloudflare).
2. **Parsear el payload** de Meta. Campos que nos importan:
   - `phone_number_quality_update` → `event` = GREEN / YELLOW / RED (o
     FLAGGED/UNFLAGGED), y `current_limit`.
   - `account_update` → `event` ∈ ACCOUNT_RESTRICTION / ACCOUNT_VIOLATION /
     BUSINESS_VERIFICATION_STATUS_UPDATE, con `restriction_info[]`.
   - `business_capability_update` → cambios de tier / max_phone_numbers.
3. **Evaluar severidad** (config en `$env`): p. ej. YELLOW = warn, RED/restriction/
   violation = crítico.
4. **Insert en `bot.alert`** (dedupe, ver 2c) + **nodo Telegram** con el detalle.

**Setup en la app de Meta (runbook, no código):** suscribir los campos
`account_update`, `phone_number_quality_update` (y opcional
`business_capability_update`) al **callback global de la app**, apuntando al
Webhook node de n8n. NO tocar la suscripción de `messages` (esa sigue yendo a
Chatwoot). Documentar en `META-WHATSAPP-SETUP.md` como paso nuevo.

*Fallback si el setup en Meta se traba:* nodo Schedule que hace
`GET /{phone-number-id}?fields=quality_rating,messaging_limit_tier` con el token
que ya existe (`whatsapp_business_management`). Mismo destino (bot.alert +
Telegram). Se documenta como plan B, no se construye salvo necesidad.

### 2b. Señal de rechazos / confident-wrong (desde `bot.log`)

Workflow de n8n en **schedule** (ej. cada 1-6h) que consulta `bot.log` y alerta si
los rechazos en la ventana cruzan un umbral. `bot.log` ya tiene `session_id`,
`created_at`, `action` (enum `bot.accion`), `signals jsonb`, indexado por
`(session_id, created_at)`.

- **Verificar en implementación** si ya existe una señal de rechazo capturada en
  `signals`/`action`. Si no, agregarla en el nodo `Decidir`/`Log` del flow del bot
  (cambio mínimo) y, si hace falta un valor de enum nuevo, usar
  `alter type bot.accion add value …` (gotcha `PROD-SETUP.md:40`: re-correr el
  `.sql` no basta).
- Umbral por `$env` (ej. `ALERTA_RECHAZOS_24H`), default conservador.

Puede vivir en el mismo workflow "health-webhook" (rama Schedule aparte) o en uno
propio "health-poll" — **decidir en diseño**; preferencia por un solo builder que
emita los dos, para compartir la lógica de `bot.alert` + Telegram.

### 2c. Nueva tabla `bot.alert` (en `db/`)

Registro histórico de alertas (tipo de señal, severidad, payload/valor, umbral,
`created_at`, `notified`). Sirve de **dedupe** (no re-alertar la misma señal dentro
de M horas) y de auditoría de tendencia. Nuevo archivo SQL en `db/`, patrón de los
existentes: idempotente, schema `bot`, inglés en tablas/columnas. Definir rol de
escritura (el que use n8n para el monitoreo).

### 2d. Builder del/los workflow(s) de monitoreo (n8n)

Builder propio `scripts/build-monitor-flow.mjs`, espejando el patrón de
`build-flow.mjs` (constantes de nodos + emisión de JSON). NO acoplar con el flow
del bot. Nodo Telegram nativo (`n8n-nodes-base.telegram`, sendMessage); requiere
**bot de Telegram** (token @BotFather) + **chat_id** de Martin, cargados como
credencial/`$env` en la UI de n8n de prod (no en git).

### 2e. Auditoría / queries de apoyo

Sumar a `db/auditoria-rag-lite.sql` la query de rechazos, para correrla a mano y
que el workflow reuse la misma lógica.

---

## Archivos afectados

- `scripts/build-flow.mjs` — Parte 1 (prompt) + posible mini-cambio de logging de
  rechazo (Parte 2b).
- `scripts/build-monitor-flow.mjs` **(nuevo)** — workflow(s) de monitoreo→Telegram
  (webhook de salud + schedule de rechazos).
- `db/alert.sql` **(nuevo)** — tabla `bot.alert`.
- `db/enums.sql` — solo si hace falta un valor nuevo en `bot.accion` para el rechazo.
- `db/auditoria-rag-lite.sql` — query de rechazos.
- `n8n/flows/*.json` — regenerados por los builders (no editar a mano).
- `META-WHATSAPP-SETUP.md` — paso nuevo: suscribir los campos de salud al callback
  global de la app apuntando a n8n (sin tocar `messages`).
- `PROD-SETUP.md` — nota del setup del bot de Telegram (token + chat_id) y de los
  `$env` de umbrales/severidad.

## Verificación

**Parte 1 (prompt):**
1. `pnpm flow:build` sin errores; los dos JSON se regeneran.
2. Diff de los JSON: el bloque del system prompt cambió en ambos (chat interno +
   Chatwoot) y ya no aparece "¿te sirve?" como ejemplo válido.
3. Prueba manual por el nodo Chat interno de n8n: pedir un precio → la respuesta
   **no** termina en pregunta de cierre; pedir algo con info faltante → **sí**
   cierra en la pregunta de eje (falta_info).
4. Correr el harness/tests del proyecto si existen.

**Parte 2 (monitoreo):**
1. `bot.alert` creada; `enums.sql` aplicado si se tocó (con `alter type … add value`).
2. **Webhook de salud:** simular un POST de Meta a mano (payload de
   `phone_number_quality_update` con event=RED y de `account_update` con
   ACCOUNT_RESTRICTION) al Webhook node → verificar firma OK, insert en `bot.alert`,
   dedupe (no re-alerta), y **llega el mensaje a Telegram**. Verificar el GET de
   verificación del webhook contra el verify token.
3. **Rechazos:** poblar `bot.log` con filas de rechazo que crucen el umbral; correr
   la query de `auditoria-rag-lite.sql` y confirmar detección; ejecutar el schedule
   a mano y ver la alerta en Telegram.
4. Confirmar que el flow del bot sigue respondiendo normal (no se tocó la salida) y
   que el webhook de `messages` a Chatwoot no se alteró.

## Fuera de alcance (confirmado con Martin)

- Trackear el messaging-limit/tier de Meta como cupo (no aplica a un bot reactivo).
  *El tier igual se registra si llega por `business_capability_update`, pero no se
  usa como límite a frenar.*
- Frenar la salida de mensajes al cruzar umbral (Martin eligió seguir + alertar).
- Leer la salud desde Chatwoot (confirmado inviable por código fuente).
- Alertas por mail o carga humana en Chatwoot (se usa Telegram).
- Proxy "clientes que cortan" (descartado por frágil; se queda solo rechazos).
