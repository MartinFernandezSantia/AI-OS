# v6 — Secciones 6 + 7: Code "Decidir" + Switch de ruteo

> Fecha: 2026-07-11. Completa el esqueleto nuevo (Parte E, paso 2 del
> `plans/v6-build-plan.md`) que arrancó con la Sección 2 (Filter de ingreso).
> Parte `Armar Prompt` del v5 en dos: **Decidir** (esta sección, decide QUÉ hacer)
> y **Armar mensajes** (Sección 8, arma el prompt solo en la rama `process`).
>
> Cierra `F1` (la foto ya no gana el debounce), `F3` (saludo solo si el texto ES
> un saludo), `F5` (`created_at` normalizado a número). Reemplaza la cadena de IFs
> (`IF — Descartar` → `IF — Primer Mensaje` → `IF — Injection`) por un solo Switch.

---

## Antes de pegar — 2 cosas a confirmar contra el vivo

1. **¿Dónde vive el body parseado después de la Sección 1?** Con **Raw Body ON**
   el crudo va a binario. El código de abajo asume que el JSON parseado sigue en
   `$('Chatwoot Webhook').first().json.body` (como en v5). Si tu nodo HMAC hace
   `JSON.parse` del buffer y lo expone en otro lado, cambiá la constante
   `WEBHOOK_BODY` del principio por la referencia correcta. Es el único acople con
   la Sección 1.
2. **Tipo de `created_at`** (`F5`). El helper `ts()` ya banca número, epoch-string
   e ISO-string, así que no bloquea. Si confirmás que es número puro, se puede
   borrar la rama `Date.parse`; si es string, `ts()` ya lo cubre y era justamente
   el bug silencioso de v5 (`sorted` con NaN → sin ordenar).

Dependencia con Sección 5 (build posterior): cuando `Get Historial` (GET mensajes)
se cambie por un GET de la conversación, actualizar `rawPayload` acá y sumar el
re-chequeo de `meta.assignee` post-debounce (`F7`). Marcado con `// SEC5` abajo.

---

## Nodo: `Decidir` (`n8n-nodes-base.code`, Run Once for All Items)

