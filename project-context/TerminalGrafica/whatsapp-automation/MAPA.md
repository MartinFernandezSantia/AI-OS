# MAPA del bot de WhatsApp de TG

> **Fuente única de verdad.** Este archivo describe el flow que está VIVO hoy
> (`n8n/flows/faq-bot-v10-live.json`, 75 nodos) tal como es, no lo que dicen los
> planes viejos. Si tocás el flow y esto no cambió, el archivo miente.
> **Última verificación contra el JSON (conexiones reales): 2026-08-02, con Martin en el canvas.**

## Aviso importante antes de leer nada

El resto de los ~40 documentos de esta carpeta describen versiones **anteriores**.
El `handoff-proximas-sesiones.md` y todos los `plans/` terminan en **v9**, que era
otra arquitectura (un LLM + "Aclarador" + un motor de precios en código, prosa→prosa).
**v10-live es un rediseño en 5 agentes y no tiene doc propio.** Por eso cuesta
orientarse: lo que corre es lo menos documentado. Este MAPA cierra ese hueco.

Cuando un doc viejo mencione nodos como *Aclarador*, *Armar Respuesta Precio*,
*Get Precio* o *Parsear Respuesta*: **ya no existen en v10**. Los reemplazó la
cadena de agentes de la sección "Pipeline".

---

## Qué es el bot (3 frases)

Bot de atención **reactiva** de WhatsApp para una gráfica. Un cliente escribe por
precios/formatos/horarios; el bot responde con IA usando **solo** el catálogo real
de TG, y si no puede, deriva a un humano por mail. Está montado sobre Chatwoot
(bandeja) + n8n (la lógica) + un modelo LLM barato vía OpenRouter, todo self-hosted.

---

## El pipeline en 10 etapas

El flow tiene 75 nodos, pero son **10 etapas en este orden real** (verificado contra las
conexiones del JSON y confirmado por Martin en el canvas, 2026-08-02). La columna **etiqueta**
separa la complejidad en tres clases:
`CARGA PESO` (necesaria, no tocar) · `EVALUABLE` (real pero quizás recortable, post-entrega)
· `CLUTTER` (basura, se puede tirar).

Orden de un vistazo:
`Webhook → HMAC → Filtro → **Firewall** → ¿Texto? → Debounce → Historial → Decidir → Guardrails
→ Intención → Selector→Relevancia→Montos → Compositor → Verificador → Envío/Log`.
Ojo al detalle que confundía: **el Firewall corre temprano, ANTES del debounce y de Decidir.**

