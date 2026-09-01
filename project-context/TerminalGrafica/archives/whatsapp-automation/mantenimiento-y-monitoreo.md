# Mantenimiento y monitoreo — WhatsApp Automation (Chatwoot + n8n)

Guía operativa para correr el sistema self-hosted con la **menor carga manual
posible**. Responde dos preguntas: cuánto mantenimiento real exige por año, y
cómo automatizar la detección de "algo se rompió / hay que actualizar".

Contexto de infra: VM local que espeja un **Hostinger KVM 2** (target de prod),
Chatwoot + n8n + Postgres + Redis en Docker, expuesto vía Cloudflare Tunnel.

---

## 1. Carga de mantenimiento esperada (investigado 2026-06-29)

Ventana analizada: jun 2025 → jun 2026, contando solo lo **indispensable**
(seguridad o "se rompe"), no features nuevas.

| Sistema | Updates forzados / año | Detalle |
|---|---|---|
| **Chatwoot** | **2** | Releases mensuales, pero solo 2 por seguridad: v4.11.2 (SQLi, alta, CVE-2026-44706) y v4.13.0 (account takeover OAuth, CVE-2026-44707). Parchean CVEs en silencio → el 2 es piso, no techo. |
| **WhatsApp Cloud API** | **1** | Cada versión de Graph API dura ~2 años. Único deber: bumpear el número de versión en las URLs antes de su sunset (ej. v19.0 muere 21-may-2026). Es cambiar un string. La muerte de la On-Premises API (oct 2025) NO aplica: ya estamos en Cloud API. |
| **Gemini (vía OpenRouter)** | **0** (1 viene) | El estable `gemini-2.5-flash-lite` no se retiró este año (solo sus previews). Shutdown agendado **16-oct-2026** → migración forzada a `gemini-3.1-flash-lite` en ~3,5 meses. |
| **Total app-layer** | **~3 / año** | |

Ampliando a infra (SO, contenedores, backups): apuntar a **6-12 toques/año**
según cuánto se automatice. Con auto-parcheo del SO + watch de advisories +
fallback de modelos, ~6 es honesto.

### Contenedores (Docker / Postgres / Redis)
- **Motor de Docker** = paquete del SO → lo parchea `unattended-upgrades`. Las
  **imágenes** se actualizan aparte (`docker compose pull && up -d`).
- **Postgres**: menores (16.4→16.6) = pull + restart, trivial, traen los parches.
  Mayores (16→17) = migración con pg_upgrade, pero cada mayor tiene 5 años de
  soporte → 1 vez cada 2-3 años, planificado, con backup.
- **Redis**: bajo riesgo (cache/colas, no fuente de verdad). Pull + restart.
- **Regla de oro:** nunca tag `:latest` (puede saltar mayor y romper). Pinear la
  mayor explícita y seguir el compose oficial de Chatwoot al actualizar.
- No suma eventos: los contenedores se actualizan en el mismo toque que Chatwoot.

### n8n
- No perseguir cada release. Pinear versión que funcione, seguir solo los
  **security releases**, saltar 1-2 veces/año **testeando el funnel después**
  (un upgrade puede romper workflows).

---

## 2. Almacenamiento — qué llena el disco y cómo se gestiona

Por defecto **todo queda en el VPS**. Lo que crece, en orden:

1. **Adjuntos (Active Storage)** — archivos que mandan los clientes. Chatwoot
   NO los borra; viven mientras viva la conversación. El que más crece.
2. **Logs de Docker** — el clásico asesino de disco si no se capan.
3. **Imágenes viejas de Docker** — quedan tras cada `pull`.
4. **Postgres** (texto, MB a pocos GB en años) y **Redis** (chico): no son
   problema por mucho tiempo.

**Se gestiona con 3 configuraciones que se ponen una vez (set-and-forget):**
- **Adjuntos → R2**: apuntar `ACTIVE_STORAGE_SERVICE=s3` (R2 es S3-compatible).
  Los archivos nuevos van a R2, el VPS deja de llenarse. Encaja con el laburo de
  R2 ya en curso.
- **Log rotation de Docker**: `max-size` + `max-file` en `daemon.json`.
- **Prune de imágenes**: `docker system prune -af` en cron mensual (o post-upgrade).

En un KVM 2 (~100GB) y al volumen de la imprenta (~900 conv/mo), con esos tres
ajustes el disco deja de ser trabajo manual por años.

---

## 3. Monitoreo — arquitectura de dos capas

**Regla de oro: el LLM NO va en el camino crítico de "¿está caído?".** Si el
detector vive en el mismo VPS y el VPS cae, el detector cae con él. La detección
es **tonta, externa y determinística**. Hermes va encima, como inteligencia.

### Capa 1 — Detección (herramientas, sin agente). Hacer ahora.
Todo open-source, self-host, gratis. Notifica a **un solo canal de Telegram**.
- **Uptime Kuma** — HTTP del Chatwoot + webhook del bot, TCP de Postgres/Redis.
- **Netdata** — métricas del host con alertas listas: disco (clave), CPU, RAM,
  contenedores caídos.
- **Dead-man's-switch de backups** — el cron de backup pinga a Kuma al terminar
  bien; si no llega ping en 25h, Kuma alerta. Así te enterás si el backup murió
  en silencio.
- **Ping externo** — desde afuera del VPS, para el caso "VPS entero muerto" que
  Kuma on-box no puede reportar.

Esta capa funciona aunque Hermes no exista y aunque el LLM esté caído.