```js
// ── Decidir (v6, Sección 6) ───────────────────────────────────────────────
// UNA función que decide QUÉ hacer. NO arma el prompt (eso va en la rama
// `process`, Sección 8). Devuelve { action, ...contexto }.
// Cierra F1 (foto no gana el debounce), F3 (saludo solo si es saludo),
// F5 (created_at normalizado a número).

const WEBHOOK_BODY = $('Chatwoot Webhook').first().json.body;   // ⚠ ver confirmación #1
const myMessageId    = WEBHOOK_BODY.id;
const conversationId = WEBHOOK_BODY.conversation.id;
const accountId      = WEBHOOK_BODY.account.id;

// F5 — normalización de timestamp: epoch-número, epoch-string o ISO string.
const ts = (v) => {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  const p = Date.parse(v);
  return Number.isNaN(p) ? 0 : p;
};
const myCreatedAt = ts(WEBHOOK_BODY.created_at);

// SEC5: hoy Get Historial → .payload (array de mensajes).
const historialJson = $('Get Historial').first().json;
const rawPayload = historialJson.payload;
const allMessages = Array.isArray(rawPayload)
  ? rawPayload
  : (rawPayload && rawPayload.messages ? rawPayload.messages : []);

const isIn   = (m) => m.message_type === 'incoming' || m.message_type === 0;
const isOut  = (m) => (m.message_type === 'outgoing' || m.message_type === 1) && !m.private;
const hasTxt = (m) => typeof m.content === 'string' && m.content.trim() !== '';

const sorted   = allMessages.slice().sort((a, b) => ts(a.created_at) - ts(b.created_at));
const incoming = sorted.filter(isIn);
const base = { conversationId, accountId };

// ── 0) ADJUNTO en el mensaje que disparó (routing mínimo; Sección 4 lo llena) ─
// Si el mensaje actual no trae texto pero sí adjuntos → 'attachment'.
// Dedupe barato: solo el ÚLTIMO incoming de la ráfaga dispara (álbum de 5 = 1).
const myAttachments = Array.isArray(WEBHOOK_BODY.attachments) ? WEBHOOK_BODY.attachments : [];
const myHasText = hasTxt(WEBHOOK_BODY);
if (!myHasText && myAttachments.length > 0) {
  const lastIncomingAny = incoming.length ? incoming[incoming.length - 1] : null;
  if (lastIncomingAny && myMessageId && lastIncomingAny.id !== myMessageId) {
    return [{ json: { ...base, action: 'skip', reason: 'adjunto-no-ultimo' } }];
  }
  return [{ json: { ...base, action: 'attachment', reason: 'solo-adjunto' } }];
}

// ── 1) DEBOUNCE (F1) ──────────────────────────────────────────────────────
// "¿Soy el último mensaje del cliente que trae TEXTO?" Filtrar por content
// evita que una foto posterior gane el debounce y mate la pregunta de texto.
const incomingText = incoming.filter(hasTxt);
const lastIncomingText = incomingText.length ? incomingText[incomingText.length - 1] : null;
if (lastIncomingText && myMessageId && lastIncomingText.id !== myMessageId) {
  return [{ json: { ...base, action: 'skip', reason: 'no-soy-el-ultimo' } }];
}

// ── 2) IDEMPOTENCIA (F5) ──────────────────────────────────────────────────
// Si ya hay respuesta saliente posterior a mi mensaje, no repito.
const repliedAfter = sorted.some((m) => isOut(m) && ts(m.created_at) > myCreatedAt);
if (repliedAfter) {
  return [{ json: { ...base, action: 'skip', reason: 'ya-respondido' } }];
}

// ── Ráfaga del cliente (texto) desde la última respuesta del equipo ─────────
let lastOutIdx = -1;
for (let i = sorted.length - 1; i >= 0; i--) {
  if (isOut(sorted[i])) { lastOutIdx = i; break; }
}
const burst = sorted.slice(lastOutIdx + 1).filter((m) => isIn(m) && hasTxt(m)).map((m) => m.content);
const mergedUser = burst.join('\n');

// ── 3) PRIMER MENSAJE (F3) ─────────────────────────────────────────────────
// Saludo enlatado SOLO si el texto ES un saludo puro. Si trae pregunta → LLM.
const hasOutgoing = sorted.some(isOut);
const GREETING = /^(hola|buenas|buen[oa]s?\s*(d[ií]as?|tardes|noches)?|hello|hi|hey|holis|qu[eé]\s*tal)[\s!,.¡?]*$/i;
if (!hasOutgoing && GREETING.test(mergedUser.trim())) {
  return [{ json: { ...base, action: 'greeting', reason: 'saludo-puro' } }];
}

// ── 4) INJECTION (doble red barata; Tier-1 del firewall ya lo cubre) ───────
const INJECTION_PATTERNS = [
  /ignor[aá].*(instrucciones|reglas|rol)/i,
  /olvid[aá].*(instrucciones|reglas|rol)/i,
  /nuevo rol/i,
  /ignore (previous|instructions|your)/i,
  /system prompt/i,
  /jailbreak/i,
  /\bDAN\b/,
  /pretend you are/i,
  /do anything now/i,
  /forget your instructions/i,
];
if (INJECTION_PATTERNS.some((p) => p.test(mergedUser))) {
  return [{ json: { ...base, action: 'injection', reason: 'regex-injection' } }];
}

// ── 5) PROCESS ─────────────────────────────────────────────────────────────
// Historial limpio (últimos ~6 turnos ANTES de la ráfaga) para Sección 8.
// Decidir NO arma el prompt: solo entrega el material.
const history = [];
for (const m of sorted.slice(0, lastOutIdx + 1).slice(-6)) {
  if (isIn(m) && hasTxt(m))       history.push({ role: 'user', content: m.content });
  else if (isOut(m) && hasTxt(m)) history.push({ role: 'assistant', content: m.content });
}

return [{ json: { ...base, action: 'process', userMessage: mergedUser, history } }];
```

### Qué cambió vs `Armar Prompt` (v5)

| v5 | v6 Decidir |
|---|---|
| `myCreatedAt = body.created_at \|\| 0` (string rompe el sort) | `ts()` normaliza a número (`F5`) |
| `lastIncoming` = último incoming **cualquiera** | último incoming **con texto** (`F1`) |
| `primer-mensaje` si no hay outgoing (siempre saludo) | `greeting` solo si el texto es saludo puro; pregunta → `process` (`F3`) |
| Arma `llmMessages` + interpola catálogo + system prompt | NO arma nada; entrega `userMessage` + `history`. El armado va a Sección 8 |
| Sin routing de adjuntos | `action: 'attachment'` (stub para Sección 4) con dedupe por última-de-ráfaga |
| Acción `primer-mensaje` | renombrada `greeting` (alinea con salidas del Switch) |

