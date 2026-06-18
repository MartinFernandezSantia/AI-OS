# Decisions Log

Append-only record of meaningful decisions and why they were made. `/level-up` Phase 2 (Method interview) writes scoped automation specs here. You can also append manually whenever you decide something worth remembering.

**Format per entry:**

```
## YYYY-MM-DD — Short title

**Decision:** what was decided.

**Why:** the reasoning, constraints, and what would change your mind.

**Alternatives considered:** what else was on the table.

**Owner:** who's accountable.
```

Keep it terse. Future-you will thank present-you for capturing the *why*, not just the *what*.

---

## 2026-06-18 — Recepción de archivos: modelo broker (sin anon) consolidado en el sistema de presupuestos, EN PROD

**Decision:** El flujo de recepción de archivos de Terminal Gráfica (cliente sube archivos en mostrador) se unifica dentro de `quote-automation-system` con un **modelo broker server-side**, y quedó **en producción funcionando** (2026-06-18). Tres piezas:
- **Mostrador** = módulo interno `/mostrador` del sistema de presupuestos, reusando su auth (empleados/admin) y design system.
- **Kiosk** = app separada `recepcion-cliente`, ahora repo propio en GitHub **`MartinFernandezSantia/reception-kiosk`** (privado).
- **Broker** = route handlers `app/api/reception/**` con **service-role key** + token opaco por sesión (sha256, scoped, TTL 12h). El kiosk NO tiene identidad Supabase.
- **Anonymous sign-ins APAGADOS permanentemente.** Un proyecto Supabase compartido. Upstash Redis provisionado para rate-limit.

**Why:** Habilitar anon en el proyecto compartido exponía data del host (el trigger `handle_new_user` da `role='employee'` a cualquier usuario nuevo incluido anon; policies `clients_*` sin guard de is_anonymous → un anon podía leer PII de clientes y tocar presupuestos). El broker elimina la clase de problema entera: como nunca se crea identidad anónima, el blast radius desaparece de raíz y el host NO necesita hardening de RLS. La autorización vive en código auditado (los handlers), no en RLS sobre un anon. Un solo proyecto Supabase = menos costo y operación (decisión previa del dueño). Detalle técnico completo en `quote-automation-system/docs/decisions/ADR-002` y `docs/architecture/reception-upload-broker.md`.

**Alternatives considered:** (1) Habilitar anon + hardenear el host (modificar `handle_new_user` + ~13 policies): más riesgoso sobre el sistema vivo, mismo end-state. (2) Segundo proyecto Supabase para el kiosk: rechazado (un solo proyecto). (3) Storage world-writable sin identidad: cualquiera sube/lee/borra. Residual aceptado: el canal Broadcast `tg-recepcion` es público (filtra nombres/filenames a cualquier holder de la publishable key); hardening = canal privado + Realtime Authorization, v2. La app standalone `recepcion-archivos` quedó superseded y archivada en `projects/TerminalGrafica/_archive/`.

**Owner:** Martin.

## 2026-06-17 — Oferta de automatización de WhatsApp para gráficas: stack self-hosted + modelo instalación/abono, no competir por precio

**Decision:** Para vender automatización de WhatsApp (recibir pedidos + responder consultas) a gráficas en Argentina, el producto es un stack **self-hosted: WhatsApp Cloud API oficial + Chatwoot (Community, MIT) + n8n**, con un modelo de IA **open-weights de gama media (Llama 3.3 70B / Qwen vía OpenRouter o Groq)** para responder, todo orquestado por n8n e integrado al sistema de presupuestos/recepción de archivos del cliente. Conexión a WhatsApp **siempre por la Cloud API oficial** (nunca Baileys/whatsapp-web.js: riesgo de ban en un canal crítico). Infra: **VPS Hetzner CPX31** (4 vCPU/8GB, ~USD 10) + storage en **Cloudflare R2** (ya decidido, ver [2026-06-16]). Comercialización: **instalación una vez + abono mensual obligatorio** ("operación y mejora continua"), en ARS, posicionado como desarrollo custom L2. NO vender instalación suelta sin abono, y NO competir por precio contra SaaS genéricos tipo Aoki/Cliengo.

**Números (TC ref USD 1 ≈ ARS 1.450, jun-2026):** Cost-to-serve ~USD 18-30/mes por cliente (VPS ~15 + R2 ~1-3 + IA ~2-4; mensajes de WhatsApp ~0 asumiendo ventana de 24h). Instalación ARS 1.800.000 estándar / ARS 1.200.000 precio fundador (a cambio de testimonio + caso). Abono: Base ARS 100.000/mes, Plus ARS 160.000/mes. IA real a volumen de gráfica (300-600 conv/mes): ~USD 2-4/mes con modelo gama media; supuesto ~10k tokens in + 0.5k out por conversación resuelta (6 turnos, system ~2k reenviado).

