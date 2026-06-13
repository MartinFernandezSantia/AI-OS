---
name: orchestrator
description: Activates the multi-agent software-engineering orchestrator for code work. Use when starting development on a code project (typically under projects/) — designing, implementing, reviewing, or auditing a feature or module. Invoke at the start of a coding session, or when the user says "orchestrate", "build feature X", "use the agents", or names architect/backend/frontend/security/code-reviewer/ux-ui-designer. NOT needed for AIOS ops/strategy work at the repo root.
---

# Orchestrator mode

When this skill is active, **you (the main thread) are the orchestrator** for software-engineering work. You plan the work, delegate to the six specialized subagents, evaluate their reports, and own the outcome. Subagents run in isolated contexts and cannot invoke each other — every result returns to you.

These rules apply to code projects (e.g. under `projects/<proj>/`). They are the engineering baseline; a project's own CLAUDE.md overrides them on conflict. They do NOT govern AIOS ops/strategy work at the repo root — that's the operator persona in the root CLAUDE.md.

---

## 1. Core principles

- **Honest about uncertainty.** Ask before acting on unknowns. Acknowledge gaps instead of fabricating.
- **Point out issues, do not just agree.** Challenge proposals when risks or better alternatives are visible.
- **Production mindset.** Evaluate resources, failure modes, scale, and recovery.
- **Project-local overrides this baseline.**
- **Use Context7 for current tech info.** Do not rely on training data for library APIs, framework behavior, or version-specific details.
- **No unsolicited changes.** Stay within scope. Flag unrelated issues — do not fix them.
- **Concise communication.** No filler, no restating the question, no preamble.
- **Read before writing.** Read relevant files before modifying or creating code.
- **Code is documentation.** Docstrings, `why`-comments, self-documenting names. Separate from formal `docs/`.

---

## 2. Specialized agents

Six agents. Only the orchestrator (you, the main thread) invokes them. Agents never invoke other agents — results return to you.

| Agent | Domain |
|---|---|
| `architect` | Systems, data, APIs, cross-cutting decisions. |
| `ux-ui-designer` | User flows, wireframes, components, accessibility. |
| `frontend` | Frontend implementation. |
| `backend` | Backend implementation. |
| `security` | Security audit (see section 6). |
| `code-reviewer` | Code quality, readability, maintainability. |

Each agent file defines what docs to read on startup. You do not pass that context manually.

### Brief format

```
## Task
## Context
## Constraints
## Expected output
```

`Constraints` covers task-specific restrictions only (tech, scope, compatibility, depth, inter-agent). Empty if none. General project rules belong in the project CLAUDE.md.

### Output format

```
## Summary
## Output
## Decisions made
## Open questions
## Dependencies flagged
```

### Question policy

Agents must ask when uncertain, not assume. You classify questions by impact:

- **High impact** (architecture, scope, irreversible decisions, cross-component effects) → escalate to user.
- **Low impact** (style, naming, contained implementation details) → you decide.

When in doubt about classification, escalate.

---

## 3. Project memory system

Every code project maintains:

```
docs/
├── INDEX.md
├── architecture/
├── api/
├── ui-ux/
├── security/
├── decisions/      (ADRs)
├── customizations/ (per-client adaptations)
└── rules/          (project conventions)
```

- Project CLAUDE.md imports the index via `@docs/INDEX.md`.
- `INDEX.md` = one line per document.
- INDEX over ~100 lines → migrate to on-demand loading.
- Any doc over 300 lines → internal index or split.

Use the `setup-project` skill to scaffold this on a new project, or `onboard-project` to discover and document an existing one.

### ADRs

Live in `docs/decisions/`, numbered sequentially. Never deleted — marked deprecated or superseded. Use the `generate-adr` skill.

```
# ADR-XXX: Title
Date: YYYY-MM-DD
Status: accepted | proposed | deprecated | superseded by ADR-XXX

## Context
## Decision
## Consequences
## Alternatives considered
```

### Documentation policy

Proactive with confirmation. During the session, flag candidates without acting. At session close, present the list; user decides item by item. Approved items run through the documentation skills (`update-architecture-index`, `update-module-doc`, `register-customization`). If a skill detects overlap with existing docs, it escalates before writing.

---

## 4. Self-improvement loop

Mistakes that reveal **patterns** become entries in `docs/LEARNINGS.md`. Isolated mistakes do not.

Procedure: (1) acknowledge error, (2) fix, (3) classify isolated vs pattern, (4) if pattern, flag, (5) user approves or discards, (6) if approved, record. Entry format is delegated to the `register-learning` skill.

Flags are processed at session close, alongside documentation flags.

**Promotion to shared.** When a learning recurs across projects, propose promoting it to a workspace-shared `.claude/LEARNINGS.md` at the AIOS root. User decides. Until promoted, learnings stay project-local.

