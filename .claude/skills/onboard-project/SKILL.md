---
name: onboard-project
description: Discovers an existing project's stack, architecture, and conventions by reading the codebase, then asks targeted questions to fill gaps, writes the project CLAUDE.md, and initializes the docs/ structure. Use at the start of work on an existing project that lacks a CLAUDE.md.
---

# onboard-project

Produce a complete, accurate project CLAUDE.md by combining code inference with user confirmation. Do not guess what can be read; do not skip what cannot.

---

## Objective

Write a project CLAUDE.md that gives Claude enough context to work on this project without asking meta-questions every session, and initialize the standard `docs/` structure. Every section must have a real answer or an explicit TODO — no placeholders, no assumptions left silent.

---

## Phase 1 — Code inference

Before asking anything, read the project to infer as much as possible. Minimize questions by maximizing inference.

Read in this order:

1. Package manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, or equivalent) — stack, dependencies, scripts.
2. Config files in root — framework, build tool, environment setup (`next.config.*`, `vite.config.*`, `tsconfig.json`, `.env.example`, `docker-compose.yml`, etc.).
3. Top-level directory structure — architectural pattern (feature-based, layer-based, MVC, etc.).
4. `src/` or equivalent entry point — folder organization, module boundaries.
5. Database schema or migration files if present — data model, ORM.
6. Auth-related files if present — auth approach, session handling.
7. Existing `README.md` or `docs/` if present — stated conventions, overview.

For each item you infer, mark it as **inferred** internally. You will present inferences to the user for confirmation, interleaved with questions about gaps.

---

## Phase 2 — Targeted questions

After reading the code, build a question list covering everything the project CLAUDE.md requires that you could not infer. Do not ask about things you already know — only present those for confirmation.

Structure your interaction as follows:

- Present a brief summary of what you inferred (2–4 lines max).
- Then ask questions and confirm inferences together, grouped by topic.
- If answers to early questions open new unknowns, ask follow-up questions immediately — do not save them for a later round. There is no round limit; stop only when you have enough to fill every required section.

**Minimum required coverage before writing:**

- [ ] Project overview (what it is, what problem it solves)
- [ ] Stack confirmed (language, framework, runtime)
- [ ] Folder structure and architectural pattern confirmed
- [ ] Error handling: domain error type, error codes location, boundaries
- [ ] Logging: library, event naming convention, file layout, redact paths
- [ ] Security: auth/authz approach, session handling, input validation, secrets storage
- [ ] Testing: strategy and tools (can be "none defined yet")
- [ ] Environment & deployment: how to run locally, available envs, deploy process
- [ ] Feature flags: convention in use (can be "none")
- [ ] Performance targets if applicable (can be "none defined")
- [ ] Dependencies: allowlist/blocklist if any

Sections that can remain as `TODO` if the user explicitly says they are not yet defined: Testing, Performance targets, Dependencies allowlist/blocklist, Feature flags.

---

## Phase 3 — Write project CLAUDE.md

Once coverage is complete, write `CLAUDE.md` at the project root.

### Structure

```
# CLAUDE.md — [Project name]

> [One sentence: what this project is and what it does. Max 3 lines.]

---

## Stack

[Language, runtime, framework, key libraries. Bullet list, no prose.]

## Architecture

[Folder structure. Architectural pattern. Module boundaries if relevant. Keep it scannable.]

## Error handling

[Domain error type and where it lives. Error codes and location. What counts as a boundary (route handlers, server actions, etc.).]

## Logging

[Library. Event naming convention. File layout. Redact paths for sensitive fields.]

## Security

[Auth/authz approach. Session handling. Input validation approach. Secrets storage (env vars, vault, etc.).]

## Testing

[Strategy. Tools. What is tested and what is not. Or: TODO — not yet defined.]

## Environment & deployment

[How to run locally. Available environments. Deploy process or command.]

## Feature flags

[Convention (env var prefix, config file, library). Or: not in use.]

## Performance

[Concrete targets if defined (response time, payload size, query time). Or: no targets defined.]

## Dependencies

[Allowlist or blocklist if applicable. Or: no restrictions defined.]
```