**Why:** Self-hosted es un **activo replicable** (build once, sell many) con costo marginal bajo por cliente nuevo, a diferencia de revender margen de un SaaS. El abono recurrente ES el modelo de negocio (MRR) y el mantenimiento no es opcional de verdad (los tokens de Meta vencen, la API cambia; sin mantenimiento se rompe solo en semanas). El diferencial frente a Aoki/Cliengo no es precio sino **integración a la operación del cliente + datos en su poder**; competir por precio contra un SaaS a escala es perder. Cloud API oficial elimina el riesgo de ban. Modelo open-weights de gama media: Claude/GPT frontier son sobredimensionados para FAQs, y un 8B alucina precios/políticas; respeta además la regla de herramientas (open-source/self-hosteable, conectable). Hetzner CPX31 da 4 vCPU reales (Chatwoot come CPU) por menos que el renew de Hostinger; la latencia EU (~200ms) no afecta al bot (habla con Meta, no con el cliente final) y es tolerable en el panel interno.

**Alternatives considered:** Chatwoot plan Startups (USD 19/agente/mes — la API también está gratis en la Community, el plan solo te ahorra mantenimiento); Baileys/whatsapp-web.js (gratis pero ban = canal caído, descartado para producción); SaaS pago Aoki/Cliengo (más barato de entrada pero genérico, sin integración, revendés margen ajeno); VPS Contabo (más barato pero CPU inconsistente, malo para producción), Vultr/Hostinger São Paulo (mejor latencia AR, más caro), Oracle Cloud free (gratis pero cuotas/complejidad, no para cliente que paga); modelos Gemini Flash (más barato aún pero cerrado), Llama 8B (muy chico, riesgo de alucinar), Claude Haiku (bueno pero ~6x el costo del open-weights para esto).

**Owner:** Martin.

## 2026-06-16 — TG recepción-archivos: cuando se toquen los límites del free de Supabase, mover SOLO el storage a Cloudflare R2 (no pasar a Supabase Pro)

**Decision:** El plan de escalado preventivo para la app de recepción de archivos es: mantener Supabase free para Postgres (metadata + estados) y Realtime (tablero en vivo), y migrar **solo los bytes de los archivos a Cloudflare R2** vía URLs prefirmadas (browser → R2, subida y descarga directas). NO migrar a Supabase Pro ($25/mes fijos) solo por tocar límites. Disparador de migración: cuando el egress mensual de Supabase pase ~3-4 GB (no esperar al tope de 5 GB). Antes que nada, implementar política de borrado de archivos post-entrega para mantener el storage casi indefinidamente bajo 1 GB.

**Why:** El cuello de botella real del free de Supabase es el **egress (5 GB/mes; descargas, no subidas)**, no el almacenamiento. Para un workload con tanta descarga como subida, eso se agota rápido. R2 **no cobra egress nunca** y su free tier (10 GB storage, 1M Class A, 10M Class B) cubre de sobra una sola imprenta; pasado el free son centavos, no $25 fijos. R2 es S3-compatible (igual que Supabase Storage por debajo), así que el cambio de cliente es chico y Postgres+Realtime siguen gratis. AWS S3 se descarta porque cobra egress (~$0.09/GB), justo el costo a evitar.

**Alternatives considered:** Supabase Pro $25/mes (caro solo por bandwidth para un cliente chico); AWS S3 (cobra egress, peor encaje); Backblaze B2 (10 GB free, egress gratis vía Cloudflare Bandwidth Alliance — buena 2da opción, más plomería); self-host MinIO on-premise/VPS (cero egress, control total, pero carga operativa/backups — plan C).

**Owner:** Martin.

## 2026-06-15 — Terminal Gráfica `.tg` logo-reveal sting: final frame + 3s bounce video

**Decision:** Locked a 16:9 logo-reveal for Terminal Gráfica's `.tg` mark. Final still = `project-context/TerminalGrafica/assets/tg-logo-reveal-final-frame.png` (deep dark bg, two white halo rings, central glow; Nano Banana Pro at 2k). Final video = `…/assets/tg-logo-reveal-3s.mp4` (wan2_7, 1080p, 3s, silent): empty dark → logo pops in and bounces a couple of times → settles on the still. The still was generated single-shot with the logo passed as a reference; the bounce-into-existence motion came from making that still the END frame (a generated dark plate as the start frame). Added repo-level tooling — `sharp` + `@resvg/resvg-js` and `scripts/` helpers — to rasterize/composite the SVG logo.

