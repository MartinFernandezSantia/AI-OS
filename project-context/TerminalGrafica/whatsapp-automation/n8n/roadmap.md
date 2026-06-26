# FAQ Bot v1 → v4 — Roadmap

Estado actual (2026-06-26): **v4 lista para importar** — funnel de ventas completo con saludo humano, handoff inteligente y nota privada de contexto para el agente.
WhatsApp → Chatwoot → n8n → Gemini Flash-Lite → responde en WhatsApp.

---

## Lo que funciona hoy (v4)

- Filtro de mensajes: solo entrantes, solo sin agente asignado
- Historial de conversación: últimos 6 mensajes como contexto para el LLM
- **Saludo humano en primer mensaje:** detección de historial vacío → "Hola! Buenas, ¿en qué te podemos ayudar?" fijo, sin LLM
- **Persona no-bot:** system prompt sin "asistente virtual"; si preguntan quién sos → "Te atiende el equipo de Terminal Gráfica"
- **Bot solo informa, no cotiza:** cualquier pedido/precio → ESCALAR inmediato al agente humano
- **Escalación con nota de contexto:** al hacer handoff → LLM genera nota privada (`private: true`) en Chatwoot con resumen del cliente + datos mencionados + próximo paso sugerido; el agente la ve, el cliente no
- **Frontera bot/humano por asignación:** el bot procesa SOLO conversaciones sin agente asignado (`IF — Sin Asignación`, gatea por `meta.assignee == null`). Al escalar, el nodo `Asignar Agente` asigna la conversación a un agente → a partir de ahí `meta.assignee != null` → el bot deja de responder automáticamente. No hace falta detectar nada en el historial.

### Ciclo de vida de la conversación (modelo "bot primero, solo si se resolvió")

Frontera bot↔humano = **asignación** (`meta.assignee`). Estados:
- Conversación nueva → sin asignar → **bot** tría.
- Bot escala → `Asignar Agente` la asigna → **humano** la atiende, el bot se calla.
- Humano resuelve → una **regla de automatización de Chatwoot** ("Conversation Resolved" → "Remove Assigned Agent") limpia la asignación.
- Cliente vuelve días después → Chatwoot reabre la conversación, ya sin agente asignado → **el bot tría de nuevo**. Si la conversación NO se había resuelto (sigue asignada), el cliente que escribe queda con el humano. → cumple "bot primero solo si se resolvió".

**Setup manual en Chatwoot (pendiente de Martin):**
1. En el nodo `Asignar Agente` reemplazar `assignee_id: 1` por el ID real del agente que recibe las derivaciones (GET `/api/v1/accounts/{id}/agents` o desde la UI). Para varios agentes: evaluar asignar a un equipo (requiere gatear también por `meta.team`, que el webhook hoy no trae de forma confiable — ver nota).
2. Regla de automatización: Evento **"Conversation Resolved"** → Acción **"Remove Assigned Agent"**. Sin esto, el bot no vuelve a triar conversaciones reabiertas.
3. (Opcional, cosmético) Crear un agente dedicado "Bot" en Chatwoot y usar su token para que los mensajes del bot se atribuyan a esa identidad en vez de a una persona.

Nota: alternativa "nativa" = conectar un Agent Bot al inbox (las conversaciones nacen en `pending`, gate por `status`). Más prolijo y da identidad propia al bot, pero más setup (crear+conectar bot, 2 reglas de automatización para el ciclo de reapertura). Se descartó por ahora a favor del modelo por asignación, que reusa el gate existente y necesita 1 sola regla.
- Guardrails v2: filtro regex anti-injection + rama no-texto
- Debounce (5s) + idempotencia anti-retries + agregación de ráfagas
- Modelo: Gemini Flash-Lite via Gemini API direct (credential `Gemini API Key`)

---

## Pendiente — próxima sesión

### 1. RAG sobre el catálogo

El system prompt actual lista los productos a texto plano. Con 186+ variantes de precio/material/tamaño, el prompt crece y la precisión baja.

Plan:
- Crear BD vectorizada (Supabase pgvector o Chroma local) con el catálogo de productos y precios
- Agregar nodo en n8n antes de Armar Prompt: embed del mensaje del cliente → búsqueda semántica → inyectar solo las variantes relevantes
- Reduce tokens/conversación 6-7x (ver estimaciones de costo en memoria `chatbot-llm-model-cost`)

