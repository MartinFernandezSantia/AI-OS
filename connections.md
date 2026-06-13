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
| 8 | Web audit / perf | Lighthouse MCP (`@danielsogl/lighthouse-mcp`) | mcp (`.mcp.json`) | none | 2026-06-13 |
| 9 | Web audit / debug | Chrome DevTools MCP (`chrome-devtools-mcp`) | mcp (`.mcp.json`) | none (needs Chrome installed) | 2026-06-13 |
| 10 | SEO / search data | Google Search Console MCP | **pending** | OAuth (Google) | — |

**Pending connections:**
- **#10 Google Search Console MCP** — blocked until Google verifies the business. Needs Google OAuth + a verified GSC property before it can be wired. Revisit once verification clears.

**Tool constraints (mine):** any tool I adopt must be (1) free or self-hostable open-source, and (2) able to connect to Claude (e.g. via MCP). Don't recommend paid-only closed SaaS without flagging the tradeoff.

**Mechanism options:** `mcp` (MCP server), `script` (Python/Bash hitting an API, in `scripts/`), `export` (CSV/JSON dump pipeline), `key+ref` (`.env` key + `references/{tool}-api.md` guide), `not yet connected`.

When you wire a new tool, also save `references/{tool}-api.md` capturing endpoints, auth flow, and common queries — researched-once-saved-forever.