**Why:** Martin wanted a quick, punchy brand sting. Letting the video model use the resting frame as the *last* frame (not the first) is what produces a real "appears from nothing" reveal; a single start image only animates an already-present logo. Used non-premium models with a real credit estimate per the Higgsfield preflight gate; Nano Banana Pro (premium) was an explicit, justified call for 2k source fidelity. Note: the AI re-render rendered the leading dot as a colon `:` — accepted by Martin, but the standing lesson is to composite the real vector when glyph fidelity must be exact.

**Alternatives considered:** Compositing the exact logo over a generated plate (guaranteed glyphs, but Martin chose single-gen); single start-image animation (no real reveal, bounce barely perceptible); 4s duration for crisper multi-bounce (offered; Martin kept 3s).

**Owner:** Martin.

## 2026-06-15 — On WSL, Node + pnpm come from pnpm's own installer, not corepack/nvm

**Decision:** On this WSL2 box the pnpm-prescribed `corepack enable` path is dead — the only `corepack` on PATH is the Windows one (`/mnt/c/Program Files/nodejs/corepack`), which fails under WSL with a CRLF `/bin/sh^M: bad interpreter` error. So pnpm is installed as a **standalone binary** (`~/.local/share/pnpm`, bundles its own Node) and the native Linux Node is installed via **`pnpm runtime set node lts -g`** (currently v24.16.0). Updated `SETUP.md` to document this WSL reality instead of the generic corepack/nvm instructions.

**Why:** `pnpm install` was failing at exit 127 — `@higgsfield/cli`'s postinstall runs `node install.js`, but no native Linux `node` existed (pnpm's bundled Node isn't exposed as a `node` command for child scripts, and the only PATH `node` was the un-invokable Windows one). Installing a Linux Node fixed it. Using `pnpm runtime` keeps Node in pnpm's own dir (already on PATH), needs no extra tool, and is reversible — it's a runtime prerequisite, not a repo dependency, so it respects the repo-level tooling rule.

**Alternatives considered:** `nvm`/`fnm` (another tool to install and manage); `apt install nodejs` (system-wide, often stale version); fixing corepack's CRLF (fighting a Windows-binary-on-WSL problem for no benefit).

**Owner:** Martin.

## 2026-06-15 — agent-browser is the one browser tool; dropped the Chrome DevTools + Lighthouse MCP servers

**Decision:** Removed both MCP servers (`chrome-devtools`, `lighthouse`) from `.mcp.json` and the dead `mcp__chrome-devtools__*` permission. Browser automation, screenshots, scraping, QA, and audits all go through the vendored `agent-browser` skill instead. Added `SETUP.md` documenting fresh-machine install (core vs optional).

**Why:** The `agent-browser` skill already covers everything the two MCPs did and explicitly says to prefer it over other browser tools. It manages its own Chromium, so keeping the MCPs added a redundant system-Chrome dependency for no gain. One browser path is simpler to set up and reason about.

**Alternatives considered:** Keep all three and note the overlap (redundant config + extra Chrome dep); keep Lighthouse only for perf/SEO scoring (still a second tool to maintain — revisit if agent-browser can't produce the audit numbers we need).

**Owner:** Martin.

## 2026-06-14 — Generated AI assets live in `project-context/<Project>/assets/`, finals committed, drafts ignored

**Decision:** Higgsfield/Nano Banana/Flux output goes under each project's `project-context/<Project>/assets/` folder. Final picks are committed; throwaway iterations go in `assets/drafts/`, which is gitignored (`project-context/**/assets/drafts/`).

**Why:** Keeps generated media beside the project it serves and synced/backed up like other companion files, while keeping the "commit everything in project-context" rule from bloating the AIOS repo with large/redundant video files. Iterating is cheap and noisy; only the chosen output is worth versioning.

**Alternatives considered:** Commit everything (repo bloat from video binaries); gitignore all assets (loses the backup/sync benefit, at risk from `git clean`).

**Owner:** Martin.

## 2026-06-13 — Companion files for external projects live in `project-context/`

**Decision:** External project repos go under `projects/` (gitignored in AIOS, since they have their own remotes). Files related to those projects that I want the AIOS to read but don't want in the project's own repo live in a sibling `project-context/` folder, mirroring project names.

**Why:** `project-context/` is committed and synced by AIOS, so companion files get versioned and backed up like the knowledge artifacts they are. Nesting them inside `projects/` would leave them double-ignored (not in the project repo, not in AIOS), local-only, and at risk from `git clean`. Sibling folder also keeps the project repos pristine with one ignore rule (`projects/`) instead of per-project gitignore edits. Would change my mind if companion files turn out to be mostly sensitive/local-only data, in which case a gitignored `project-context/private/` covers the exceptions.

**Alternatives considered:** Folder inside each project added to that project's `.gitignore`.

**Owner:** Martin.