| # | Etapa | Qué hace | Por qué existe (qué falla si no está) | Nodos principales | Etiqueta |
|---|---|---|---|---|---|
| 1 | **Intake (puerta)** | Recibe el webhook, valida firma HMAC, y filtra (solo texto entrante, WhatsApp, conversación **sin asignar**) | Sin HMAC dispara cualquiera. El filtro "sin asignar" hace que si un humano toma la charla, el bot se calle | `Chatwoot Webhook`, `Verificar HMAC`, `Filtro Ingreso` | CARGA PESO |
| 2 | **Firewall Tier-1** | `bot.firewall_check` chequea remitente/texto contra la DB y devuelve `action`: pass/refusal/silence/drop. `Switch Firewall` rutea por `action`. **Corre antes del debounce** | Bloqueo determinista (SQL, sin LLM) de injections/spam/flood conocidos, antes de gastar un token | `Firewall Tier-1`, `Switch Firewall` | CARGA PESO · ⚠️ **bug conocido:** el `silence` de strike-max cae en el aviso de rate (ver handoff §3.i) |
| 3 | **Texto + Debounce** | ¿Es texto o archivo? Si es texto, espera 3s (debounce) y trae el historial | Sin debounce, "quiero 3 carteles" en 3 globitos se procesa descoordinado (INC-15). Archivo → hoy "no puedo procesar" | `¿Tiene Texto?`, `Wait — Debounce`, `Get Historial` | CARGA PESO |
| 4 | **Decidir** | Code node: elige la acción — descartar (idempotencia + gana-el-último del debounce), saludo, anti-injection, cap de volumen, o procesar. `Switch Ruteo` reparte | Sin idempotencia el bot se contesta solo; acá mueren N-1 globitos de una ráfaga antes del LLM | `Decidir`, `Switch Ruteo` | CARGA PESO · nota: el anti-injection de acá se solapa con el del firewall (etapa 2) → revisar si es redundante |
| 5 | **Guardrails Tier-2** | Segunda capa, con LLM: jailbreak/tema-fuera. Strikes que silencian al reincidente | Atrapa ataques nuevos que el Tier-1 (patrones fijos) no conoce | `Guardrails Tier-2`, `¿Violación Real Tier-2?`, `Strike Tier-2`, `Switch Strike Tier-2` | **EVALUABLE** — llamada LLM extra por turno; ¿justifica sobre Tier-1? Medir post-entrega |
| 6 | **Agente Intención** | Clasifica `info` / `catalogo` / `otro`. Rama info responde con `bot.info_negocio` | Separa "¿a qué hora abren?" de "¿cuánto sale un cartel?" — caminos distintos | `Agente Intención`, `consultar_info_negocio`, `Switch Intención`, `Datos Info` | CARGA PESO |
| 7 | **Selector → Relevancia → Montos** | El Selector busca candidatos (`explorar_catalogo`); se extraen palabras y se arman candidatos; `Agente Relevancia` filtra; **`Calcular Montos` calcula los precios al final** | **El corazón de la plata.** Los montos salen de código determinista, NUNCA los tipea el LLM. Relevancia corre ANTES de Montos | `Agente Selector`, `explorar_catalogo`, `Extraer Palabras`, `Buscar Candidatos`, `Armar Candidatos`, `Agente Relevancia`, `Calcular Montos` | CARGA PESO (Calcular Montos = intocable) · Relevancia **EVALUABLE** (filtra "demasiado agresivo", D-1) |
| 8 | **Agente Compositor** | Redacta la respuesta natural con los montos ya autorizados por código | Que el mensaje no suene a robot recitando el catálogo | `¿Hay Algo Que Decir?`, `Agente Compositor`, `Leer Compositor` | CARGA PESO |
| 9 | **Verificador + loops** | Audita el borrador (¿inventó un monto?). Loops de **reintento** (mal borrador) y **re-auditoría** (auditor mal), tope 1 cada uno | El auditor blinda contra montos inventados | `Agente Verificador`, `¿Aprobado?`, `¿Re-auditar?`, `¿Reintentar?` | **EVALUABLE** — los loops son la parte más frágil; ¿ganan su peso? |
| 10 | **Envío + Log + Escalación** | Envía a Chatwoot, verifica entrega, y **loguea todo en `bot.decisiones`**. Si no hay qué decir o falla, deriva a mail | El log es la ÚNICA forma de detectar confident-wrong (no hay humano mirando) | `Enviar Mensaje`, `Chequear Envio`, `¿Se Entregó?`, `Log Turno`, `Label`/`Mensaje`/`Log Escalación` | CARGA PESO |

**Salidas laterales** (no son etapas, son finales): `Mensaje Escalación` + `Label`/`Log Escalación`
(derivar a humano por mail) · `Mensaje Cap Email` (tope de volumen) · varios `Descartar`/`Silencio`
(dropeos mudos, ojo: 4 caminos terminan en silencio sin alerta).

---

## Dónde vive cada cosa

| Necesito... | Está en |
|---|---|
| El flow vivo | `n8n/flows/faq-bot-v10-live.json` (**el único que importa**) |
| La lógica de verdad (no-LLM) | Los **17 code nodes** del flow. El crítico es `Calcular Montos` |
| Qué ve el bot del catálogo | Views `bot.taxonomia`, `bot.variantes`, `bot.producto_meta` (definidas en `data-model.md`) |
| La telemetría / logs de decisiones | Tabla `bot.decisiones` (una fila por turno). Consultas listas en el handoff §5b |
| El firewall | `db/firewall-tier1.sql`, `db/firewall-tier2-strike.sql` |
| Los tests del flow v10 | `tests/validate-v10-agents.js`, `tests/test-v10-relevancia.js`, `tests/test-cap-e-info.js` |
| Curar el catálogo (nombres/sinónimos) | skill `/tg-curar-catalogo`; fallback visual `tools/curador-catalogo.html` |
| El prompt del sistema | dentro del flow (nodos de cada agente); el `.md` de `n8n/prompts/` es de v5, viejo |

