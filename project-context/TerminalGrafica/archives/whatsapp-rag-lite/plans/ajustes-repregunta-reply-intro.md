# Plan — 3 ajustes al bot RAG lite de Terminal Gráfica

> Regla AIOS: los planes viven en el repo. Al aprobar, **mover este archivo** a
> `project-context/TerminalGrafica/whatsapp-rag-lite/plans/ajustes-repregunta-reply-intro.md`
> y commitearlo antes de ejecutar (plan mode lo dejó en `~/.claude/plans/`).

## Context

Sobre el bot RAG lite ya rediseñado (schema greenfield aplicado esta sesión), Martin pidió tres
ajustes de comportamiento antes de poner en prod:

1. **Repregunta sin coletilla de cierre** — cuando el bot repregunta (etapa `falta_info`), no debe
   cerrar con "¿te ayudo con algo más?" / "¿otra duda?". La pregunta ES el cierre del mensaje.
2. **Ver el mensaje citado de un reply de WhatsApp** — hoy, si el cliente usa la función *responder* de
   WhatsApp citando un mensaje anterior, el bot solo ve el texto de la respuesta, no a qué mensaje se
   está respondiendo. Se pierde contexto (ej. cliente cita "el pack de 100 sale $15.000" y escribe "me
   lo hacés en kraft?"). Decisión de Martin: surface **inline** en el mensaje (aparece en el log).
3. **No re-presentarse** — si el historial muestra que el bot ya se presentó como "el asistente de
   Terminal Gráfica", no debe volver a presentarse aunque interprete el mensaje nuevo como saludo/inicio.

Todo esto es dev/descartable (sin prod aún). Fuente de verdad del workflow:
`whatsapp-rag-lite/scripts/build-flow.mjs` → `pnpm flow:build` regenera los dos flows.

## Alcance por item

- **Items 1 y 3**: edición del system prompt `sistema` (const en `build-flow.mjs`). Es **compartido por
  los dos flows** (chat interno + Chatwoot, vía deep-copy), así que un solo cambio cubre ambos canales.
- **Item 2**: cambio de lógica JS en el nodo **Decidir**, que es **Chatwoot-only** (el chat interno de
  n8n no tiene concepto de reply). Es el único nodo donde el objeto `m` completo (con
  `content_attributes`) sigue vivo antes de aplanarse a `{role, content}`.

## Cambios

### Item 1 — repregunta sin coletilla (prompt)
Archivo: `scripts/build-flow.mjs`, const `sistema`.
- En la regla de cierre de **"## Reglas siempre"** (bullet "NO CIERRES la charla vos…"): acotar el
  "ofrecé seguir ayudando" a los turnos donde **informás/recomendás**, y agregar exclusión explícita:
  si el turno es una **repregunta** (`falta_info`), terminá en la pregunta — NO agregues ninguna
  coletilla de cierre ("¿algo más?", "¿otra duda?", "¿te ayudo con otra cosa?").
- Refuerzo menor en la etapa **"3) FALTA INFO"** del "## Flujo": "cerrá en la pregunta, sin coletilla".
- Ya existe una regla parcial en "## Preguntar vs proponer" ("NO cierres con una segunda pregunta de
  relleno… terminá ahí") — se deja y se hace consistente con lo anterior.

### Item 2 — resolver el mensaje citado, inline (lógica en Decidir)
Archivo: `scripts/build-flow.mjs`, const `decidir` (jsCode del nodo "Decidir").
- Los mensajes de **Get Historial** (`allMessages`/`sorted`) traen, en cada `m`, el objeto
  `content_attributes` de Chatwoot. Para un reply, Chatwoot expone `in_reply_to` (id interno del
  mensaje citado) y/o `in_reply_to_external_id` (source id del proveedor).
- Tras calcular `mergedUser` (y **después** de correr los checks de injection/greeting/cap sobre el
  `mergedUser` crudo), agregar un bloque best-effort:
  - Recorrer los mensajes de la ráfaga (`isIn` + `hasContent` desde la última salida) buscando el que
    tenga `content_attributes.in_reply_to` / `in_reply_to_external_id`.
  - Resolver el citado en `allMessages` por `x.id === in_reply_to` **o** `x.source_id === in_reply_to_external_id`.
  - Si se resuelve y tiene contenido, componer el prefijo:
    `(Responde citando ${quien}: "${textoCitado}")` donde `quien` = `"tu mensaje"` si el citado es
    saliente (`isOut`) o `"un mensaje suyo"` si es entrante.
  - `finalUser = prefijo + "\n" + mergedUser` (si no se resolvió nada → `finalUser = mergedUser`, sin
    tocar nada).
- Usar `finalUser` **solo** en el push a `conversation` (turno actual) y en `userMessage:` del return.
  Los checks previos siguen sobre `mergedUser` crudo (no anotar antes de clasificar).
- Todo con optional chaining y sin romper si los campos no vienen: si Chatwoot no manda esos campos,
  el bloque es un no-op (cero riesgo).
- **No** toca `normalizarChatwoot` ni `Contexto Previo`: al ir inline en `userMessage`, fluye solo por
  `chatInput` → agente + `customer_message` del log (lo que Martin eligió).

### Item 3 — no re-presentarse (prompt)
Archivo: `scripts/build-flow.mjs`, const `sistema`.
- En la etapa **"1) SALUDO / INICIO"** y/o el bloque **"## Quién sos (identidad)"**: agregar que si en
  el historial/decisiones previas **ya te presentaste** como el asistente de Terminal Gráfica, NO te
  vuelvas a presentar — saludá corto y ayudá directamente. La presentación de una línea es solo para
  el **primer** contacto sin historial.
- El agente ya tiene visibilidad del historial en ambos canales: memoria buffer (chat interno) y
  `historialTexto` inyectado por Contexto Previo (Chatwoot). No hace falta plumbing nuevo.
- Nota: el enlatado "Saludo Bienvenida" (rama primer-mensaje) no se auto-presenta y solo dispara sin
  salidas previas, así que no hay doble-presentación por ese lado.

## Archivos tocados
- `scripts/build-flow.mjs` — const `sistema` (items 1 y 3) + const `decidir` (item 2). Único archivo
  fuente. Después: `pnpm flow:build` regenera `n8n/flows/faq-bot-rag-lite.json` (30 nodos) y
  `n8n/flows/faq-bot-rag-lite-chatwoot.json` (62 nodos) — se commitean regenerados.

## Verificación
- `pnpm flow:build` corre sin error y mantiene los conteos de nodos (30 / 62). `git status` limpio tras
  regenerar (los JSON quedan en sync con el builder).
- `pnpm test` + `pnpm exec tsc --noEmit` verdes (no debería cambiar: no se toca `lib/`).
- **Item 2 — confirmar shape del payload (única incógnita real)**: el repo no tiene fixture de Chatwoot,
  así que los nombres de campo (`content_attributes.in_reply_to` / `in_reply_to_external_id`,
  `source_id`) están tomados del modelo estándar de Chatwoot pero **no verificados contra la instancia
  de Martin**. Como el bloque es best-effort (no-op si no matchea), no hay riesgo, pero para que
  FUNCIONE hay que: mandar un reply real citando un mensaje por WhatsApp y mirar en el log
  (`customer_message` de `bot.log`) si aparece el prefijo `(Responde citando…)`. Si no aparece,
  inspeccionar el `content_attributes` real del mensaje en Chatwoot y ajustar los nombres de campo.
- **Items 1 y 3**: sin harness de prompt en este sub-proyecto (los tests son de lógica pura). Se
  prueban a mano por el chat interno del Chat Trigger de n8n y luego por WhatsApp real:
  - Item 1: forzar una repregunta (pedido amplio, ej. "quiero tarjetas") → la respuesta termina en la
    pregunta de ejes, sin coletilla de cierre.
  - Item 3: segundo turno de saludo dentro de una conversación con historial → el bot saluda/ayuda sin
    repetir "soy el asistente de Terminal Gráfica".

## Pasos que aplica Martin (tras aprobar y ejecutar)
- Re-importar los 2 flows regenerados en n8n y re-cablear los 2 sub-nodos Embeddings (igual que el
  handoff del rediseño; no cambia por estos ajustes).
- Probar el reply citado por WhatsApp real y confirmar el shape del `content_attributes` (ver arriba).
