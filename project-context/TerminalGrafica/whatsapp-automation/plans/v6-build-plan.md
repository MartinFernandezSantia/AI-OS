# faq-bot v6 — Plan de reconstrucción (arquitectura multi-workflow + firewall + recorrido paso a paso)

> Fecha: 2026-07-10. Extiende `../prod-readiness-review.md` (2026-07-07) y el
> análisis de lógica de flujo del 2026-07-10. Base: `n8n/flows/faq-bot-v5.json`
> (commit 61b0f88). Objetivo: llevar el bot de "mejor que el DIY promedio" a
> grado producto, reconstruyendo el flujo como un recorrido ordenado de secciones,
> con manejo de errores y firewall como workflows dedicados.
>
> **Antes de tocar nada: re-exportar el v5 vivo.** El snapshot del repo es del
> 29-jun y puede haber drift con lo que corre en el VM. Todo lo de abajo asume el
> flujo tal como está en el JSON; verificar contra el vivo primero.

---

## 0. Decisión de fondo: v6 es reestructuración, no parche

Los cambios de mayor impacto (Switch en vez de cadena de IFs, partir el Code
`Armar Prompt`, reordenar la escalación, extraer firewall/log/errores a workflows
propios, structured output en vez del token `ESCALAR`) tocan el **esqueleto** del
flujo, no hojas sueltas. Parchear v5 in-place deja un canvas que nadie puede leer
de punta a punta. v6 se arma limpio, se testea contra el Chatwoot de staging, y
recién ahí reemplaza al vivo.

Este plan **fusiona dos fuentes** en un solo recorrido:
- **Hallazgos de lógica** (análisis 2026-07-10, referidos como `F1`–`F9`).
- **Punch list P0/P1** del prod-readiness-review (referidos como `P#`).

Cada sección del recorrido (Parte D) dice qué hallazgos cierra.

---

## PARTE A — Arquitectura: 4 workflows en vez de 1

Hoy todo vive en un workflow. La productización (multi-canal IG/Messenger, 2º
cliente, testeo aislado) y la regla "los fallos no pueden matar el camino del
cliente" empujan a separar responsabilidades. Decisión:

| Workflow | Tipo | Responsabilidad | Por qué separado |
|---|---|---|---|
| **`tg-bot-main`** | Webhook | Conversación: ingreso → decisión → catálogo → LLM → responder/escalar | El corazón. La lógica de conversación queda en **un** canvas legible. |
| **`tg-bot-error`** | Error Trigger (global) | Red de seguridad: cualquier ejecución fallida → alerta Telegram (+ asignar humano si hay conversation id recuperable) | Nativo de n8n. Un solo lugar convierte "cliente fantasmeado" en "humano avisado". Cierra `P2`. |
| **`tg-firewall`** | Sub-workflow | Anti-abuso determinista: blocklist, rate cap, strikes, regex injection. Devuelve `{allow, action, reason}` | Se llama al inicio de main; reusable en IG/Messenger; testeable solo. Cierra `P7` (capa anti-abuso). |
| **`tg-log`** | Sub-workflow (fire-and-forget) | Escribir `bot.decisiones` desde cualquier rama, sin bloquear ni poder tumbar a main | DRY (se loguea desde ~6 puntos) + aislamiento: un INSERT fallido nunca corta la respuesta al cliente. Cierra `F8`. |

Más el **nodo Guardrails** (Tier-2 semántico), que va **inline** en main, no en un
sub-workflow (es un solo nodo con rama Fail; envolverlo no aporta). Ver Parte B.

**Regla anti over-engineering:** solo se extraen firewall, log y errores. La
lógica de conversación NO se fragmenta en sub-workflows — se lee de corrido en
`tg-bot-main`. Sub-workflows de más = latencia y canvas dispersos sin ganancia
a este volumen.

### Mecánica n8n de cada separación

- **Error workflow:** workflow que arranca con nodo **Error Trigger**
  (`n8n-nodes-base.errorTrigger`). Se activa en `tg-bot-main` → Settings →
  *Error Workflow* = `tg-bot-error` (y se puede poner como default global de la
  instancia). Ver la sutileza del conversation id en Parte C.