**Regla de oro del acceso a datos:** el bot NUNCA escribe en `public.*` (el mostrador real de TG).
Vive en el overlay `bot.*`. Claude prepara las migraciones SQL, **Martin las aplica** — Claude no
toca la base ni ve las ejecuciones.

---

## Estado vivo hoy (2026-08-01)

- **Vivo:** `faq-bot-v10-live.json` — 75 nodos (17 code, 5 agentes LLM + 5 parsers + 6 modelos,
  13 HTTP a Chatwoot, 6 Postgres, firewall 2 capas).
- **Modelo:** `google/gemini-2.0-flash-lite-001` vía OpenRouter. **Muere el 16-oct-2026** →
  sucesor previsto `gemini-3.1-flash-lite`, entra solo si pasa promptfoo.
- **Curación aplicada:** acumulada hasta `db/curacion-2026-07-28b.sql`.
- **Corre en:** VM local de dev con número de test. **NO es prod de TG todavía** (prod = KVM 4,
  sin contratar). Entrega inminente.
- **Tests:** para verificar el flow v10 correr (Martin, y ver verde él mismo):
  `WF=faq-bot-v10-live.json node tests/validate-v10-agents.js`.
  ⚠️ `tests/code-harness.js` (354 casos) es de **v8**, no corre contra v10 — es una trampa.

---

## Glosario (la jerga interna, de una vez)

- **Mundo cerrado:** lo que no está en el catálogo NO existe para el bot. No inventa productos.
- **Clave natural:** el bot resuelve productos por nombre/atributo, jamás por uuid.
- **Montos autorizados / tokenización de precios:** los precios los calcula el código (`Calcular
  Montos`); el LLM recibe "tokens" y nunca tipea un número. Es la defensa central contra sub-cotizar.
- **Confident-wrong:** el bot cotiza mal **con seguridad** y nadie lo ve (no hay humano en Chatwoot).
  Se detecta 100% automático leyendo `bot.decisiones` (columna `senales`).
- **Firewall Tier-1 / Tier-2:** T1 = patrones baratos en SQL. T2 = guardrail con LLM para ataques nuevos.
- **Reatribución:** bug abierto. El compositor conserva el orden de los precios pero le cambia el
  producto al que cada uno pertenece. Ninguna regla lo ve. El test `X4d` marca el hueco a propósito.
- **Re-auditoría / reintento:** los loops de la etapa 9. Tope 1 cada uno para no ciclar infinito.
- **Overlay `bot.*`:** el esquema propio del bot, separado del mostrador `public.*` de TG.

---

## El BUCLE — cómo trabajamos de ahora en más

El problema de fondo no era el bot: era que Martin testeaba y Claude "arreglaba mágico", sin que
Martin entendiera ni pudiera guiar. Esto lo reemplaza. **Martin guía, Claude ejecuta.**

1. **Martin observa** — un test rojo, o una fila rara en `bot.decisiones`. Forma una hipótesis.
2. **Martin decide** el cambio y lo dicta **en términos de lógica**, no de nodos:
   *"el Selector tiene que pasar varios candidatos, no uno"*.
3. **Claude ejecuta** la mecánica de n8n y devuelve un **diff legible**: qué nodo/s cambiaron y por
   qué, en prosa. **Nunca el JSON crudo** (es ilegible, ese fue medio problema).
4. **Martin revisa** el resumen y el test (rojo→verde) y aprueba.
5. **Se registra** el cambio: una línea acá si mueve el mapa, y en `decisions/log.md` si es decisión.

**Reglas fijas del bucle:**
- Claude NO ve las ejecuciones del bot. Si necesita un dato de una corrida, **lo pide** — no lo deduce.
- Toda decisión de diseño se contrasta **antes** de aplicarla (pasada adversarial), y al contraste
  se le pide que refute, no que valide.
- Claude prepara las migraciones SQL; Martin las aplica. Claude no toca la base.
- Nada de esto toca `v10-live` hasta después de la entrega, salvo bug que rompa la entrega.
