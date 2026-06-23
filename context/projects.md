# Registro de proyectos

Fuente única de verdad de todo lo que Martin tiene en juego. **Claude: leé este archivo
cada vez que Martin mencione un proyecto, ANTES de sugerir infra, presupuesto o recursos.**
La columna que más importa es **Infra y dueño** — es el semáforo que te frena antes de
asumir que algo existe o está disponible.

_Última actualización: 2026-06-23._

## Regla del semáforo (leer primero)

Antes de proponer "usá tal VPS / servidor / cuenta / dominio" para un proyecto:

1. **Mirá la columna "Infra y dueño" de ESE proyecto.** No mezcles infra entre proyectos.
2. **🔴 Si la infra es de un cliente Y el proyecto no está confirmado → NO existe para vos.**
   No la propongas como recurso disponible, ni para ese proyecto ni para otro.
3. **"Mi VPS / mi servidor" hoy no existe.** Martin no tiene un VPS de producción propio.
   Lo que parece servidor (`chatwoot.silvercoastwebagency.com`) es una **VM local de dev**
   suya, expuesta por Cloudflare Tunnel. No es prod ni es compartible entre proyectos.
4. Si vas a sugerir infra y no estás seguro del dueño/estado, **preguntá** en vez de asumir.

## Tabla maestra

| Proyecto | Cómo lo menciona Martin | Tipo | Cliente | Confirmado | Etapa | Prioridad | Infra y dueño |
|---|---|---|---|---|---|---|---|
| **TG — Sistema de Presupuestos** | "quote-automation", "el sistema de presupuestos", "lo de la imprenta" | Cliente | Terminal Gráfica (imprenta) | ✅ Sí — flagship | En desarrollo (productizando) | 🔴 TOP | Supabase free (Postgres + Realtime + Storage) en **cuentas de Martin/proyecto**; hosting Vercel; **R2 pendiente** de implementar para storage pesado. **Sin VPS.** |
| **TG — WhatsApp / Chatwoot** | "el de Chatwoot", "la automatización de WhatsApp", "el bot de la imprenta" | Cliente | Terminal Gráfica (misma imprenta) | ⚠️ **NO** — propuesta sin OK | Demo/dev local | Media | 🔴 Dev = **VM local de Martin** + Cloudflare Tunnel (`chatwoot.silvercoastwebagency.com`). Prod target = **Hostinger KVM 2 a nombre del CLIENTE, NO confirmado → NO contar con él**. WhatsApp Cloud API + API de IA van a cuentas del cliente. |
| **SantiaPropiedades** | "lo de mi viejo", "la inmobiliaria", "el sitio de papá" | Personal / familia | Papá (inmobiliaria) | ✅ Sí | Activo (sitio + SEO/social) | 4 | Sitio web + assets; SEO/GEO. Hosting a definir. Cuentas a nombre de la familia. |
| **SilverCoastWebAgency** | "mi agencia", "Silver Coast", "mi marca" | Personal (marca de Martin) | — (es de Martin) | ✅ Sí | Marca / identidad | Soporte | Dominio `silvercoastwebagency.com` **de Martin** (única infra propia real hoy). |
| **Personal-CRM** | "el CRM", "mi CRM de contactos" | Personal | — | n/a | Diseñado, sin construir | Stand-by | Supabase (3 tablas) + Telegram + Whisper local. Cuentas de Martin. Sin VPS. |
| **Niche-News-Agent** | "el agente de noticias", "el digest" | Personal | — | n/a | Diseñado, sin construir | Stand-by | n8n (correría en VM local) + Telegram + RSS/GoogleNews/GDELT/RSSHub. 2º trabajo de Hermes. |
| **Social-Engagement-Copilot** | "el copilot de social", "lo de Reddit/LinkedIn" | Personal | — | n/a | Research hecho, sin construir | Stand-by | Una cuenta real envejecida en modo asistido (agente borra, Martin postea). 1er trabajo de Hermes. |

## Dueño de infra — resumen rápido

**🟢 De Martin (propio, disponible hoy):**
- Dominio `silvercoastwebagency.com`.
- VM local de dev (corre el Chatwoot de demo vía túnel — NO es prod).
- Cuentas Supabase free de los proyectos; n8n local si se levanta.
- ❗ **No hay VPS de producción propio.** No lo asumas.

**🔴 De un cliente / NO disponible:**
- **Hostinger KVM 2** del cliente de Chatwoot — a nombre del cliente, **propuesta sin confirmar**.
  No contar con él para nada (ni para ese proyecto ni para otros como R2 de quote-automation).
- WhatsApp Cloud API + API de IA del proyecto Chatwoot — irían a cuentas del cliente.

## Notas

- **Hermes** (el "doer" siempre-activo) todavía no está levantado. Social-Engagement-Copilot
  sería su primera necesidad unattended real. No es un proyecto en sí, es una capa de infra.
- Cuando un estado cambie (cliente confirma, proyecto pasa a prod, se levanta un VPS),
  actualizá esta tabla **y** la memoria persistente en el mismo momento.
- Granularidad: TG tiene dos sub-proyectos que se mencionan distinto pero comparten cliente.
  Tratalos como filas separadas — su estado y dueño de infra difieren.
