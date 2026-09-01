# v10 — nodos desagregados + mapa de conexiones

> Generado por `_split-monolito.js` desde `../flows/faq-bot-v10-live.json`.
> **No editar a mano** esta carpeta esperando que suba al monolito: la sync es
> monolito → nodes/. Para el modelo mental por etapas, ver `../../MAPA.md`.

## Cómo se usa

- **Sincronizar:** exportá el workflow sobre el monolito y corré `node _split-monolito.js`. `git diff` muestra qué nodos cambiaron.
- **Actualizar un nodo en n8n:** importá/pegá su `.json` de `nodes/` (trae el nodo + sus sub-nodos ai_).

## Índice de nodos (63 archivos, 78 nodos)

| archivo | nodo | tipo | sub-nodos incluidos |
|---|---|---|---|
| `nodes/aprobado.json` | ¿Aprobado? | if | — |
| `nodes/hay-algo-que-decir.json` | ¿Hay Algo Que Decir? | if | — |
| `nodes/info-resuelta.json` | ¿Info Resuelta? | if | — |
| `nodes/re-auditar.json` | ¿Re-auditar? | if | — |
| `nodes/reintentar.json` | ¿Reintentar? | if | — |
| `nodes/se-entrego.json` | ¿Se Entregó? | if | — |
| `nodes/tiene-texto.json` | ¿Tiene Texto? | if | — |
| `nodes/violacion-real-tier-2.json` | ¿Violación Real Tier-2? | if | — |
| `nodes/agente-compositor.json` | Agente Compositor | agent | Modelo · Agente Compositor, Salida · Agente Compositor |
| `nodes/agente-info.json` | Agente Info | agent | Modelo · Agente Info, Salida · Agente Info |
| `nodes/agente-intencion.json` | Agente Intención | agent | Modelo · Agente Intención, Salida · Agente Intención |
| `nodes/agente-relevancia.json` | Agente Relevancia | agent | Modelo · Agente Relevancia, Salida · Agente Relevancia |
| `nodes/agente-selector.json` | Agente Selector | agent | Modelo · Agente Selector, Salida · Agente Selector, explorar_catalogo |
| `nodes/agente-verificador.json` | Agente Verificador | agent | Modelo · Agente Verificador, Salida · Agente Verificador, verificar_en_base |
| `nodes/armar-candidatos.json` | Armar Candidatos | code | — |
| `nodes/aviso-rate-firewall.json` | Aviso Rate Firewall | httpRequest | — |
| `nodes/buscar-candidatos.json` | Buscar Candidatos | postgres | — |
| `nodes/calcular-montos.json` | Calcular Montos | code | — |
| `nodes/chatwoot-webhook.json` | Chatwoot Webhook | webhook | — |
| `nodes/chequear-envio.json` | Chequear Envio | code | — |
| `nodes/datos-info.json` | Datos Info | postgres | — |
| `nodes/decidir.json` | Decidir | code | — |
| `nodes/descartar-debounce-dup.json` | Descartar (debounce/dup) | noOp | — |
| `nodes/descartar-firewall-drop.json` | Descartar Firewall (drop) | noOp | — |
| `nodes/enviar-mensaje.json` | Enviar Mensaje | httpRequest | — |
| `nodes/extraer-palabras.json` | Extraer Palabras | code | — |
| `nodes/filtro-ingreso.json` | Filtro Ingreso | filter | — |
| `nodes/firewall-tier-1.json` | Firewall Tier-1 | postgres | — |
| `nodes/get-historial.json` | Get Historial | httpRequest | — |
| `nodes/guardrails-tier-2.json` | Guardrails Tier-2 | guardrails | OpenRouter Chat Model |
| `nodes/label-cap.json` | Label Cap | httpRequest | — |
| `nodes/label-envio-fallido.json` | Label Envío Fallido | httpRequest | — |
| `nodes/label-escalacion.json` | Label Escalación | httpRequest | — |
| `nodes/leer-compositor.json` | Leer Compositor | code | — |
| `nodes/leer-info.json` | Leer Info | code | — |
| `nodes/leer-intencion.json` | Leer Intención | code | — |
| `nodes/leer-selector.json` | Leer Selector | code | — |
| `nodes/leer-verificador.json` | Leer Verificador | code | — |
| `nodes/log-escalacion.json` | Log Escalación | postgres | — |
| `nodes/log-turno.json` | Log Turno | postgres | — |
| `nodes/mensaje-anti-injection.json` | Mensaje Anti-Injection | httpRequest | — |
| `nodes/mensaje-cap-email.json` | Mensaje Cap Email | httpRequest | — |
| `nodes/mensaje-escalacion.json` | Mensaje Escalación | httpRequest | — |
| `nodes/mensaje-firewall-refusal.json` | Mensaje Firewall Refusal | httpRequest | — |
| `nodes/mensaje-refusal-tier-2.json` | Mensaje Refusal Tier-2 | httpRequest | — |
| `nodes/prompt-info.json` | Prompt Info | code | — |
| `nodes/prompt-intencion.json` | Prompt Intención | code | — |
| `nodes/prompt-re-auditoria.json` | Prompt Re-auditoría | code | — |
| `nodes/prompt-reintento.json` | Prompt Reintento | code | — |
| `nodes/prompt-selector.json` | Prompt Selector | code | — |
| `nodes/prompt-verificador.json` | Prompt Verificador | code | — |
| `nodes/respuesta-no-texto.json` | Respuesta No-Texto | httpRequest | — |
| `nodes/router-fail-tier-2.json` | Router Fail Tier-2 | code | — |
| `nodes/saludo-bienvenida.json` | Saludo Bienvenida | httpRequest | — |
| `nodes/silencio-otro.json` | Silencio Otro | noOp | — |
| `nodes/silencio-tier-2.json` | Silencio Tier-2 | noOp | — |
| `nodes/strike-tier-2.json` | Strike Tier-2 | postgres | — |
| `nodes/switch-firewall.json` | Switch Firewall | switch | — |
| `nodes/switch-intencion.json` | Switch Intención | switch | — |
| `nodes/switch-ruteo.json` | Switch Ruteo | switch | — |
| `nodes/switch-strike-tier-2.json` | Switch Strike Tier-2 | switch | — |
| `nodes/verificar-hmac.json` | Verificar HMAC | code | — |
| `nodes/wait-debounce.json` | Wait — Debounce | wait | — |