- **Firewall / log como sub-workflow:** nodo **Execute Sub-workflow**
  (`n8n-nodes-base.executeWorkflow`) en main → el sub-workflow arranca con
  **Execute Sub-workflow Trigger** (`n8n-nodes-base.executeWorkflowTrigger`).
  - Firewall: **síncrono** (main necesita el `allow/deny` de vuelta).
  - Log: **fire-and-forget** — en el nodo Execute Sub-workflow, desactivar
    "Wait for sub-workflow completion". Main sigue sin esperar; el log no puede
    introducir latencia ni error en el camino del cliente.

---

## PARTE B — El firewall (Guardrails) en detalle

"Un firewall utilizando Guardrails nodes." El firewall es toda la frontera de
seguridad; el nodo Guardrails es su núcleo semántico. Se implementa en **dos
tiers** posicionados distinto por **costo** (desde oct-2026 cada respuesta del
bot cuesta ~US$0.026; la meta es "la respuesta más barata es el silencio").

### Tier 1 — determinista, en el ingreso, gratis, cada mensaje

Sub-workflow `tg-firewall`, llamado apenas pasa el filtro de ingreso, **antes**
del debounce (no gastar ni un fetch en un usuario bloqueado):

1. **Blocklist** — label de contacto en Chatwoot o tabla `bot.blocklist`. Hit →
   `action: drop` (silencio total). Cierra la lista baneada del roadmap §2b.
2. **Rate cap** — token bucket por `wa_id` en Postgres (`bot.rate` : contador +
   ventana). Sobre el cap → un último mensaje de handoff y después silencio.
3. **Strike system** — injections repetidas / racha off-topic incrementan
   contador en `bot.decisiones`. Umbral → parar de responder + label para
   revisión. NO mandar el refusal enlatado para siempre: tras 1-2, silencio.
4. **Regex injection** — los 10 patrones EN+ES actuales, como primer filtro
   gratis. Hit → strike + refusal neutral (sin LLM).

Devuelve `{ allow: bool, action: 'drop'|'silence'|'refusal'|'pass', reason }`.

### Tier 2 — semántico, pre-LLM, una vez por turno

Nodo **Guardrails** (`n8n-nodes-langchain.guardrails`, op *Check Text for
Violations*) **inline** en main, justo antes de `Llamar LLM`, sobre el texto
**agregado** de la ráfaga (post-debounce → una llamada por turno, no por
mensaje crudo → controla costo):

- Guards activos: **Jailbreak** + **Topical Alignment** (ambos LLM-based;
  necesitan un Chat Model conectado a la entrada *Model* — usar el mismo
  OpenRouter/Gemini vía nodo chat-model). Umbral configurable 0.0–1.0.
