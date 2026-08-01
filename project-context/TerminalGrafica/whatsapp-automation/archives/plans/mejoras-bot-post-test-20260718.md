# Plan de mejoras del bot TG — post tanda de test 2026-07-18

> Producto de un debate adversarial de 2 agentes Opus (escéptico/red-team vs
> especialista en bots de atención) sobre las observaciones de la corrida en vivo
> del 2026-07-18. 3 rondas + síntesis, consenso sin desacuerdos de fondo.
> Puntos debatidos: P1 flood (caso 2.2), P2 asunción (1.5), P3 agencia-sobre-pedidos
> (3.3), P4 sobre-negación (DNI), P5 formato, P6 fuga de costo del guard pago.
> Lo que sigue es la síntesis del moderador, verbatim.

---

# Síntesis del debate — Mejoras del bot de Terminal Gráfica

## 1. Problema-raíz mayor

**Sí: P2 + P3 + P4 son un solo problema de fondo.** El bot **confabula** — asevera con confianza para rellenar huecos en vez de anclarse o preguntar. Se manifiesta en tres ejes: sobre la situación del cliente (P2), sobre sus propias capacidades (P3), sobre política/legalidad (P4). La Regla actual del prompt ("no supongas qué PRODUCTO busca") es un caso particular demasiado angosto. En un modelo chico (flash-lite) el sesgo a "sonar competente" se agrava porque el prompt implícitamente premia contestar.

**Fix que generaliza — 4 principios de System Prompt (no N parches):**
1. **Anclá**: lo que el cliente afirma sobre su situación es VERDAD DE BASE y pisa el template/prior del bot. No repongas pasos que ya resolvió.
2. **Boundary de capacidad, negativo y absoluto** (los modelos chicos obedecen lo absoluto, alucinan lo matizado): no tenés sistema de pedidos; nunca confirmás/modificás/cancelás/seguís pedidos.
3. **Default servicial**: ante ambigüedad o pedido cotidiano dudoso, PREGUNTÁ o informá — nunca niegues ni asumas. La negación exige estar en una lista CORTA y cerrada de acciones prohibidas.
4. **Bendecí el no-answer/handoff como resultado BUENO** ("no sé", "eso va por otro canal", "te paso con un humano"). Baja la confabulación en los tres modos a la vez.

**Pero el prompt solo no basta** donde la aseveración falsa es dañina y no recuperable (P3): se backea con router determinista y con eval. **Prompt = actitud; canned ruteada = corte fino ya resuelto; eval = prueba de que bajó.**

---

## 2. Punto por punto (P1–P6)

### P1 — Flood de bajo contenido
- **(a) Raíz:** al Tier-1 le falta una heurística barata de "turno de baja información" post-debounce. **Ojo:** el debounce ya colapsó ~10 mensajes en 1 turno → el daño directo de P1 es trivial. P1 no justifica el build por sí mismo; lo justifica P6.
- **(b) Solución acordada — clasificador determinista de 3 vías en Tier-1 (GRATIS), lexicón calibrado al registro marplatense:**
  - **Entropía pura** ("aaaa", "kkk") → **silencio** (el reprompt es un service message PAGO desde 1-oct; no se gasta en "aaaa").
  - **Contentless-social** ("hola", "buenas", "consulta") → **UN reprompt canned** por ráfaga, cap propio, se resetea con el primer turno informativo real.
  - **Contentless-hostil** ("contesta boludo", "hace una hora que espero") → **HANDOFF**, NO abuso.
  - **NUNCA alimenta strikes** (retirado por consenso: no se puede distinguir determinísticamente abusador de confundido de enojado-legítimo).
- **(c)** Ataca la raíz (feeder barato que blinda la capa cara), no parche.
- **(d) Desacuerdo residual resuelto:** la rama hostil sesga a **RECALL** pero con **presupuesto de handoffs/día medido en shadow** para evitar fatiga de alerta. Cierre final: en vez de subir el umbral (re-entierra el reclamo), **graduar la señal** — frustración difusa → cola de baja prioridad; reclamo con objeto concreto ("me cobraron de más", "el trabajo salió mal") → handoff de alta prioridad que interrumpe.

### P2 — Consejo genérico / asunción
- **(a) Raíz:** el bot priorizó sonar servicial por encima de ser correcto sobre el estado del cliente; pattern-matcheó "dibujo → digitalizá" y pisó "lo tengo en el celu". Es la raíz transversal, no un rule de dibujos.
- **(b) Solución:** **System Prompt** (principio 1: verdad-de-base) + **dato/routing**: "entrega de archivo → email" como respuesta conocida de primera clase. Respuesta ideal ancla + rutea + maneja expectativa.
- **(c)** Ataca la raíz. **(d)** Sin desacuerdo. Cerrado.

