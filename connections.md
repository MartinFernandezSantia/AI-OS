# Connections

Registry of every system your AIOS can reach. Filled by `/onboard` from Q4-Q7 answers; expanded over time as you wire new tools. `/audit` checks this file for domain coverage and freshness.

| # | Domain | Tool | Mechanism | Auth | Last checked |
|---|---|---|---|---|---|
| 1 | Revenue / Financials | Cash (untracked) — no tool yet | not yet connected | — | — |
| 2 | Customer interactions | WhatsApp (personal number) | not yet connected | — | — |
| 3 | Calendar | Outlook Calendar (inferred from Hotmail) | not yet connected | — | — |
| 4 | Communication | WhatsApp (personal); email: Outlook/Hotmail | not yet connected | — | — |
| 5 | Project / task tracking | None — lives in my head | not yet connected | — | — |
| 6 | Meeting intelligence | None | not yet connected | — | — |
| 7 | Knowledge / files | None — no system yet | not yet connected | — | — |
| 8 | Web automation / audit / QA | agent-browser (skill + global CLI) | skill (`.claude/skills/agent-browser`) | none (manages its own Chromium) | 2026-06-15 |
| 9 | Automation / workflows (TG) | n8n self-hosted (VPS Hostinger + Dokploy) | `mcp` (`.mcp.json` → `n8n-tg`) | OAuth 2.1 + dynamic client registration | 2026-08-27 |
| 10 | SEO / search data | Google Search Console MCP | **pending** | OAuth (Google) | — |

**Pending connections:**
- **#10 Google Search Console MCP** — blocked until Google verifies the business. Needs Google OAuth + a verified GSC property before it can be wired. Revisit once verification clears.

**#9 n8n MCP — notes.** Endpoint `https://n8n.terminalgrafica.cloud/mcp-server/http`. Server-side it's live and advertises OAuth 2.1 with dynamic client registration + PKCE; **Martin authenticates it from `/mcp`** (opens the browser) — Claude can't complete that handshake itself. Scopes offered: `workflow:read/write/execute`, `execution:read`, `credential:read`, `dataTable:read/write`, `project:read`, `tag:read`. `execution:read` is the one that matters: it retires the standing "Claude can't see n8n executions, ask Martin for the data" constraint that the TG bot work carried. Two caveats: the domain sits behind Cloudflare's **AR-only geo-block** (403 from outside Argentina), and `credential:read` isn't needed for the quoting-bot work — `workflow:read` + `execution:read` suffice.

**Infra note:** this is TG's VPS (see `context/projects.md`), not Martin's — the AIOS reaches it, it doesn't own it.

**Tool constraints (mine):** any tool I adopt must be (1) free or self-hostable open-source, and (2) able to connect to Claude (e.g. via MCP). Don't recommend paid-only closed SaaS without flagging the tradeoff.

**Mechanism options:** `mcp` (MCP server), `script` (Python/Bash hitting an API, in `scripts/`), `export` (CSV/JSON dump pipeline), `key+ref` (`.env` key + `references/{tool}-api.md` guide), `not yet connected`.

When you wire a new tool, also save `references/{tool}-api.md` capturing endpoints, auth flow, and common queries — researched-once-saved-forever.