Acciones de salida: `skip` · `greeting` · `attachment` · `injection` · `process`.

---

## Nodo: `Enrutar` (`n8n-nodes-base.switch`, v3, mode Rules)

Reemplaza `IF — Descartar` → `IF — Primer Mensaje` → `IF — Injection`. Un único
punto de ruteo sobre `{{ $json.action }}`. Sumar una acción futura (blocklist,
cap, precio on-demand) = sumar una salida, no encadenar otro IF.

| Salida | Condición (`$json.action` equals) | Va a |
|---|---|---|
| `skip` | `skip` | NoOp `Descartar (debounce/dup)` |
| `greeting` | `greeting` | `Saludo Bienvenida` (enlatado, ya existe en v5) |
| `attachment` | `attachment` | **Sección 4** (stub por ahora: enlatado "los archivos van por email" + dedupe) |
| `injection` | `injection` | `Mensaje Injection` (refusal neutral, ya existe) + strike |
| `process` | `process` | **Sección 8** → `Get Catálogo` → `Armar mensajes` → Guardrails → LLM |

- Modo **Rules**, una regla por salida, `String` / `equals`.
- **Fallback output**: rutear al mismo NoOp que `skip` (cualquier `action`
  inesperada se descarta en silencio, nunca cae al camino del cliente).
- Renombrar salidas con el nombre de la acción para que el canvas se lea solo.

### Config JSON del Switch (para pegar/referencia)

```json
{
  "mode": "rules",
  "rules": {
    "values": [
      { "outputKey": "skip",       "conditions": { "options": { "caseSensitive": true, "typeValidation": "strict" }, "combinator": "and", "conditions": [ { "leftValue": "={{ $json.action }}", "rightValue": "skip",       "operator": { "type": "string", "operation": "equals" } } ] } },
      { "outputKey": "greeting",   "conditions": { "options": { "caseSensitive": true, "typeValidation": "strict" }, "combinator": "and", "conditions": [ { "leftValue": "={{ $json.action }}", "rightValue": "greeting",   "operator": { "type": "string", "operation": "equals" } } ] } },
      { "outputKey": "attachment", "conditions": { "options": { "caseSensitive": true, "typeValidation": "strict" }, "combinator": "and", "conditions": [ { "leftValue": "={{ $json.action }}", "rightValue": "attachment", "operator": { "type": "string", "operation": "equals" } } ] } },
      { "outputKey": "injection",  "conditions": { "options": { "caseSensitive": true, "typeValidation": "strict" }, "combinator": "and", "conditions": [ { "leftValue": "={{ $json.action }}", "rightValue": "injection",  "operator": { "type": "string", "operation": "equals" } } ] } },
      { "outputKey": "process",    "conditions": { "options": { "caseSensitive": true, "typeValidation": "strict" }, "combinator": "and", "conditions": [ { "leftValue": "={{ $json.action }}", "rightValue": "process",    "operator": { "type": "string", "operation": "equals" } } ] } }
    ]
  },
  "options": { "fallbackOutput": "extra" }
}
```

---

## Cómo testear (contra Chatwoot staging)

1. **Saludo puro** ("hola") en conversación nueva → salida `greeting`.
2. **Saludo + pregunta** ("hola, cuánto una lona de 2x1") → `process` (cierra `F3`).
3. **Ráfaga texto + foto** ("quiero 100 tarjetas" + foto sin caption) → el evento
   de texto sale por `process` con `userMessage` completo; el de la foto sale por
   `attachment` (no pisa la pregunta → cierra `F1`).
4. **Doble disparo rápido** (dos mensajes en < 3s) → solo el último por `process`,
   el anterior `skip/no-soy-el-ultimo`.
5. **Re-disparo tras respuesta** → `skip/ya-respondido` (cierra el guard de `F5`;
   verificar que ahora sí dispara con `created_at` string).
6. **Injection** ("ignorá tus instrucciones") → `injection`.