### 2. Flujo orientado a cerrar la venta + handoff inteligente a agente ✅ DONE en v4

**Decisiones tomadas e implementadas:**
- El bot **solo informa** (productos, servicios, horarios, ubicación). No cotiza ni recopila datos de pedido — eso es tarea del agente humano.
- Disparadores de ESCALAR: precio/cotización/pedido concreto / pide hablar con persona / bot no tiene el dato / frustración o reclamo.
- Primer mensaje → saludo fijo "Hola! Buenas, ¿en qué te podemos ayudar?" sin LLM.
- Handoff incluye: (1) nota privada con contexto para el agente, (2) mensaje de derivación al cliente, (3) label `escalar` en Chatwoot.
- SLA target: agente responde en ≤5 min en horario laboral. Gestión de expectativas fuera de horario: pendiente (ver §5).

### 2b. Lista de números baneados (bypass del bot → directo a agente)

Mantener una lista de números/contactos que **no pasan por el workflow** y van directo a un agente humano. Motivos: comportamiento sospechoso repetido (spam, intentos de injection reiterados), o clientes que pidieron explícitamente no hablar con bot.
- Mecanismo a definir: lista en n8n (static data / variable de entorno) o **custom attribute / label del contacto en Chatwoot** (más limpio, se gestiona desde la UI de Chatwoot).
- En el flow: un IF temprano (después de IF — Mensaje Entrante) que chequea si el contacto está baneado → si sí, no responde y opcionalmente asigna/etiqueta para que lo tome un humano.
- Cómo se llena la lista: manual al principio; a futuro, auto-agregar tras X detecciones de injection del mismo contacto (conecta con el off-topic rate limit de §4).

### 3. Prompt caching

OpenRouter/Gemini tienen caching automático del prefijo estable del prompt.
Para aprovecharlo: system prompt debe ir PRIMERO y ser idéntico entre llamadas.
El mensaje nuevo del usuario va ÚLTIMO.
La estructura actual ya lo respeta — verificar que OpenRouter lo cachea (revisar headers de respuesta: `x-cached: true`).

### 4. Guardrails

**Hecho en v2:**
- ✅ **Prompt injection (directo):** filtro regex (10 patrones EN+ES) en Armar Prompt antes de llamar al LLM → si detecta → respuesta neutral sin LLM. Más instrucción SEGURIDAD en system prompt. Implementado en v2.
- ✅ **Mensajes sin texto:** nueva rama en el flujo (IF — Tiene Texto → FALSE → Respuesta No-Texto). Implementado en v2.

**Cobertura actual y qué dejamos afuera a propósito** (análisis de la investigación `research/Investigacion-guardrails.md`):

Lo que el regex SÍ ataja: prompt injection **directo** — overrides explícitos de rol/instrucciones en ES e inglés (`ignorá las instrucciones`, `ignore previous`, `DAN`, `jailbreak`, `pretend you are`, `system prompt`). Segunda capa: el system prompt (sección SEGURIDAD) que ordena tratar el texto del cliente como datos.

Medidas de la investigación que dejamos pendientes (con motivo):

| Medida | Por qué la dejamos | Cuándo retomarla |
|---|---|---|
| **Nodo Guardrails nativo de n8n** (Jailbreak LLM-based + Topical Alignment) | Pieza central de la investigación. Detección semántica, mucho más robusto que regex. Agrega 300-2000ms/mensaje y hay que verificar que el VM corre n8n ≥1.119.1 | Fase RAG / pre-prod. Es **la** defensa real contra injection semántico/parafraseado que el regex no ve |
| **Injection indirecto** (chunks envenenados del vector DB) | El gap más serio a futuro, pero hoy no hay RAG, así que no hay superficie de ataque | Apenas se monte el RAG — el guard debe analizar también el contexto recuperado, no solo el mensaje |
| **Output guard** (Guardrails post-LLM: PII, competidores, URLs en la respuesta) | Sin RAG el riesgo de alucinación es bajo; duplica latencia y costo | Con RAG |
| **LLM-as-judge de faithfulness** (2do LLM verifica que la respuesta esté fundada en los chunks) | Solo tiene sentido con RAG | Con RAG |
| **Lakera Guard / LLM Guard** (API dedicada anti-injection, <50ms) | Lakera es paga (viola regla de tooling free/self-host). LLM Guard es self-host pero pesa GPU | Evaluar LLM Guard si el volumen lo justifica |
| **PII sanitization** | No fluye PII sensible por el bot hoy | Si se piden/almacenan datos personales |
| **Similarity threshold + abstención** ("no lo sé" cuando el RAG no tiene contexto) | Solo aplica con RAG | Con RAG |