- Topical Alignment se preset-ea con el scope del negocio ("consultas sobre
  productos/servicios/horarios/ubicación de una imprenta") → ataja el
  off-topic semántico que el regex no ve.
- **Rama Fail nativa** del nodo: violación → no se llama al LLM principal →
  refusal neutral o silencio + strike (Tier 1). Rama Pass → sigue al LLM.

**Datos verificados del nodo (2026-07-10):**
- Dos operaciones: *Check Text for Violations* (rutea violaciones a rama **Fail**)
  y *Sanitize Text* (reemplaza PII/URLs/secrets/regex por placeholders).
- LLM-based: Jailbreak, NSFW, Topical Alignment, Custom (umbral, requieren Chat
  Model). Deterministas: Keywords, PII, Secret Keys, URLs, Custom Regex.
- Custom guardrail = nombre + prompt + umbral propios.
- Node type `n8n-nodes-langchain.guardrails`, mínimo n8n **1.119.1** → verificar
  la versión del VM antes de construir.

Diferido a la fase RAG/precios (coincide con la investigación de guardrails):
**output guard** (Sanitize/PII sobre la respuesta) y **faithfulness judge**. Sin
RAG el riesgo de alucinación es bajo y duplican latencia/costo.

**Por qué dos tiers y no un sub-workflow único:** Tier 1 corre en cada mensaje
crudo (barato, sin LLM); Tier 2 cuesta una llamada LLM y solo tiene sentido una
vez por turno agregado. Meterlos juntos obligaría a pagar Guardrails-LLM en
mensajes que después el debounce descarta.

---

## PARTE C — Manejo y log de errores (dos capas)

El error workflow global **no alcanza solo**, por una limitación real: el nodo
**Error Trigger no recibe el payload original** del webhook, solo metadata de la
ejecución (`execution.id`, `execution.url`, `error`, `lastNodeExecuted`,
`workflow`). Es decir: en un crash inesperado, el handler global sabe *que* falló
y *dónde*, pero no tiene el `conversation.id` a mano para asignar la conversación.
De ahí las dos capas:

### Capa 1 — degradación in-line en los nodos de riesgo conocido

En `Get Catálogo`, `Llamar LLM` y los HTTP de escalación: `onError: continueErrorOutput`
(rama de error). La rama de error va a un sub-path compartido **"fallback"** que,
con el `conversation.id` todavía en scope:
- manda un enlatado ("te derivo con un compañero"),
- asigna humano + label,
- dispara `tg-log` con `action: error_manejado`,
- alerta Telegram.

Esto cubre los silent-death paths de `P2` (catálogo caído, LLM caído, respuesta
200 sin `choices`) sin depender del error workflow.

### Capa 2 — error workflow global (`tg-bot-error`)

Red para lo **inesperado** (n8n crashea, nodo no contemplado, expresión rota):
- Siempre: alerta Telegram con `workflow.name` + `lastNodeExecuted` + link a la
  ejecución.
- Opcional robusto: el workflow consulta la ejecución fallida vía API n8n
  (`GET /executions/{id}?includeData=true`), extrae el `conversation.id` del
  payload del webhook y asigna humano automáticamente. Más complejo; para
  go-live basta la alerta + Capa 1. Dejar la auto-asignación como P1.

### Tabla error → acción

| Punto de fallo | Detección | Acción |
|---|---|---|
| Catálogo (DB) caído | onError en `Get Catálogo` | Servir catálogo cacheado; si no hay → fallback humano |
| LLM caído / 200 sin `choices` | onError + guard de expresión en `Llamar LLM` | Enlatado + asignar humano + label + alerta |
| HTTP escalación falla | `retryOnFail` + onError | Reintento; si persiste → alerta (la asignación ya se hizo, ver §11) |
| Log falla | fire-and-forget aislado | Nada al cliente; el error workflow lo registra |
| Crash inesperado | Error Trigger global | Alerta Telegram (+ auto-asignar vía API, P1) |

El log de errores propiamente dicho: tanto Capa 1 como Capa 2 escriben a
`bot.decisiones` (o una `bot.errores` dedicada) vía `tg-log` — un solo lugar
para el registro de fallos, que alimenta el digest semanal de Hermes.

---

## PARTE D — Recorrido paso a paso (webhook → fin)

Cada sección: objetivo, estado v5, target v6, y qué cierra. Orden = flujo de
ejecución. La **Sección 1 (asegurar el webhook)** es lo primero, como pediste.

### Sección 0 — Contenedor (settings del workflow)

Antes de la lógica, el continente:
- n8n sobre **Postgres** (no SQLite), imagen **pineada** (no `:latest`),
  `N8N_CONCURRENCY_PRODUCTION_LIMIT≈10-20`, pruning de ejecuciones. (`P8`)
- Settings de `tg-bot-main`: *Error Workflow* = `tg-bot-error`.
- Variables n8n (`$vars`): `CHATWOOT_BASE_URL`, `ASSIGNEE_ID`, `ACCOUNT_ID`,
  `CHANNEL_ALLOWLIST` → matan las URLs y el `assignee_id: 1` hardcodeados en 8
  nodos HTTP. Habilita multi-tenant. (`F` nodos / `P8`)

### Sección 1 — Asegurar el webhook 🔒

- **Objetivo:** que nadie de afuera pueda forjar eventos de Chatwoot, **sin**
  sacar el webhook de internet — Chatwoot solo acepta URLs públicas, no
  conexiones internas ni hostnames de Docker (verificado en el setup real, 2026-07-10).
- **v5:** `/webhook/*` bypasseado a Everyone en Zero Trust, sin autenticación.
  Cualquiera con la URL postea mensajes en conversaciones reales.
- **v6 — recon primero, después la rama que corresponda.** Los docs actuales de
  Chatwoot indican que los webhooks **se firman** (HMAC-SHA256: headers
  `X-Chatwoot-Signature` = `sha256=HMAC(secret, "{timestamp}.{raw_body}")`,
  `X-Chatwoot-Timestamp`, más un `secret` visible en el form del webhook). Un
  issue viejo (#9354, cerrado not-planned) decía que no había firma → **depende
  de la versión de Chatwoot del VM**. Se confirma empíricamente:

  **Recon (1 min, no cambia nada):** abrir una ejecución reciente en n8n → nodo
  `Chatwoot Webhook` → mirar el objeto `headers` del output. ¿Está
  `x-chatwoot-signature`? Y en Chatwoot (Settings → Integrations → Webhooks →
  editar), ¿hay un campo `secret`?

  > **Decisión (2026-07-10):** confirmados `X-Chatwoot-Signature` + `secret` en
  > el setup real → vamos por **Rama A (HMAC)**. Header/Basic Auth del nodo
  > descartados: Chatwoot no manda un header estático controlable (solo config de
  > URL), y su header de auth (`X-Chatwoot-Signature`) rota por request → Header
  > Auth no valida valores que cambian. Path-secret descartado: es un bearer en
  > la URL → queda en logs de n8n/Cloudflare y en la config de Chatwoot; si
  > filtran, filtra el secreto. La clave del HMAC nunca viaja. Rama B queda solo
  > como fallback si el bug #13809 impide verificar con el secret visible.

  **Rama A — Verificación de firma HMAC (si Chatwoot firma). PREFERIDA.**
  1. Copiar el `secret` del webhook → guardarlo como credencial/variable en n8n.
  2. Habilitar **Raw Body** en el nodo Webhook → los bytes exactos quedan en
     `$json.rawBody` (**solo con el workflow Active y por la Production URL**; en
     Test URL puede venir parseado). El HMAC se calcula sobre esos bytes; el JSON
     re-serializado NO matchea — gotcha que rompe el 90% de las verificaciones.
     Vars en el proceso que ejecuta el Code node (ambas **bloqueadas por default**
     en n8n 2.x): `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (para `require('crypto')`)
     y `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (para leer el secret con `$env`). Con
     task runners **externos** (`N8N_RUNNERS_MODE=external`), el allow-builtin va
     como `env-override` en `/etc/n8n-task-runners.json`, no como env del
     container; el secret + el flag de env deben ser visibles para el runner.
  3. Primer nodo tras el webhook: Code/Crypto que calcula
     `sha256=HMAC-SHA256(secret, "{X-Chatwoot-Timestamp}.{raw_body}")` y lo
     compara (tiempo constante) con `X-Chatwoot-Signature`. Mismatch → 401 + cortar.
  4. Opcional anti-replay: rechazar si `X-Chatwoot-Timestamp` es viejo (> N min).
  5. El Authentication del nodo Webhook queda en **None** (la auth la hace el HMAC).

  **Rama B — Basic Auth en URL / path secreto (si la versión NO firma).**
  1. Test de userinfo: webhook temporal Auth=None que devuelva `{{ $json.headers }}`,
     registrarlo en un inbox de **test** con `https://user:pass@host/webhook/authtest`,
     dispararlo y ver si llega `authorization: basic …`. (Probable que HTTParty
     NO reenvíe el userinfo → Net::HTTP no lo hace automático.)
  2. Si llega → Webhook node Authentication = **Basic Auth** + credencial; URL en
     Chatwoot con userinfo.
  3. Si no llega → **path secreto** largo y aleatorio (`/webhook/chatwoot-<random>`)
     + chequeo del token en el primer nodo (el Auth param no valida path/query,
     así que es un check in-flow).

- **Ambas ramas — cerrar:** mantener el bypass de Zero Trust para `/webhook/*`
  (Chatwoot/Meta tienen que poder llegar; la auth ahora la hace n8n — si se borra
  el bypass, ZT redirige al login y el webhook no entra). Test end-to-end desde un
  número de **test**: request válida entra, request forjada sin firma/credencial → 401.
- **Corregir `setup-guide.md`:** afirma que la URL interna
  `http://n8n:5678/webhook/chatwoot` funciona (parser URI de Ruby acepta
  hostnames cortos). No funciona — Chatwoot no conecta a hostnames internos.
  (Supersede review §3.1, que recomendaba red interna.)
- Cierra `P1`.

### Sección 2 — Filtro de ingreso (Filter, no cadena de IFs)

- **Objetivo:** dejar pasar solo mensajes que el bot debe triar.
- **v5:** `IF — Mensaje Entrante` + `IF — Sin Asignación`, ambos sin usar la rama
  false (`F` nodos). El gate de asignación es frágil: `JSON.stringify(assignee)
  === "null"` (`F6`).
- **v6:** un solo nodo **Filter** (`n8n-nodes-base.filter`) con:
  `event == message_created` **&&** `message_type` incoming **&&** canal en
  `$vars.CHANNEL_ALLOWLIST` (no igualdad hardcodeada a `Channel::Whatsapp` →
  prepara IG/Messenger, `P21`) **&&** `!conversation.meta?.assignee` (booleano
  robusto, `F6`). No pasa el filtro → se descarta, que es la semántica de Filter.
- Cierra `F6`, parte de `P21`. `IF — Tiene Texto` NO se toca acá (tiene rama else
  real → sigue siendo IF, ver Sección 4).

### Sección 3 — Firewall Tier-1 (sub-workflow)

- **Objetivo:** frenar abuso/spam antes de gastar nada.
- **v5:** no existe.
- **v6:** Execute Sub-workflow → `tg-firewall` (Parte B, Tier 1). Retorno
  `action`: `drop` → NoOp silencioso; `silence`/`refusal` → enlatado + strike;
  `pass` → sigue. Estado en Postgres (`bot.rate`, `bot.blocklist`, strikes en
  `bot.decisiones`).
- Cierra `P7` (caps, strikes, blocklist, dedupe entra acá también).

### Sección 4 — Adjuntos / no-texto

- **Objetivo:** manejar audio/imagen/PDF sin duplicar respuestas ni tragarse
  preguntas.
- **v5:** `IF — Tiene Texto` → rama no-texto manda enlatado genérico **por cada
  adjunto** y **antes** del debounce (álbum de 5 fotos = 5 mensajes, `P2`).
  Además: adjunto **con caption** pasa como texto y el LLM nunca se entera del
  archivo (`F4`); y ráfaga "texto + foto" mata la pregunta (`F1`).
- **v6:**
  - Detectar `attachments[]` y ramificar por `file_type` (audio / image /
    document), respuestas **tipadas** (Tier 0 del review §5): audio → "escribime
    el texto"; document → "los archivos van por email a X".
  - **Una respuesta por ráfaga**, detrás del debounce (dedupe).
  - Adjunto con caption: procesar el caption **y** anunciar la política de
    archivos (email). El archivo no se ignora.
  - Política de archivos consistente con canal-email (§4/§5 del review): los
    archivos de impresión **nunca** por WhatsApp → siempre a email.
- Cierra `F1`, `F4`, `P5`. (Transcripción de audio = `P14`, primeras semanas.)

### Sección 5 — Debounce + fetch de conversación

- **Objetivo:** juntar la ráfaga y traer historial + estado de asignación.
- **v5:** `Wait` 5s → `Get Historial` (GET mensajes). Sin re-chequeo de
  asignación tras el wait (`F7`).
- **v6:**
  - `Wait` a **3s** (baja latencia, review §7).
  - Reemplazar `Get Historial` por **GET de la conversación** → trae
    `meta.assignee` **y** mensajes en una sola llamada → re-valida asignación
    post-debounce sin request extra (cierra `F7`).
  - `retryOnFail` + `onError` (ya presente en Get Historial, mantener).

### Sección 6 — Decidir (Code #1, partido de `Armar Prompt`)

- **Objetivo:** una sola función que decide QUÉ hacer, sin armar nada todavía.
- **v5:** `Armar Prompt` hace 5 trabajos (debounce, idempotencia, primer-mensaje,
  injection, armado) — imposible de testear por partes.
- **v6 — Code "Decidir"** devuelve `{ action, ... }`:
  - **Debounce** por id, pero `lastIncoming` filtra por `content` (cierra `F1`:
    la foto ya no gana el "soy el último").
  - **Idempotencia:** normalizar `created_at` a número antes de comparar
    (verificar tipo en el vivo — puede ser string y el guard nunca dispara,
    `F5`).
  - **Primer mensaje:** solo saludo enlatado si el texto **es** un saludo
    (regex hola/buenas/buen día). Si trae pregunta → va al LLM (cierra `F3`).
  - Injection regex → `action: injection` (Tier 1 ya lo cubre; acá queda como
    doble red barata).
- El **armado del prompt** se hace después, solo en la rama `process` (Sección 8).

### Sección 7 — Enrutar (Switch, no cadena de IFs)

- **Objetivo:** un solo punto de ruteo por `action`.
- **v5:** `IF — Descartar` → `IF — Primer Mensaje` → `IF — Injection` encadenados
  (`F` nodos).
- **v6:** un **Switch** (`n8n-nodes-base.switch`) sobre `$json.action` con
  salidas: `skip` / `greeting` / `attachment` / `injection` / `process`. Sumar
  una acción futura (blocklist, cap, precio on-demand) = sumar una salida, no
  encadenar otro IF.
- Cierra parte de `F` nodos.

### Sección 8 — Catálogo cacheado + armado de prompt (solo rama `process`)

- **Objetivo:** groundear el LLM sin pegarle a la DB en cada mensaje ni morir si
  la DB hipa.
- **v5:** `Get Catálogo` corre **antes** de decidir → en una ráfaga de N, N
  queries para descartar N-1 (`F` orden). SPOF sin retry/onError (`P2`).
- **v6:**
  - Mover `Get Catálogo` **dentro de la rama `process`**, después del Switch
    (cierra el desperdicio de orden).
  - **Cache** del string de catálogo (TTL 10-15 min). Piloto: Code con
    `getWorkflowStaticData('global')` + TTL, fallback a query viva. Robusto
    (recomendado): workflow programado que renderiza el catálogo a una fila
    `bot.catalogo_cache` cada 10 min; main lee la fila (lectura de una fila,
    rápida) con la query viva como fallback.
  - `onError` en la query viva → servir cache stale; si no hay cache →
    fallback humano (no morir). Cierra `P2` (catálogo) + da el prefijo estable
    que hace pegar el prompt caching del proveedor (`P19`).
  - Code "Armar mensajes": interpola `__CATALOGO__`, arma `llmMessages` (system
    primero e idéntico, últimos ~6 turnos, mensaje nuevo último).
- Cierra `F` orden, `P2` (catálogo), habilita `P19`.

### Sección 9 — Guardrails Tier-2 + LLM (structured output)

- **Objetivo:** validar semánticamente y llamar al modelo con un contrato robusto.
- **v5:** LLM directo; ruteo por token `ESCALAR` con `contains` case-sensitive
  → un `escalar` en minúscula filtra el token al cliente, o una oración legítima
  con "ESCALAR" dispara handoff falso (`P4`).
- **v6:**
  - **Guardrails node** (Parte B, Tier 2) antes del LLM. Fail → refusal/silencio
    + strike, sin llamar al modelo.
  - `Llamar LLM` con **structured output**: el modelo devuelve JSON
    `{ action: 'responder'|'escalar'|'pedir_datos', mensaje, resumen_pedido? }`
    en vez del sentinel. Rutea el Switch de salida por `action` — más sólido que
    el token y acota el tamaño de salida. Cierra `P4`.
  - **`models: [primario, fallback]`** en el body de OpenRouter (ruteo
    automático) → prepara la migración forzada de modelo antes del 2026-10-16
    (`P13`). Primario `gemini-3.1-flash-lite`, challenger `gpt-5.4-nano` (ver
    memoria de modelo/costo).
  - **Guard de expresión:** validar que existe `choices[0].message` antes de
    leerlo (un error object de OpenRouter con 200 hoy tira mid-expression, `P2`).
- Cierra `P4`, habilita `P13`; guard de `P2`.

### Sección 10 — Camino respuesta + log

- **v5:** `Enviar Respuesta` → `Log Respuesta`. Log sin `onError` (un INSERT
  fallido mata la ejecución después de que el cliente ya recibió, `F` nodos).
- **v6:** `Enviar Respuesta` (con `retryOnFail`) → `tg-log` **fire-and-forget**
  con la acción precisa (`informo_capacidad` / `producto_resuelto` /
  `fuera_de_tema` — completar taxonomía, `F8`/`P17`). El log no puede tumbar
  nada.
- Cierra `F8`, `P17` (logging completo).

### Sección 11 — Camino escalación (reordenado + email + horario)

- **Objetivo:** cerrar la ventana bot↔humano primero y no perder el lead si algo
  falla en la cadena.
- **v5:** Armar Nota → LLM Nota → Nota Privada → **Mensaje cliente** → Label →
  **Asignar Agente** → Log. Si el LLM de la nota falla, muere todo lo de abajo:
  ni aviso al cliente ni asignación ni label ni log — lead caliente perdido en
  silencio. Y `Mensaje Escalación` es el único HTTP crítico **sin** retry (`F2`).
  Mientras corre la cadena (2 LLM + 3 HTTP) la conversación sigue sin asignar →
  si el cliente escribe, arranca otra ejecución completa (`F2`).
- **v6 — orden por criticidad:**
  1. **Asignar Agente + Label** primero → cierra la ventana de doble-ejecución.
  2. **Mensaje al cliente** (con `retryOnFail`), **consciente del horario**:
     en hora → "en breve te responden"; fuera de hora → "te respondemos a partir
     de las 8:00" (`P` operaciones §10).
  3. `tg-log` (`action: handoff`).
  4. **Nota privada** al final, **best-effort** (`onError: continue`): es un
     nice-to-have; si el LLM de la nota falla, la escalación ya sucedió.
  - **Realineación de embudo a email (§4 del review):** en intención de compra,
    mantener el spec-gathering liviano, pero la acción terminal cambia: en vez de
    asignar humano en WhatsApp, el bot manda **resumen copiable + email + checklist
    de qué adjuntar**, y n8n **auto-forwardea el lead** al inbox de la imprenta
    vía Brevo SMTP (ya configurado). Asignación humana en WhatsApp queda solo
    para: frustración/reclamo, "quiero hablar con una persona", fallo repetido
    del bot. **← decisión de producto a confirmar (ver Parte F).**
- Cierra `F2`, `P6`, parte de `P10`.

### Sección 12 — Cierre: error workflow + log workflow

- Construir `tg-bot-error` (Parte C, Capa 2) y setearlo como Error Workflow.
- Construir `tg-log` con la taxonomía de acciones completa + `bot.errores`.
- Verificar que las ramas onError de Capa 1 (catálogo, LLM, escalación) apuntan
  al sub-path fallback compartido.
- Cierra `P2` (error workflow global), `F8`.

---

## PARTE E — Orden de construcción (dependency-ordered, cruzado con P0)

Construir en `tg-bot-main-v6` nuevo, testear contra Chatwoot staging, luego
swap. Secuencia:

1. **Sección 0 + 1** — contenedor + webhook seguro. *(go-live gate `P1`, `P8`)*
2. **Secciones 2, 6, 7** — Filter + Code "Decidir" + Switch. El esqueleto nuevo;
   sobre esto caen casi todos los hallazgos. *(cierra F1,F3,F5,F6 + F nodos)*
3. **Sección 8** — catálogo cacheado + fallback. *(go-live gate `P2` parcial)*
4. **Sección 9** — Guardrails Tier-2 + structured output + models array +
   guard choices. *(gate `P4`; habilita P13)*
5. **Sección 11** — escalación reordenada + horario + email intake. *(gate `P6`)*
6. **Sección 4** — adjuntos tipados + dedupe. *(gate `P5`)*
7. **Sección 3 + `tg-firewall`** — Tier-1 anti-abuso. *(gate `P7`)*
8. **Sección 12 + `tg-bot-error` + `tg-log`** — errores y logging dedicados.
   *(gate `P2` completo)*
9. **Fuera del flujo (paralelo, review §2/§9):** red Chatwoot SLA "bot caído"
   (`P3`), monitoreo Layer 1 + backups (`P9`), suite de eval de flujo
   (`P18`), fix de `propuesta-cliente.md` pricing (`P12`).

Los ítems 1-4 son el núcleo y son cambios estructurales pero acotados. 5-8 son
las capas de robustez. El 9 corre en paralelo (infra, no toca el canvas).

---

## PARTE F — Decisiones abiertas (confirmar antes de construir)

1. **Embudo email vs order-intake en WhatsApp (Sección 11).** El review
   recomienda mantener el spec-gathering pero cambiar la acción terminal a
   "resumen + email + auto-forward Brevo". Esto reescribe la sección order-intake
   del system prompt y cambia las métricas de escalación. ¿Vamos con eso, o el
   cliente prefiere seguir cerrando el handoff dentro de WhatsApp?
2. **Cache de catálogo (Sección 8):** piloto con `getWorkflowStaticData`+TTL
   (cero infra nueva) vs workflow programado a `bot.catalogo_cache` (más robusto,
   un workflow más). Recomiendo empezar con static-data y migrar a la tabla si el
   prefijo estable no basta para el prompt caching.
3. **Versión de n8n en el VM** — verificar ≥1.119.1 para el nodo Guardrails
   antes de comprometer el Tier-2 (si no, upgrade primero).

---

## Fuentes

- Nodo Guardrails: [n8n Docs — Guardrails](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.guardrails) (verificado 2026-07-10).
- Todo lo demás: `../prod-readiness-review.md`, análisis de lógica de flujo 2026-07-10, `n8n/roadmap.md`, `research/Investigacion-guardrails.md`.
