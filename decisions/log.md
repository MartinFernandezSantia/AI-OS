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