### P3 — El bot implica agencia sobre pedidos
- **(a) Raíz (reframe clave):** la falla es de **OUTPUT, no de INPUT.** El bug no es "no detectamos la intención de mutar el pedido" (recall ilimitado, imposible de ganar) — es "el bot afirmó haber hecho algo que no puede hacer". El bot no tiene vocabulario de confirmación-de-acción-sobre-pedido, punto.
- **(b) Solución — dos capas:**
  - **System Prompt (garantía) = boundary de OUTPUT absoluto:** "nunca afirmás haber actualizado/cambiado/cancelado/recibido/reemplazado nada de un pedido, sea cual sea el mensaje". Absoluto → flash-lite lo sostiene; esquiva el problema de recall entero.
  - **Router determinista (Tier-1/pre-LLM) = acelerador de UX (precisión):** los casos obvios de mutación → canned buena. La canned debe (a) **matar la creencia falsa explícito** ("no cambié nada desde acá"), (b) dar **próximo paso con urgencia** ("reenviá el archivo correcto a X aclarando que reemplaza el de ayer").
- **(c)** Ataca la raíz.
- **(d) Corrección crítica (FP inverso — gaslighting):** el boundary debe ser **quirúrgico**. Prohíbe afirmar cambio de ESTADO del pedido; NO prohíbe el **acuse conversacional** ("te leo, veo que mandaste el v2"). Si borra el acuse, cambiás una confabulación cara por un bot frío que parece tragar mensajes. Para la cola larga (no ruteada), no se le pide al modelo trazar la línea fina en runtime → se descompone en **3 absolutos componibles**: (1) acusá siempre que llegó, (2) ruteá siempre el estado a email/humano, (3) nunca afirmés agencia.

### P4 — Sobre-negación (DNI)
- **(a) Raíz doble:** (1) misma raíz transversal — asumió "DNI → falsificación" sin anclar en lo pedido (fotocopia = servicio legal cotidiano); (2) gap de dato — "fotocopias" no está en catálogo, sin grounding positivo cayó a negación por default.
- **(b) Solución:** **dato** (agregar fotocopias/copias al catálogo) + **System Prompt** (principio 3: lista de prohibidos CORTA y cerrada — falsificar moneda/documentos ajenos, contenido ilegal — todo lo demás permitido-o-preguntá).
- **(c)** Ataca la raíz. **(d)** Sin desacuerdo; nota firmada: cada ítem defensivo agregado a la lista de prohibidos es un FP esperando a un cliente real. Costo de reputación (acusar implícitamente de falsificación) > costo del ticket.

### P5 — Formato de respuestas largas
- **(a) Raíz:** cosmético, sin debate.
- **(b) Solución:** **System Prompt**, una línea: encabezá con la forma antes de la lista ("tenemos 3 cantidades:"), variantes una por línea, sin markdown pesado (WhatsApp no renderiza tablas/negritas confiable — saltos y guiones simples), no volcar todas las variantes si la pregunta fue angosta.
- **(c)** N/A. **(d)** Cerrado.

### P6 — Fuga de costo del guard pago
- **(a) Raíz:** el guard PAGO corre en cada turno hasta que Tier-1 silencia, pero Tier-1 solo silencia por strikes (rate/regex/injection). Un sender bajo el rate y sin disparar regex (ruido de baja info) **paga guard calls para siempre** porque nunca acumula strike. La capa cara hace trabajo de detección sin feeder barato.
- **(b) Solución:** el clasificador de baja-info de P1 **short-circuitea ANTES del guard** (silencio/reprompt sin LLM). El guard pago solo ve turnos con contenido lingüístico real que valga juzgar. Sin strikes (recuperable).
- **(c)** Ataca la raíz — es el verdadero justificativo del build de P1.
- **(d)** Sin desacuerdo. Agregado firmado: **instrumentar antes de celebrar** — loguear cuántos guard-calls/sender/día genera hoy el sub-rate noise, para saber el tamaño de lo que se tapó.

---

## 3. Veredicto sobre tu propuesta de P1 (nudge al Topical LLM)

**Capa EQUIVOCADA — rechazada por consenso unánime.** Un flood es VOLUMEN/entropía: el abuso más barato de detectar. Meter un nudge al guard Topical paga un LLM para cazar exactamente lo que una regla determinista gratis ataja — el anti-patrón de costo central. Además llega tarde: cuando el guard lo ve, ya estás pagando.

**Alternativa acordada:** clasificador determinista de baja-info en **Tier-1 (GRATIS)**, de 3 vías (entropía→silencio / social→un reprompt / hostil→handoff), que short-circuitea antes del guard. Nada que sea volumen/entropía puede terminar en la capa paga.

---

## 4. Orden de implementación sugerido

Regla transversal que gobierna todo: **ningún fix se prende en activo sin su número.** Cada fix se mide en PAR (modo-de-falla abajo Y falso-rechazo/frialdad NO arriba), con umbral **pre-registrado antes de correr**.

**Fase 0 — Instrumentación (precondición dura, primero):**
1. Log-only de todo bloqueo/negación/handoff/refusal con el mensaje que lo disparó.
2. Medir guard-calls/sender/día del sub-rate noise (dimensiona P6).

