# WhatsApp Automation — Chatwoot + n8n (sub-proyecto de TerminalGrafica)

Producto de automatización de WhatsApp para gráficas: bot de atención reactiva
que responde consultas (precios, formatos, horarios, pagos, tiempos de entrega)
con IA, sobre la WhatsApp Business Cloud API oficial, y deriva a una persona
cuando hace falta. Se monta sobre **Chatwoot** (bandeja + canal) + **n8n**
(automatizaciones) + un modelo open-weights mid-tier para redactar respuestas.

Es el primer despliegue real del producto que Martin quiere productizar y vender
a otras gráficas. TerminalGrafica es el cliente piloto (precio fundador a cambio
de testimonio + caso de éxito).

## Stack decidido (decisions/log.md 2026-06-17)

WhatsApp Cloud API (oficial) + Chatwoot Community + n8n, self-hosted.

## Dónde corre

- **Hoy:** una VM local que espeja los recursos de un **Hostinger KVM 2** (target
  de producción, confirmado 2026-06-19 — reemplaza al Hetzner CPX31 originalmente
  logueado).
- Chatwoot expuesto vía **Cloudflare Tunnel** (`cloudflared` en la VM) en
  `chatwoot.silvercoastwebagency.com`.
- **Cloudflare Zero Trust** en todo MENOS el path de webhooks (abierto para que
  Meta/WhatsApp puedan llegar).

## Estado de implementación

### Hecho ✅
- Chatwoot instalado y corriendo en la VM, con usuario creado.
- Expuesto por Cloudflare Tunnel + Zero Trust (webhooks abiertos).
- **WhatsApp ↔ Chatwoot conectado end-to-end (2026-06-22):** recibe y responde
  mensajes reales. Número = SIM prepago registrado en Meta Cloud API. Token en
  Chatwoot = System User token permanente (`whatsapp_business_messaging` +
  `whatsapp_business_management`).

### En progreso 🔧
- **n8n / capa de automatizaciones (2026-06-25):** setup guide + flow v1 creados en
  `n8n/`. Próximo paso: instalar n8n en el VM (ver `n8n/setup-guide.md`), completar
  el system prompt (`n8n/prompts/system-prompt-tg.md`) e importar el flow.
  - Flow v1 = Chatwoot webhook → filtros → historial → Gemini Flash-Lite (OpenRouter) → reply / escalar
  - Modelo elegido: `google/gemini-2.0-flash-lite-001` vía OpenRouter (provider-agnostic)

### Falta 🔲
- **Completar e importar flow n8n** — fill in system prompt con datos reales de TG, instalar n8n.
- **Verificación de negocio en Meta** — diferida hasta escalar (el acceso estándar
  alcanza para volumen bajo).
- **Limpieza pendiente:** borrar el `~/.cloudflared/config.yml` viejo, los records/
  hostname del tunnel de `martinfs.dev` (instrucciones en `n8n/setup-guide.md` sección 9).

## Notas de setup / gotchas

- **Migración de dominio (2026-06-21):** `martinfs.dev` (comprado por Vercel)
  expiró y Vercel no dejó renovar. Migrado todo a `silvercoastwebagency.com`
  (Vercel → nameservers de Cloudflare). El tunnel es account-level así que siguió
  sirviendo; el hostname nuevo necesitó (a) un `CNAME chatwoot →
  <tunnel-uuid>.cfargotunnel.com` proxied creado a mano —
  `cloudflared tunnel route dns` lo creó mal porque el cert.pem estaba scopeado
  solo a martinfs.dev— y (b) agregar el hostname al ingress de `cloudflared`.
  **Gotcha que costó tiempo:** existían dos config.yml
  (`~/.cloudflared/config.yml` y `/etc/cloudflared/config.yml`); el servicio lee
  `/etc/cloudflared/`, editar el de `~` no hacía nada.
- **Conectar WhatsApp (2026-06-22):** la app de Meta deja de entregar webhooks
  reales mientras está en dev-mode/unpublished. Lo destrabó: (a) crear una
  Facebook Page, (b) conectar un medio de pago a la cuenta de Meta, (c) gotcha
  AR: agregar el **`9` entre `+54` y el número** (formato de mensajería de móvil
  argentino). Walkthrough usado: https://www.youtube.com/watch?v=kY4qrkIe9f0

## Compliance Meta + IA (resumen operativo)

Detalle completo y citado en
[research/meta-ai-whatsapp-reglas-y-riesgo-baneo.md](research/meta-ai-whatsapp-reglas-y-riesgo-baneo.md).
Reglas que fijan el diseño del bot:

- **IA reactiva = compliant.** El veto de Meta apunta a asistentes de propósito
  general; un bot acotado al negocio (FAQs, cotizaciones, estado de pedido) está
  permitido. No posicionarlo nunca como asistente general.
- **El riesgo de baneo es comportamiento, no IA.** Meta no puede detectar texto
  IA (cifrado E2E). Se banea por bloqueos/reportes/spam/picos de volumen (quality
  tier Verde/Amarillo/Rojo). → Lanzar reactivo, sin proactivo, sin promos.
- **Plantilla vs mensaje libre = estructural en la API, no interpretación.** El
  tipo va declarado en el request:
  - `{"type":"text",...}` (texto que la IA genera al vuelo) → la API lo acepta
    **solo si la ventana de 24 hs está abierta**; si no, error **`131047`**.
  - `{"type":"template","template":{"name":...}}` → único tipo aceptado **fuera**
    de la ventana; referencia una plantilla pre-aprobada (puede tener variables).
- **Ventana de 24 hs:** se calcula sobre el **último** mensaje entrante del
  cliente; se resetea con cada nuevo entrante; las respuestas del negocio NO la
  resetean. Bot puramente reactivo dentro de ventana = nunca toca plantillas.
- **Opt-out NO necesario para reactivo** (opt-in implícito, no hay lista). Solo
  obligatorio si se agrega mensajería proactiva.
- **Derivación a humano = obligatoria** si se usa automatización (requisito Meta).

## Plantillas pre-producción (checklist)

Cargar en Meta **antes** de salir a prod (aprobación: minutos a ~24 hs). Todas en
español (`es` / `es_AR`), categoría **Utility** (gratis dentro de ventana, bajo
riesgo). Para que queden Utility y no Marketing: cero lenguaje promocional,
siempre atadas a un pedido/evento, con variables para los datos.

**Mínimo viable (lanzar con estas 3):**

- [ ] **Cotización lista** — `Hola {{1}}, tu cotización para {{2}} está lista:
  {{3}}. ¿Querés que avancemos?`
- [ ] **Pedido listo para retirar** — `{{1}}, tu pedido {{2}} ya está listo para
  retirar en {{3}}. Horario: {{4}}.`
- [ ] **Arte/diseño para aprobar** — `{{1}}, te enviamos la prueba de tu {{2}}
  para tu aprobación. ¿La confirmás para producción?`

**Opcionales (sumar según necesidad):**

- [ ] **Cambio de estado de producción** — `{{1}}, tu pedido {{2}} entró en
  producción. Entrega estimada: {{3}}.`
- [ ] **Recordatorio de pago / seña** — tono neutral (no de cobro) para que quede
  Utility.
- [ ] **Retomar conversación caída** — una sola, suave, sin insistir.

**NO al lanzar:** cualquier plantilla **Marketing** (ofertas, descuentos,
"volvé a comprar") — se paga siempre y concentra el riesgo de baneo. Dejar para
canal maduro con opt-in explícito.

## Archivos de este sub-proyecto

- [prod-readiness-review.md](prod-readiness-review.md) — review de producción
  (2026-07-07): punch list P0/P1/P2 para llevar el v5 a nivel mercado en el
  KVM 4. ⚠️ Incluye el cambio de pricing de Meta del 1-oct-2026 (mensajes de
  servicio pagos) que rompe el "~USD 0" de la propuesta.
- [propuesta-cliente.md](propuesta-cliente.md) — propuesta comercial para el
  cliente (precios, abono Base/Plus, puesta en marcha). ⚠️ Precio WhatsApp
  desactualizado desde el anuncio de Meta (ver review §1).
- `research/` — reportes de investigación (p. ej. políticas de Meta sobre IA en
  WhatsApp y riesgo de baneo).
- `n8n/setup-guide.md` — instrucciones paso a paso para instalar n8n y conectar con Chatwoot.
- `n8n/flows/faq-bot-v1.json` — workflow n8n importable (FAQ bot + escalación).
- `n8n/prompts/system-prompt-tg.md` — system prompt template para completar con datos de TG.

## Próximos pasos

1. Instalar n8n en el VM siguiendo `n8n/setup-guide.md`.
2. Completar el system prompt con los datos reales de TerminalGrafica.
3. Importar `n8n/flows/faq-bot-v1.json`, vincular credentials, activar y probar.
4. Iterar el system prompt según respuestas reales de la primera semana.
5. Cargar las plantillas Utility pre-producción en Meta (ver checklist más abajo).
6. Integrar con el sistema de cotizaciones (recepción de archivos → broker) cuando esté deployado.

---

*Detalle vivo en memoria: `chatwoot-whatsapp-impl-status`. Relacionado:
recepción de archivos (`tg-recepcion-archivos-status`), sistema que esto debería
integrar.*