## Cableado (conexiones `main`, en orden de salida)

Cada línea: nodo origen → por cada salida `[i]`, los destinos. Los nodos Switch/If
tienen varias salidas; el índice `[i]` es el orden del puerto.

- **Chatwoot Webhook**  [0]→ Verificar HMAC
- **Verificar HMAC**  [0]→ Filtro Ingreso
- **Filtro Ingreso**  [0]→ Firewall Tier-1
- **¿Tiene Texto?**  [0]→ Wait — Debounce   [1]→ Respuesta No-Texto
- **Wait — Debounce**  [0]→ Get Historial
- **Get Historial**  [0]→ Decidir
- **Decidir**  [0]→ Switch Ruteo
- **Switch Ruteo**  [0]→ Descartar (debounce/dup)   [1]→ Saludo Bienvenida   [2]→ Mensaje Anti-Injection   [3]→ Guardrails Tier-2   [4]→ Mensaje Cap Email
- **Firewall Tier-1**  [0]→ Switch Firewall
- **Switch Firewall**  [0]→ ¿Tiene Texto?   [1]→ Mensaje Firewall Refusal   [2]→ Aviso Rate Firewall   [3]→ Descartar Firewall (drop)   [4]→ ¿Tiene Texto?
- **Guardrails Tier-2**  [0]→ ¿Violación Real Tier-2?   [1]→ Router Fail Tier-2
- **Router Fail Tier-2**  [0]→ ¿Violación Real Tier-2?
- **¿Violación Real Tier-2?**  [0]→ Strike Tier-2   [1]→ Prompt Intención
- **Strike Tier-2**  [0]→ Switch Strike Tier-2
- **Switch Strike Tier-2**  [0]→ Mensaje Refusal Tier-2   [1]→ Silencio Tier-2   [2]→ Silencio Tier-2
- **Buscar Candidatos**  [0]→ Armar Candidatos
- **Extraer Palabras**  [0]→ Buscar Candidatos
- **Enviar Mensaje**  [0]→ Chequear Envio
- **Label Escalación**  [0]→ Mensaje Escalación
- **Mensaje Escalación**  [0]→ Log Escalación
- **Mensaje Cap Email**  [0]→ Label Cap
- **Agente Intención**  [0]→ Leer Intención
- **Agente Selector**  [0]→ Leer Selector
- **Agente Relevancia**  [0]→ Calcular Montos
- **Agente Compositor**  [0]→ Leer Compositor
- **Agente Verificador**  [0]→ Leer Verificador
- **Prompt Intención**  [0]→ Agente Intención
- **Leer Intención**  [0]→ Switch Intención
- **Switch Intención**  [0]→ Datos Info   [1]→ Silencio Otro   [2]→ Prompt Selector
- **Datos Info**  [0]→ Prompt Info
- **Prompt Selector**  [0]→ Agente Selector
- **Leer Selector**  [0]→ Extraer Palabras
- **Armar Candidatos**  [0]→ Agente Relevancia
- **Calcular Montos**  [0]→ ¿Hay Algo Que Decir?
- **¿Hay Algo Que Decir?**  [0]→ Agente Compositor   [1]→ Label Escalación
- **Leer Compositor**  [0]→ Prompt Verificador
- **Prompt Verificador**  [0]→ Agente Verificador
- **Leer Verificador**  [0]→ ¿Aprobado?
- **¿Aprobado?**  [0]→ Enviar Mensaje   [1]→ ¿Re-auditar?
- **¿Reintentar?**  [0]→ Prompt Reintento   [1]→ Label Escalación
- **Prompt Reintento**  [0]→ Agente Compositor
- **¿Re-auditar?**  [0]→ Prompt Re-auditoría   [1]→ ¿Reintentar?
- **Prompt Re-auditoría**  [0]→ Agente Verificador
- **Chequear Envio**  [0]→ ¿Se Entregó?
- **¿Se Entregó?**  [0]→ Log Turno   [1]→ Label Envío Fallido
- **Label Envío Fallido**  [0]→ Log Turno
- **¿Info Resuelta?**  [0]→ Enviar Mensaje   [1]→ Label Escalación
- **Prompt Info**  [0]→ Agente Info
- **Agente Info**  [0]→ Leer Info
- **Leer Info**  [0]→ ¿Info Resuelta?

## Sub-nodos ai_ (modelo / parser / tool → agente)

- `OpenRouter Chat Model` → **Guardrails Tier-2**
- `Modelo · Agente Intención` → **Agente Intención**
- `Salida · Agente Intención` → **Agente Intención**
- `Modelo · Agente Selector` → **Agente Selector**
- `Salida · Agente Selector` → **Agente Selector**
- `explorar_catalogo` → **Agente Selector**
- `Modelo · Agente Relevancia` → **Agente Relevancia**
- `Salida · Agente Relevancia` → **Agente Relevancia**
- `Modelo · Agente Compositor` → **Agente Compositor**
- `Salida · Agente Compositor` → **Agente Compositor**
- `Modelo · Agente Verificador` → **Agente Verificador**
- `Salida · Agente Verificador` → **Agente Verificador**
- `verificar_en_base` → **Agente Verificador**
- `Modelo · Agente Info` → **Agente Info**
- `Salida · Agente Info` → **Agente Info**
