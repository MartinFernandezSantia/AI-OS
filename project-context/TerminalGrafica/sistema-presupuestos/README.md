# Sistema de Presupuestos (sub-proyecto de TerminalGrafica)

El sistema de presupuestos + digitalización de procesos para gráficas. Es el
**producto insignia** que Martin está productizando para vender a otras imprentas.
TerminalGrafica es el cliente piloto.

Repo de código: `quote-automation-system` (Next.js, Supabase, Vercel). Este
sub-proyecto de `project-context/` es la carpeta-compañera: contexto, decisiones
e investigaciones que no viven en el repo de código.

## Módulos

- **Presupuestos** — núcleo del sistema (cotización + digitalización de procesos).
- **Recepción de archivos** (`/mostrador` + kiosko) — el cliente escanea un QR,
  abre una sesión y sube los archivos a imprimir; el mostrador los ve en un
  tablero en vivo y los descarga para imprimir. Hoy en prod bajo el **modelo
  broker** (server-side, service-role + token opaco de sesión; sin identidad
  Supabase del lado del kiosko). Detalle vivo en las memorias
  `tg-recepcion-archivos-status` y `tg-recepcion-cliente-status`.

## Stack / dónde corre

- **Frontend + API:** Next.js en **Vercel serverless**.
- **Base de datos + Realtime:** **Supabase free** (Postgres = metadata y estados;
  Realtime = tablero en vivo del mostrador).
- **Almacenamiento de archivos:** hoy Supabase Storage. **En migración a
  Cloudflare R2** (ver abajo).

## Trabajo en curso — migración de storage a R2

Disparador: el cliente necesita (1) subir archivos **> 50 MB** y (2) sacar el tope
de **200 MB por sesión**. El free de Supabase topea cada archivo en 50 MB (límite
duro), así que esto no se resuelve quedándose en Supabase free.

Decisión y arquitectura completas en
[r2-storage-migration.md](r2-storage-migration.md). Resumen:

- Mover **solo los bytes** a R2; Postgres + Realtime siguen en Supabase free.
- Costo a futuro: **~$0/mes** para una imprenta (R2 free 10 GB + egress gratis).
- Descarga de sesiones pesadas (hasta 5 GB) en un **zip único** armado por un
  worker fuera de Vercel y servido directo desde R2.

## Relación con otros sub-proyectos

- [whatsapp-automation](../whatsapp-automation/README.md) — el bot de WhatsApp
  debería integrarse con este sistema (recibir pedidos → recepción de archivos).

## Archivos de este sub-proyecto

- [r2-storage-migration.md](r2-storage-migration.md) — decisión, costos, latencia,
  investigación R2 vs Supabase y arquitectura de descarga (zip). Conversación del
  2026-06-22.

---

*Decisiones loggeadas relacionadas: `decisions/log.md` 2026-06-16 (mover storage a
R2) y 2026-06-17 (producto WhatsApp, asume storage en R2).*
