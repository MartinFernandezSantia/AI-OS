# Meta + IA en WhatsApp: reglas oficiales y riesgo de baneo

> Research profundo (deep-research, fan-out + verificación adversarial 3 votos por
> claim). Fecha: 2026-06-22. 24 fuentes fetcheadas, 77 claims extraídos, 25
> verificados, 22 confirmados, 3 refutados.
>
> **Contexto:** gráfica chica usando la WhatsApp Business **Cloud API oficial**
> (no WhatsApp Web ni librerías no oficiales), número SIM prepago registrado en
> Meta Cloud API, conectado vía Chatwoot + n8n, respondiendo mensajes entrantes
> de clientes con un LLM.

---

## TL;DR

**Meta NO prohíbe** que un negocio chico use un LLM para responder
automáticamente los mensajes entrantes de sus propios clientes vía la Cloud API
oficial. Nuestro caso de uso (atención, FAQs, estado de pedido, cotizaciones,
turnos) está del lado **permitido**.

El riesgo real de baneo **no es usar IA** — es **comportamiento**: mensajear sin
opt-in, ignorar opt-outs, mandar promos/spam, picos de volumen. Meta **no puede
detectar que una respuesta la escribió una IA** (los mensajes están cifrados
end-to-end); la moderación se basa en señales de calidad (bloqueos, reportes).

La restricción técnica clave a respetar es la **ventana de 24 hs**: dentro de la
ventana podés responder libre (humano o IA); fuera, solo plantillas
pre-aprobadas por Meta.

---

## 1. ¿Meta permite respuestas automáticas / generadas por IA?

**SÍ, para tu caso. (confianza: alta)**

El cambio de términos de enero 2026 prohíbe a los **"AI Providers"** (LLMs,
plataformas de IA generativa, asistentes de propósito general tipo
ChatGPT/Perplexity) **solo cuando la IA es la funcionalidad PRINCIPAL** que se
distribuye por la plataforma. La automatización específica de un negocio para
soporte, FAQs, estado de pedidos, turnos y calificación de leads está
explícitamente permitida como "incidental o accesoria".

> Términos (vigentes 6-mar-2026; exigibles desde 15-ene-2026): *"AI Providers are
> strictly prohibited from accessing or using the WhatsApp Business Solution...
> when such technologies are the primary (rather than incidental or ancillary)
> functionality being made available for use, as determined by Meta in its sole
> discretion."*

TechCrunch cita a Meta confirmando que el bot de atención de una empresa de
turismo "no será bloqueado". El veto apunta a quienes **distribuyen asistentes
de dominio abierto** (OpenAI, Perplexity, Luzia, Poke), no a negocios que
atienden a sus propios clientes.

**Caveat:** la línea "primary vs incidental" la juzga Meta "a su sola
discreción" — no es una regla bright-line. Un bot **posicionado/vendido como
asistente de propósito general** sí podría caer en el veto. Mantené el bot
acotado al negocio de la gráfica.

