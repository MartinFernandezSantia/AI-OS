# Registro de clientes

Quién es quién, para reconocer de qué cliente habla Martin en una conversación. Un cliente
puede tener varios proyectos. Los proyectos viven en `context/projects.md`; acá va el dueño.

_Última actualización: 2026-06-24._

## Reglas de trato (leer primero)

- **SantiaPropiedades: referirse SIEMPRE por el nombre del negocio.** Nunca como "el negocio
  de tu papá" / "lo de tu padre", aunque el dueño sea el padre de Martin. Es un cliente.
- Distinguir bien **TG (cliente real, confirmado)** de sus proyectos no confirmados: el
  sistema de presupuestos está confirmado; el de Chatwoot/WhatsApp todavía no.

---

## Terminal Gráfica (TG)

- **Negocio:** Terminal Gráfica — alias **TG** / ".tg". Imprenta / gráfica.
- **Ubicación:** Mar del Plata, Buenos Aires.
- **Contacto / dueño:** Nacho (el dueño).
- **Relación:** **Primer cliente, activo y confirmado.** El dueño (Nacho) es actualmente jefe
  de Marcos, un amigo de Martin que trabaja ahí como empleado.
- **Cómo lo menciona Martin:** por nombre o alias de negocio (Terminal Gráfica, TG).
- **Cuentas / infra (estado real):**
  - Supabase **Free tier** — Martin tiene acceso.
  - Vercel donde están alojados los proyectos = **cuenta personal de Martin** ⚠️ (error a
    corregir más adelante: debería pasar a nombre de TG).
  - Cloudflare — **en proceso de alta** para storage R2 + worker gratuito.
  - **A futuro:** un Hostinger **KVM 2** para n8n, Chatwoot y Workers/Cron sueltos
    (solo si confirma el proyecto de Chatwoot).
- **Proyectos vinculados:**
  - **Sistema de Presupuestos** (quote-automation-system) — sistema principal; pensado como
    **base de operaciones** sobre la que se van montando otros módulos.
  - **Recepción de clientes / recepción de archivos** — módulos atados al sistema de presupuestos.
  - **Chatwoot + n8n (WhatsApp)** — a futuro, sin confirmar; luego otros canales (email, Instagram).

## SantiaPropiedades

- **Negocio:** SantiaPropiedades — inmobiliaria de Mar del Plata.
- **Relación:** familia — el padre de Martin es el dueño y martillero a cargo.
  **Tratar siempre por el nombre del negocio, no como "su papá".**
- **Cómo lo menciona Martin:** nombre del negocio.
- **Alcance del que se hace cargo Martin:** Web, Google Business Profile, ZonaProp,
  Instagram (por hacer). _Los archivos del proyecto no están en esta máquina._
- **Cuentas / infra:** cuentas **personales de Martin** — Vercel + Supabase Free.

## Personal (Martin)

Proyectos sin cliente externo (CRM, agente de noticias, copilot de social). Infra a nombre
de Martin, self-hosted / local. Ver `context/projects.md`.
