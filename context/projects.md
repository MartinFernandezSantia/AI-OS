# Registro de proyectos

Fuente única de verdad de todo lo que Martin tiene en juego. **Claude: leé este archivo
cada vez que Martin mencione un proyecto, ANTES de sugerir infra, presupuesto o recursos.**
La columna que más importa es **Infra y dueño** — es el semáforo que te frena antes de
asumir que algo existe o está disponible. Quién es cada cliente: `context/clients.md`.

_Última actualización: 2026-07-07._

## Regla del semáforo (leer primero)

Antes de proponer "usá tal VPS / servidor / cuenta / dominio" para un proyecto:

1. **Mirá la columna "Infra y dueño" de ESE proyecto.** No mezcles infra entre proyectos.
2. **🔴 Si la infra es de un cliente Y el proyecto no está confirmado → NO existe para vos.**
   No la propongas como recurso disponible, ni para ese proyecto ni para otro.
3. **"Mi VPS / mi servidor" hoy no existe.** Martin no tiene un VPS de producción propio.
   `chatwoot.silvercoastwebagency.com` es una **VM local de dev** suya por túnel, no prod.
4. **Cuentas mezcladas (a corregir):** los proyectos de TG y SantiaPropiedades viven hoy en
   las cuentas **personales** de Martin (Vercel + Supabase Free). Es un error conocido a
   separar; tenelo presente, no lo profundices.
5. Si vas a sugerir infra y no estás seguro del dueño/estado, **preguntá** en vez de asumir.

## Tabla maestra (ordenada por prioridad)

| # | Proyecto | Alias | Cliente | Tipo | Confirmado | Etapa | Infra y dueño |
|---|---|---|---|---|---|---|---|
| **1** | **Sistema de Presupuestos** | "sistema de presupuestos", "sistema de gráfica/imprenta", "sistema de TG" | Terminal Gráfica | Cliente | ✅ Sí | En producción + desarrollo activo. **Kiosko de recepción de clientes EN PROD desde ~2026-06-18, sin quejas.** Migración Storage → R2: Fase 1 construida (sin deployar), **en pausa esperando el VPS de TG** — el worker ZIP se construiría en el VPS (cambio vs plan original de Cloudflare Worker). | Supabase Free + Vercel — ⚠️ hoy en **cuentas personales de Martin** (a pasar a TG); R2/Cloudflare **en alta** (cuenta para TG). **Sin VPS propio del sistema** (el worker ZIP usará el KVM 4 del bot). |
| **2** | **WhatsApp / Chatwoot** | "el de Chatwoot para TG", "automatización de WhatsApp para TG" | Terminal Gráfica | Cliente | ✅ **Sí — VENDIDO (~fin jun-2026)**: USD 400 desarrollo + mantenimiento USD 30/mes o USD 300/año (moneda asumida USD — confirmar) | Dev local andando (bot v5) → construir prod. Go-live gates = P0 de `project-context/TerminalGrafica/whatsapp-automation/prod-readiness-review.md` | Dev = **VM local de Martin** + Cloudflare Tunnel (`chatwoot.silvercoastwebagency.com`). Prod = **Hostinger KVM 4 a nombre de TG — confirmado por la venta, AÚN SIN CONTRATAR**. WhatsApp Cloud API + API de IA a cuentas de TG. ⚠️ Desde el 1-oct-2026 Meta cobra los mensajes de servicio (pass-through de TG — avisar por escrito). |
| **3** | **SantiaPropiedades (Web)** | "Web SantiaPropiedades" | SantiaPropiedades (familia) | Familia / cliente | ✅ Sí | En producción, pendiente revisiones/mejoras | Cuentas **personales de Martin** — Vercel + Supabase Free. Alcance: Web + Google Business Profile + ZonaProp + Instagram (por hacer). _Archivos no están en esta máquina._ |
| **4** | **Niche-News-Agent** | "el agente de noticias", "el digest" | — | Personal | n/a | Diseñado, sin construir | Arranca **local**; si funciona → servidor. n8n + Telegram + RSS/GoogleNews/GDELT/RSSHub. 2º trabajo de Hermes. |
| **5** | **Social-Engagement-Copilot** | "el copilot de social", "lo de Reddit/LinkedIn" | — | Personal | n/a | Research hecho, sin construir | Una cuenta real envejecida, modo asistido (agente borra, Martin postea). 1er trabajo de Hermes. |
| **6** | **Personal-CRM** | "el CRM" | — | Personal | n/a | Diseñado, sin construir | Self-hosted, **nada concreto existe todavía**. Supabase + Telegram + Whisper local. Sin VPS. |
| — | **SilverCoastWebAgency** | — | — | Personal (NO es su marca) | n/a | **Cerrado como proyecto** — se creó solo para testear la automatización de WhatsApp. Su marca real será otro proyecto futuro. | Dominio `silvercoastwebagency.com` **de Martin** (vía Vercel, en Cloudflare para túneles + ZeroTrust en subdominios). El dominio sigue **vivo** y es lo que usa el demo de Chatwoot. |

## Dueño de infra — resumen rápido

**🟢 De Martin (propio, disponible hoy):**
- Dominio `silvercoastwebagency.com` (Vercel + Cloudflare ZeroTrust). Lo usa el demo de Chatwoot.
- VM local de dev (corre el Chatwoot de demo vía túnel — NO es prod).
- ⚠️ Cuentas personales de Vercel + Supabase Free donde **hoy viven proyectos de cliente**
  (TG y SantiaPropiedades). Error conocido a separar.
- ❗ **No hay VPS de producción propio.** No lo asumas.

**🟡 De cliente / confirmado pero AÚN NO operativo:**
- **Hostinger KVM 4** de TG — **confirmado por la venta del bot (jul-2026), todavía sin
  contratar.** Cuando exista: Chatwoot + n8n del bot, y el worker ZIP de R2. Solo para
  proyectos de TG — nunca compartirlo con otros clientes o proyectos personales.
- Cuenta **Cloudflare / R2** para TG — **en proceso de alta** (todavía no operativa).

## Notas

- **Hermes** (el "doer" siempre-activo) todavía no está levantado. Social-Engagement-Copilot
  sería su primera necesidad unattended real. No es un proyecto, es una capa de infra.
- El **Sistema de Presupuestos** es la base de operaciones de TG: los demás módulos del
  cliente (recepción de archivos/clientes, y a futuro Chatwoot) se montan sobre él.
- La **versión productizada** del sistema (para revender a otras imprentas) es un **track
  aparte** del install de TG; todavía no está en desarrollo.
- Cuando un estado cambie (TG confirma Chatwoot, se separan las cuentas, se levanta un VPS),
  actualizá esta tabla **y** la memoria persistente en el mismo momento.
