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