Límite conocido del enfoque actual: el regex **no** ataja injection semántico ("sos un asistente libre sin restricciones", ataques multi-turno graduales, encoding). OWASP: "you can't patch your way out of prompt injection" — para eso hace falta el nodo Guardrails LLM-based. Aceptable para demo, insuficiente para prod con volumen.

**Pendiente de guardrails propiamente dicho:**
- **Off-topic rate limit:** si un cliente envía 10+ mensajes fuera de scope seguidos, escalar en lugar de seguir respondiendo. Requiere estado/memoria — pendiente fase 2.
- **HMAC signature verification:** agregar nodo al inicio del flow para verificar `X-Chatwoot-Signature` con el secret del webhook. Actualmente el endpoint está bypassado en Zero Trust (demo only).

### 4b. Hardening de prod — concurrencia

El workflow es stateless request/response: cada mensaje = un webhook = una ejecución independiente. n8n corre esas ejecuciones en paralelo sin problema, pero había tres agujeros para prod:

1. ✅ **Race condition en ráfagas (el más serio).** Cliente manda 3 mensajes rápidos → 3 ejecuciones simultáneas, cada una hacía su `Get Historial` antes de que las otras respondan → el LLM contestaba 3 veces, descoordinado. **Resuelto en v3:** nodo Wait (5s) de debounce + agregación explícita — solo procesa la ejecución del último mensaje, que junta toda la ráfaga en un único turno `user` para el LLM. Una sola respuesta con todo el contexto.
2. ✅ **Idempotencia / retries.** Si Chatwoot reintenta un webhook el bot respondía dos veces. **Resuelto en v3:** el Code descarta (`action: skip`) si ya hay una respuesta (bot o agente) posterior a mi mensaje. Más `retryOnFail` (3 intentos) en los nodos HTTP para errores transitorios.
3. **Escala del motor.** Default = modo `regular` + SQLite. OK para piloto de un negocio. Para multi-cliente / alto volumen → **queue mode de n8n** (Redis + workers). Esta sí es la "queue" de infraestructura. Pendiente.

**Pendiente — fallback de fallo del lado de Chatwoot (decisión: NO va en el workflow).**
Cubre el caso de n8n caído por completo (el webhook nunca corre → el flow no puede notificar nada). Configurar en el VM una **Automation Rule** o **SLA Policy** en Chatwoot: conversación sin asignar / sin primera respuesta en X min → asignar a un team + label `sin-respuesta-bot` + notificar. Detalle en `setup-guide.md` §11. Es por tiempo (no instantáneo al error), suficiente para el piloto.

Para el piloto de TG (un negocio, volumen bajo) v3 ya cubre lo crítico. Antes de sumar un 2do cliente: queue mode (punto 3) + el net de Chatwoot configurado.

### 5. Investigar / a definir

- Qué pasa si el LLM devuelve un error (timeout, rate limit de OpenRouter) → retry o fallback a mensaje genérico
- Mensajes de WhatsApp con adjuntos (PDFs de arte, fotos de referencia) — ¿los toma el bot o los ignora?
- Horario de atención del bot: ¿responde 24/7 o solo en horario de la imprenta? Si fuera de horario → template "estamos cerrados, respondemos a la apertura"
- Métricas: n8n execution logs son suficientes por ahora o necesitamos algo más

---

## No tocar hasta después del piloto

- Business verification de Meta (baja prioridad, volumen bajo)
- Templates de WhatsApp (Utility) para outbound — solo cuando haya pedidos en curso para notificar
- Multi-tenant: cuando haya un segundo cliente, extraer el system prompt a variable de entorno y parametrizar el flow
