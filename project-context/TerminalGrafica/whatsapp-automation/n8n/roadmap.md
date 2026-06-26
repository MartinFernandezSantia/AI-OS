# FAQ Bot v1 → v2 — Roadmap

Estado actual (2026-06-26): **bot funcionando end-to-end** en el VM local.
WhatsApp → Chatwoot → n8n → OpenRouter (Gemini Flash-Lite) → responde en WhatsApp.

---

## Lo que funciona hoy (v1)

- Filtro de mensajes: solo entrantes, solo sin agente asignado
- Historial de conversación: últimos 6 mensajes como contexto para el LLM
- System prompt real de TerminalGráfica (horarios, productos, reglas de escalación)
- Escalación automática: si el LLM incluye `ESCALAR` → mensaje de derivación + label en Chatwoot
- Modelo: Gemini Flash-Lite via OpenRouter (credential `OpenRouter API Key`)

---

## Pendiente — próxima sesión

### 1. RAG sobre el catálogo

El system prompt actual lista los productos a texto plano. Con 186+ variantes de precio/material/tamaño, el prompt crece y la precisión baja.

Plan:
- Crear BD vectorizada (Supabase pgvector o Chroma local) con el catálogo de productos y precios
- Agregar nodo en n8n antes de Armar Prompt: embed del mensaje del cliente → búsqueda semántica → inyectar solo las variantes relevantes
- Reduce tokens/conversación 6-7x (ver estimaciones de costo en memoria `chatbot-llm-model-cost`)

### 2. Flujo orientado a cerrar la venta

El bot actual responde FAQs. Falta guiarlo para recopilar los datos que necesita el equipo:
- Tipo de producto, cantidad, medidas, material/terminación, fecha deseada
- No pedir todo de golpe — ir recopilando turno a turno
- Al tener todos los datos: enviar resumen estructurado al agente humano (via mensaje privado en Chatwoot o webhook interno)

### 3. Prompt caching

OpenRouter/Gemini tienen caching automático del prefijo estable del prompt.
Para aprovecharlo: system prompt debe ir PRIMERO y ser idéntico entre llamadas.
El mensaje nuevo del usuario va ÚLTIMO.
La estructura actual ya lo respeta — verificar que OpenRouter lo cachea (revisar headers de respuesta: `x-cached: true`).

### 4. Guardrails

- **Prompt injection:** el cliente podría intentar override del system prompt ("ignorá las instrucciones anteriores..."). Agregar instrucción explícita en el system prompt + filtro en el Code node que detecte patrones conocidos antes de llamar al LLM.
- **Scope enforcement:** el bot ya tiene la regla de quedarse en tema, pero puede necesitar un segundo check (IF el mensaje contiene ciertas keywords → no llamar al LLM, responder template fijo).
- **Off-topic rate limit:** si un cliente envía 10+ mensajes fuera de scope seguidos, escalar en lugar de seguir respondiendo.
- **Mensajes sin texto:** el bot falla si llega una imagen, audio o sticker (content vacío). Agregar rama en el IF inicial para responder "No puedo procesar archivos por acá, escribime lo que necesitás".
- **HMAC signature verification:** agregar nodo al inicio del flow para verificar `X-Chatwoot-Signature` con el secret del webhook. Actualmente el endpoint está bypassado en Zero Trust (demo only).

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