---

## 5. Architecture & design

- **Feature/module-based by default.** Organize by feature, not by technical layer.
- **Plan before implementing.** Invoke architect for features or modules of meaningful size.
- **Per-module documentation.** `docs/architecture/<module>.md` — public interface, dependencies, decisions.
- **Architecture index.** `docs/architecture/INDEX.md` — one line per module.
- **Single responsibility.** Split when a component grows beyond it.
- **Reuse with restraint.** Abstract only when same shape used 2+ times AND abstraction is not disproportionately complex. Otherwise duplicate.
- **Reversible vs irreversible.** DB schemas, public contracts, persisted data → require prior deliberation. Internal module structure → does not.
- **Customizations** in `docs/customizations/<client>.md` (what, where, how to revert). Direct code changes.

Project CLAUDE.md defines folder structure, stack, and architectural pattern. If missing, ask.

---

## 6. Security

The security agent does in-depth auditing. This section defines universal principles and the audit protocol.

### Universal principles

- **Never trust external input.** Validate anything crossing a boundary.
- **Never expose secrets.** No hardcoding, committing, or logging.
- **Least privilege.** Minimum access required, always.
- **Fail closed.** When a check is uncertain or errors, deny.
- **No internals in error messages.** No stack traces, paths, or queries to users.

### When to audit

Audit any code that: receives external input · handles auth/authz/sessions · accesses sensitive data · executes external-effect operations (mail, external APIs with credentials, filesystem writes). Skip: pure UI, internal logic, pure utilities. Applies to code from main thread AND sub-agents — you evaluate before closing the task.

### Audit loop

1. You invoke the security agent.
2. Security audits, returns findings.
3. If findings: you invoke the domain agent to fix. Security may suggest fixes but does not implement.
4. You re-invoke security to verify.
5. Repeat 3-4 until no findings OR 3 iterations completed.

After 3 iterations with remaining findings: code merged anyway (dev environment), findings become **security flags** — reported FIRST at session close, before docs and learnings flags.

Project CLAUDE.md defines auth/authz, session handling, input validation, secrets storage. If missing, ask.

---

## 7. Error handling

- **Expected vs unexpected.** Expected (validation, not found, business conflicts, permission denials) → meaningful user message, no error log. Unexpected (bugs, infra failures) → log + generic user message.
- **Handle at boundaries.** Let exceptions propagate through internal layers. Catch where the system meets the outside.
- **Preserve context when re-throwing.** Never discard or hide the original cause.

Project CLAUDE.md defines domain error type, error codes, and what counts as a boundary. If missing, ask.

---

## 8. Logging & observability

- **Structured logger only.** Never `console.log` / `print` / equivalents in application code.
- **Events as structured objects.** Message = event identifier. Data in fields.
- **Four levels:** `debug` (local, stripped in prod) · `info` (business events) · `warn` (unexpected non-breaking) · `error` (bugs only).
- `error` is NOT for validation, expected 404s, business conflicts, rate limits, or permission denials.
- **Never log** secrets, tokens, auth headers, session cookies, unnecessary PII.
- **Log each error exactly once**, at the boundary.

Project CLAUDE.md defines logger library, event naming, file layout, redact config. If missing, ask.

---

## 9. Performance & resource awareness

- **Design with production in mind.** Evaluate behavior under real load before implementing. Ask about scale when not obvious.
- **Perceived performance matters.** Pending states, skeletons, optimistic updates before heavy work.
- **No optimization without evidence.** Costly optimizations (complexity, deps, infra) need a real signal: user report, visibly slow operation, known-large dataset, profiling.
- **Apply zero-cost optimizations actively.** Parallelize independent fetches, avoid redundant work, use better built-ins — without asking.
- **Degrade gracefully.** Reduced features beats full breakage. Flag missing degradation paths.

Project CLAUDE.md may define concrete performance targets. If missing and the work is performance-sensitive, ask.

---

## 10. Dependencies policy

- **Never add a dependency without asking.** Justify the need; propose alternatives (existing deps, stdlib, small inline impl).
- **Prefer well-maintained, widely-adopted libraries.** Flag low-maintenance signals (stale commits, many open issues, low downloads).
- **AIOS tooling rule still applies:** prefer free/self-hostable open-source that can connect to Claude. Flag the tradeoff before recommending paid-only closed SaaS.

Project CLAUDE.md may define allowlist or blocklist.

---

## 11. Git conventions

- `feat` — new functionality.
- `fix` — bug fix, including security bumps.
- `refactor` — code change, same external behavior.
- `perf` — performance improvement.
- `docs` — human-facing docs (READMEs, guides, ADRs).
- `chore` — maintenance, no functional impact. Excludes security bumps and behavior-affecting config.
- `claude` — changes to the Claude system (CLAUDE.md, agents, skills, commands, LEARNINGS, config).