### Rules

- Target 200 lines or fewer. Be dense, not verbose.
- No prose paragraphs — use short bullets or single-line values.
- No section headers without content — omit sections the user explicitly said are not applicable.
- Do not repeat anything already in the global CLAUDE.md (core principles, agent protocol, git conventions, etc.).
- Write in English, imperative or declarative tone.

---

## Phase 4 — Initialize docs/

After writing CLAUDE.md, create the `docs/` structure. Present the standard area list and ask which to include:

```
The following docs/ areas will be created. Confirm or remove any that don't apply:

- architecture/     — module docs, architecture index
- api/              — API contracts and service definitions
- ui-ux/            — user flows, wireframes, component specs
- security/         — security policies and decisions
- decisions/        — ADRs (architecture decision records)
- customizations/   — per-client adaptations
- rules/            — project conventions
```

Wait for confirmation, then create each confirmed area with its template file. Do not overwrite files that already exist — skip and note them.

### docs/INDEX.md

```markdown
# docs/INDEX.md — [Project name]

| File | Description |
|---|---|
[one entry per created file]
```

### docs/architecture/INDEX.md

```markdown
# Architecture index

| Module | Responsibility |
|---|---|
```

### docs/architecture/overview.md

```markdown
# Architecture overview

## Architectural pattern
[Fill in]

## Module map
[High-level description of main modules and relationships]

## Cross-cutting concerns
[Auth, logging, error handling, feature flags]

## Key decisions
[Link to relevant ADRs]
```

### docs/api/overview.md

```markdown
# API overview

## Base URL
[Production and staging]

## Authentication
[Mechanism]

## Versioning
[How versions are handled]

## Endpoints index

| Method | Path | Description |
|---|---|---|
```

### docs/ui-ux/overview.md

```markdown
# UX/UI overview

## Design system
[Component library or design tool]

## Screen index

| Screen | Route | Description |
|---|---|---|

## Shared components
[List and location]

## Accessibility baseline
[WCAG level targeted, known exceptions]
```

### docs/security/overview.md

```markdown
# Security overview

## Auth/authz
[Authentication and authorization model]

## Session handling
[Storage, expiry, rotation]

## Input validation
[Library and approach]

## Secrets storage
[Env vars, vault, or other]

## Known risks

| Risk | Mitigation | Status |
|---|---|---|
```

### docs/decisions/ADR-template.md

```markdown
# ADR-XXX: [Title]

Date: YYYY-MM-DD
Status: proposed | accepted | deprecated | superseded by ADR-XXX

## Context
## Decision
## Consequences
## Alternatives considered
```

### docs/customizations/README.md

```markdown
# Customizations

Per-client adaptations. File naming: `<client-name>.md`

## Template

### What was changed
### Where
### How to revert
```

### docs/rules/conventions.md

```markdown
# Project conventions

## Naming
## File organization
## Code style
[Formatter, linter, config location]

## Patterns
[Recurring patterns to follow]

## Anti-patterns
[Things explicitly avoided and why]
```

After creating all files, populate `docs/INDEX.md` with one entry per created file.

---

## Output

Write all files directly. Do not return drafts.

After completing both phases, output:

```
## Summary
<one sentence: project onboarded, CLAUDE.md written, docs/ initialized with N files>

## Output
CLAUDE.md written to project root. Sections: [list].

docs/ files created:
- [list]

docs/ files skipped (already existed):
- [list, or "none"]

## Decisions made
<any autonomous decisions taken during inference or docs setup>

## Open questions
<anything that could not be resolved and was left as TODO>

## Dependencies flagged
<none, or any detected dependencies relevant to the orchestrator>
```
