# Setup — fresh machine checklist

What to install on a brand-new **Linux or Windows** machine so this AIOS works
after cloning. Core first (nothing works without it), then optional per-feature.

> Rule of the repo: **use `pnpm`, never `npm`/`npx`** (the latter are denied in
> [.claude/settings.json](.claude/settings.json)). Skills are committed in the
> repo, so a clone already has all of them — there is no "install skills" step.

## Required — the core won't run without these

| # | Install | Why | Linux | Windows |
|---|---|---|---|---|
| 1 | **Claude Code** | This repo *is* a Claude Code project — skills, `.mcp.json`, `CLAUDE.md`, and permissions all target it | CLI or IDE extension | same (CLI / desktop / VS Code / JetBrains) |
| 2 | **Git** | Clone + the branch-based workflow `CLAUDE.md` enforces | `apt install git` | Git for Windows (also gives Git Bash) |
| 3 | **Node.js** (current LTS; dev box runs v26) | Runtime for pnpm and the Higgsfield CLI | nvm / nodesource | nodejs.org installer or `winget install OpenJS.NodeJS` |
| 4 | **pnpm** | Required — `npm`/`npx` are denied. All tooling assumes pnpm | `corepack enable` (ships with Node) | `corepack enable` |
| 5 | **`pnpm install`** (once, after clone) | Installs the pinned `@higgsfield/cli` ([package.json](package.json)) → puts the `higgsfield` binary in `node_modules/.bin`. [pnpm-workspace.yaml](pnpm-workspace.yaml) whitelists its postinstall so the vendor binary downloads | `pnpm install` | `pnpm install` |

That's the whole core. MCP servers: none are wired by default — `.mcp.json` is
empty. Browser work is handled by the optional `agent-browser` below.

## Optional — only if you use that feature

| Feature | Needs | When |
|---|---|---|
| **agent-browser** (web automation, screenshots, scraping, QA, audits, Electron/Slack) | `pnpm add -g agent-browser` then `agent-browser install` (fetches its own managed Chromium). Global CLI — lives outside the repo, so install it per machine | Any browser-driven task; the preferred browser tool |
| **Higgsfield** (image / video generation) | Provided by `pnpm install` (step 5). Then a Higgsfield account + `higgsfield auth login` (one-time, interactive). Generation costs paid credits | Only when generating media |
| **Google Search Console MCP** | Google OAuth + a verified GSC property — **pending/blocked** per [connections.md](connections.md) | Future, once business verification clears |

## Platform notes

- **Windows shell:** many skill snippets and the `settings.local.json` deny rules
  are bash idiom. Claude Code runs natively on Windows, but **WSL2** or **Git
  Bash** matches them most smoothly. `@higgsfield/cli` and `agent-browser` both
  ship Windows binaries, so the tools themselves are fine.
- **No `.env` / API keys for the core.** Higgsfield stores its own auth via its
  CLI; reading `.env*` is denied by design.
- **agent-browser install command:** its skill stub says `npm i -g` — ignore
  that here and use `pnpm add -g` to respect the repo's no-npm rule.