### Capa 2 — Inteligencia (Hermes, el agente).
Las dos cosas que requieren juicio y lenguaje natural, no detección:
1. **Digest semanal de seguridad** (cron 1x/semana) — busca CVEs/advisories
   nuevos sobre el stack pinneado (Chatwoot, n8n, Postgres, Redis, WhatsApp API,
   Gemini, Ubuntu), filtra lo que afecta vs ruido, manda a Telegram un "nada que
   hacer" o "salió CVE en X, actualizá". Barato (~centavos/corrida). **Es el
   primer job real de Hermes** (ver decisión 2026-06-29).
2. **Triage de alertas** (fase 2) — interpreta las alertas de la Capa 1,
   deduplica flapping y las traduce a criollo con recomendación de acción.

### Secuencia
1. **Ahora:** Capa 1 (Kuma + Netdata + dead-man's-switch + ping externo) → Telegram.
2. **Después:** digest semanal de seguridad como primer job de Hermes.
3. **Más adelante:** triage de alertas con Hermes encima de Kuma.

---

## 4. Backups (referencia rápida)

- Cron diario: `pg_dump` de Postgres (Chatwoot) → gzip → **cifrar (gpg)** → subir
  a **R2** con `rclone`/`aws s3 cp`. Retención con lifecycle rules de R2.
- **Backupear también la encryption key de n8n** (sin ella, las credenciales
  restauradas son inservibles) y los workflows de n8n.
- **Un backup que no probaste restaurar no es un backup** — test de restore cada
  tanto. Es el error #1.

---

## 5. Capa 3 — calidad de decisiones del bot (loop de mejora)

> Distinta de las capas 1-2: esas responden "¿está caído?" y "¿salió un CVE?". Esta responde **"¿el bot está decidiendo bien?"**. Se instrumenta junto con el acceso al catálogo (roadmap §1, decisión 2026-06-29). Nace del red-team adversarial: el riesgo no es técnico, es el **precio fantasma** y el **falso negativo invisible** (la venta que el bot mata en silencio).

**Principio de diseño: el ground truth NO puede depender del etiquetado voluntario del agente** (muere en la semana 2 con la gente atendiendo el mostrador). Todo lo posible sale de señales automáticas; lo poco manual es forzado y mínimo.

### Qué se loguea (tabla `bot_decisiones`, automático)
Por cada interacción relevante (detalle de columnas en `../data-model.md`):
- Mensaje crudo del cliente, producto resuelto (o ninguno), top-3 candidatos del SQL con su score.
- Acción tomada (informó precio / informó capacidad / repreguntó / handoff).
- Señales automáticas: filas devueltas por SQL (0 = candidato a falso negativo), si hubo handoff, si el cliente respondió después del handoff, tiempo a primera respuesta humana.

### Señales derivadas (sin que nadie toque nada)
- **Candidato a falso negativo:** consulta con match razonable (top-3 con score) que igual no cerró.
- **Venta muerta (proxy):** conversación que termina sin handoff y el cliente no vuelve a escribir en 48h tras una negativa/no-cierre.
- **Cola de carga:** top consultas con 0 filas + top términos que llevaron a handoff = qué sinónimos/productos faltan en `bot_catalogo`.

### Digest semanal (vía Hermes, junto al digest de seguridad)
Arranca con lo que importa, no con métricas de vanidad:
1. **5 conversaciones perdidas al azar** (entre negativas / escalas-sin-cierre) → Martin marca en 2 min "era venta / no era". **Ese es el ground truth** y de paso calibra el umbral. Muestreo forzado, no voluntario.
2. Cola de carga (sinónimos/productos faltantes).
3. Métricas en plata: consultas resueltas solas, handoffs maduros generados, candidatos a venta perdida.

### Cómo mejora el bot con esto
- Términos no reconocidos → se agregan como sinónimos en `bot_catalogo` → la próxima vez son hit de N1 (se cura casi solo).
- Si el muestreo muestra que escala de más o de menos → se ajusta el prompt / umbral.
- En ~1 mes, con frases reales, eval en **promptfoo** (ya en el repo) para afinar umbral y decidir si pgvector aporta sobre sinónimos+LLM.
- El loop es lo que permite **prender features con confianza por fases** (ej. cálculo de precios con reglas): primero se mira funcionar, después se suelta.

---

## Accionables pendientes

- [ ] Cambiar el slug pinneado de Gemini en n8n por un array de fallback
      `["google/gemini-2.5-flash-lite", "google/gemini-3.1-flash-lite"]` o un
      preset de OpenRouter → convierte la migración forzada de oct-2026 en cambio
      de cero esfuerzo. (Antes del 16-oct-2026.)
- [ ] Suscribirse a los security advisories de Chatwoot (GitHub watch → Security).
- [ ] Capa 1 de monitoreo: Uptime Kuma + Netdata + dead-man's-switch + ping externo → Telegram.
- [ ] Backups: cron pg_dump cifrado → R2 + backup de la encryption key de n8n + test de restore.
- [ ] Activar `unattended-upgrades` (canal `-security`) + auto-reboot 4am + log rotation Docker + cron de prune.
- [ ] Mover adjuntos de Chatwoot a R2 (`ACTIVE_STORAGE_SERVICE=s3`).
- [ ] Hermes: digest semanal de seguridad (primer job).
- [ ] Capa 3: instrumentar `bot_decisiones` desde el día 1 del acceso al catálogo (roadmap §1) + sumar el digest de calidad del bot al digest semanal de Hermes (5 conversaciones perdidas al azar para muestreo forzado).

_Fuentes de la investigación 2026-06-29: GitHub releases/advisories de Chatwoot,
Meta Graph API versions page + On-Premises sunset, Google Gemini deprecations page._