Fuentes: [Business Solution Terms](https://www.whatsapp.com/legal/business-solution-terms/),
[WhatsApp Business Policy](https://whatsappbusiness.com/policy/),
[TechCrunch 2025-10-18](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/),
[respond.io](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban)

---

## 2. La ventana de 24 hs y las plantillas

### Dentro de la ventana: automatización permitida (confianza: alta)

> Política verbatim: *"You may use automation when responding during the 24-hour
> window, but must also have available prompt, clear, and direct escalation
> paths."*

Es decir: el bot/IA puede responder libre **dentro de la ventana**, pero Meta
**exige** dar un camino claro y rápido de **derivación a humano** (transferencia
en el chat, teléfono, email, web, presencial o formulario). Es **obligatorio**,
no opcional. Los mensajes libres (de servicio) dentro de la ventana **no
requieren pre-aprobación**.

### Cómo funciona la ventana (confianza: alta)

> Docs de Meta verbatim: *"When a WhatsApp user messages you or calls you, a
> 24-hour timer called a customer service window starts. If the user messages or
> calls you again before the timer expires, the timer resets to 24 hours."*

- La ventana **abre** cuando el cliente te escribe (o llama).
- **Se resetea a 24 hs nuevas con cada nuevo mensaje entrante del cliente.**
- **NO** se resetea cuando vos respondés.
- Conversaciones que entran por anuncio/click-to-WhatsApp o botón de página: 72 hs.

### Fuera de la ventana: solo plantillas (confianza: alta)

> *"Outside of a customer service window, you may only send a message using an
> approved template."* / *"Template messages are the only type of message that
> can be sent to WhatsApp users outside of a customer service window."*

Esto es **agnóstico al autor**: da igual si lo escribió un humano o la IA. El
primer mensaje que **inicia el negocio** también requiere plantilla aprobada.
Consecuencia para la IA: el bot **no puede** re-enganchar proactivamente a un
cliente después de 24 hs con un mensaje libre — tiene que disparar una plantilla
aprobada.

Fuentes: [send-messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages),
[template-messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/template-messages/),
[YCloud](https://www.ycloud.com/blog/whatsapp-24-hour-conversation-window-explained)

---

## 3. ¿Cómo detecta Meta el spam? ¿Detecta que es IA?

**NO detecta que sea IA. Solo señales de comportamiento/calidad. (confianza: alta)**

> Política verbatim: *"People can block or report businesses and our systems will
> limit the amount of messages a business can send or calls a business can
> initiate if the business' quality tier is low for a sustained period of time."*

- **Quality rating** = sistema de 3 niveles **Verde / Amarillo / Rojo**, basado
  en el feedback de los destinatarios de los **últimos 7 días**: bloqueos,
  reportes, y razones de bloqueo (No Longer Needed, Didn't Sign Up, Spam,
  Offensive).
- **Ninguna doc de Meta lista "detección de texto IA" como señal de calidad.**
  Como los mensajes están cifrados end-to-end, Meta **no puede leer el contenido**
  para detectar quién lo escribió.
- **Distinción clave:** el veto a "AI Providers" (enero 2026) es una prohibición
  separada, basada en términos/caso-de-uso, que se hace cumplir por **revisión de
  app y suspensión** — NO por un detector de texto IA mensaje a mensaje.

Fuentes: [WhatsApp Business Policy](https://whatsappbusiness.com/policy/),
[Facebook Business Help](https://www.facebook.com/business/help/896873687365001),
[chatarmin](https://www.chatarmin.com/en/blog/whats-app-messaging-limits),
[wuseller](https://www.wuseller.com/blog/whatsapp-message-limits-quality-rating-explained/)

---

## 4. Prácticas concretas para no banear el número

**(confianza: alta)**

> Política verbatim: *"You may only contact people on WhatsApp if: (a) they have
> given you their mobile phone number; and (b) you have received opt-in
> permission... You must respect all requests (both within and outside WhatsApp)
> that people send to block, stop or otherwise unsubscribe."*

Checklist accionable para el flujo Chatwoot + n8n:

1. **Opt-in:** solo contactá a quien te dio su número **y** permiso. (Actualización
   nov-2024: se acepta opt-in general/no específico de WhatsApp si la ley local
   lo permite — afloja el *cómo*, no elimina el requisito.)
2. **Honrá los opt-out / STOP / bloqueos**, dentro y fuera de WhatsApp, incluido
   sacar a la persona de los contactos. → **Construí detección de opt-out en el
   flujo de n8n.**
3. **Mantené la IA reactiva dentro de la ventana** — que responda a mensajes
   entrantes genuinos. **No auto-blastees plantillas.**
4. **Nada de promos genéricas ni picos de volumen** repentinos. El **block rate**
   es la señal negativa de mayor peso — hasta ~1% de bloqueos en un broadcast
   puede bajar el número a Amarillo.
5. **Derivación a humano** siempre disponible y clara (requisito de Meta).

### Nota de costos (relevante para re-enganche IA) (confianza: alta)

Desde el cambio a precio por mensaje (1-jul-2025) y plantillas utility gratis
dentro de la ventana (1-abr-2025):

- Dentro de la ventana: mensajes libres de servicio + plantillas **utility** =
  **gratis**.
- Plantillas **marketing** y **authentication** = **pagas**, siempre.
- Implicancia: re-enganchar fuera de la ventana con plantillas **marketing**
  cuesta **y** es el mayor riesgo de spam/calidad. Re-enganchar con plantillas
  **utility** dentro de la ventana (ej. estado de pedido/cotización) es **gratis**
  y de menor riesgo.

Fuentes: [WhatsApp Business Policy](https://whatsappbusiness.com/policy/),
[uptail.ai](https://www.uptail.ai/blog/best-practices-for-whatsapp-business-messaging-the-rules-that-keep-you-effective-and-compliant),
[YCloud pricing](https://www.ycloud.com/blog/whatsapp-api-pricing-update)

---

## 5. SIM prepago vs número de negocio dedicado / verificación

**No concluyente — el research no encontró evidencia de primera fuente.**

Ninguno de los claims que sobrevivieron a la verificación aportó evidencia
específica sobre si un **SIM personal prepago** cambia materialmente el riesgo
de baneo frente a un número de negocio dedicado, ni sobre si el estado de
**verificación de negocio** altera el riesgo de baneo/throttling. Queda como
pregunta abierta (ver abajo). Pragmáticamente: las reglas que sí importan son las
de comportamiento de la sección 4, que aplican igual al número que uses.

---

## Caveats importantes

- **Alta sensibilidad temporal:** el veto a "AI Providers" rige para usuarios
  nuevos de la API desde **15-oct-2025** y para todos los existentes desde
  **15-ene-2026**; los términos se modificaron por última vez el **6-mar-2026**.
  Re-verificar antes de apoyarse en esto.
- La línea "primary vs incidental/ancillary AI" la juzga Meta "a su sola
  discreción" — sin garantía bright-line.
- **Excepciones geográficas:** el veto excluye números del EEE y Brasil; el
  regulador italiano (AGCM) ordenó a Meta el 24-dic-2025 frenar el veto allá
  mientras investiga por antitrust. (No afecta Argentina, pero muestra que está
  en flujo regulatorio.)
- Varios claims sobre el mecanismo de quality-rating y mejores prácticas se
  apoyan en parte en blogs de vendors (YCloud, wuseller, chatarmin, smsmode),
  aunque cada uno está corroborado por docs primarias de Meta o el Help Center.
- El claim "quality rating es independiente del volumen" fue voto dividido (2-1):
  la métrica en sí es por feedback, pero alto volumen sube indirectamente
  bloqueos/reportes y rige los tiers separados de "messaging limits" — el volumen
  igual importa en la práctica.

## Claims refutados (excluidos)

- ❌ NO existe un servicio first-party "Meta Business Agent" que confirme que las
  respuestas IA están permitidas (refutado 0-3).
- ❌ Las respuestas libres dentro de la ventana NO son irrestrictas — siguen
  aplicando las políticas de contenido (refutado 0-3).
- ❌ Un bot NO es compliant *solo si* es estrictamente estructurado — el gancho
  legal real es "funcionalidad principal", no la estructura de la conversación
  (refutado 1-2).

## Preguntas abiertas

1. ¿Qué dispara en la práctica que Meta clasifique un bot como "asistente de
   propósito general" prohibido vs "automatización específica de negocio"
   permitida — revisión en onboarding, declaración del BSP/embedded-signup, o
   revisión post-hoc? ¿Hay casos documentados de bots de negocio baneados bajo la
   cláusula de IA?
2. ¿El SIM prepago personal vs número de negocio dedicado cambia el riesgo de
   baneo? ¿La verificación de negocio altera el riesgo?
3. ¿Cómo interactúa el conteo de "mensajes sin responder" (señal de calidad
   agregada en 2026) con un bot que responde todo? ¿Ayuda responder siempre, y
   perjudica un backlog de entrantes sin responder durante caídas del bot?
4. Para re-enganche fuera de la ventana, ¿qué categorías exactas de plantilla
   utility califican como gratis vs cuáles Meta reclasifica como marketing
   (fuente frecuente de facturación inesperada y penalidades de calidad en flujos
   automatizados)?