**Fase 1 — Prompt + dato (barato, alto impacto, sin infra):**
3. Reescribir System Prompt con los 4 principios (reemplaza la Regla angosta actual). Incluye boundary de output quirúrgico de P3 (3 absolutos componibles), lista de prohibidos corta/cerrada (P4), default servicial, bendición del no-answer, y formato P5.
4. Agregar "fotocopias/copias" al catálogo (P4).
5. Routing "archivos/entrega → email" como respuesta conocida de primera clase (P2/P3).

**Fase 2 — Eval como gate de merge (bloquea Fase 1):**
6. Golden en promptfoo con los 3 casos vivos (dibujo-en-el-celu, ignorá-el-pedido, fotocopia-DNI) + casos legítimos-cercanos para el FP inverso (acuse-de-recepción que NO debe gaslightear, DNI/factura/recibo que NO deben negarse). Aserciones exigen **PRESENCIA de la recuperación**, no ausencia de lo malo. Corridas **N veces con umbral** (ej. 9/10), no n=1 (flash-lite confabula en el reintento). Métrica en par: modo-de-falla abajo Y falso-rechazo por separado.

**Fase 3 — Firewall / arquitectura (único build real, justificado por P6):**
7. Clasificador determinista de baja-info de 3 vías en Tier-1 + short-circuit antes del guard (P1/P6). Lexicón marplatense. Señal de handoff graduada (baja prioridad vs. reclamo-con-objeto). **Se despliega en shadow/log-only primero**, se mira qué HABRÍA cazado y el presupuesto de handoffs urgentes/día, y recién ahí se prende. NUNCA alimenta strikes.

**Fase 4 — Loop vivo (proceso continuo, no one-shot):**
8. Cadencia semanal liviana de revisión de logs: Martin mira qué bloqueó/negó/escaló el bot; cada modo de falla nuevo se **promueve a caso golden**. El gate prueba que arreglamos los casos de ayer; el loop es lo único que prueba que seguimos arreglados mañana (el cliente es una distribución que deriva; el FP que mata es el que no modelaste).

**Nota de marca (transversal a toda copy canned):** los reprompts, la recuperación de P3, la contención del frustrado y el "eso va por email" son el touchpoint de MÁS alta frecuencia del bot. Se escriben en la voz de Terminal Gráfica y los revisa Martin antes de prender — una canned fría es costo de reputación a escala, no string de relleno.

**Clasificación de cada ítem:** Firewall/Tier-1 → #7. Prompt → #3, #5 (formato). Dato/catálogo → #4, #5 (routing). Arquitectura (router determinista) → parte de #3 (P3) y #7. Medición/proceso → #1, #2, #6, #8.

**Desacuerdos pendientes:** ninguno de fondo. Todo cerró con las correcciones incorporadas (gaslighting quirúrgico en P3, señal de handoff graduada en P1, loop además del gate). Las líneas rojas comunes: (i) nada de volumen/entropía toca la capa paga; (ii) señal ambigua de cliente-real (baja info, frustración) nunca se convierte en strike/silencio-24h; (iii) ante la duda abusador-vs-confundido, siempre el camino recuperable; (iv) ningún fix se declara "hecho" sin su número pre-registrado.

---

## ADDENDUM 2026-07-19 — P1 (flood) reencaminado tras evidencia + IMPLEMENTADO

Una captura real del flood (mensajes tipo "a"/"aaaa"/"TARJETAS TARJETAS…"/"respondeme respondeme") mostró que el "clasificador de baja-info por CONTENIDO" (Fase 3 #7 del debate) es evadible: **"TARJETAS TARJETAS" contiene un keyword de producto → se lava y saca una respuesta genuina y pagada** ("keyword-laundering"). Y clasificar contenido corre el riesgo de marcar a un cliente real impaciente ("hola? respondeme").

**Decisión (Martin):** reemplazar el clasificador por contenido por un enfoque de **comportamiento/costo**, más simple:
1. **Anti-repetición (LLM auto-consciente):** el LLM recibe sus últimas 3 respuestas + contrato con `action: noop`. No responde si NI el cliente NI su respuesta aportan algo nuevo (regla de doble llave; protege el "repetime el horario"). Ahorra el mensaje de WhatsApp (lo caro); el call del LLM (barato) se acepta.
2. **Cap duro:** 25 respuestas del bot / 24h rodante (derivado del historial, sin tabla nueva) → mensaje automático SIN LLM que deriva a email + label `revisar-volumen` + silencio.

Ventaja sobre el clasificador por contenido: **content-agnostic** (inmune al keyword-laundering) y **ungameable por chunking** (cuenta respuestas caras, no mensajes). El "short-circuit de basura literal en Tier-1" quedó descartado por Martin (innecesario). **IMPLEMENTADO en faq-bot-v6.json (commit e19ca16).**
