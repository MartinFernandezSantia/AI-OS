---
name: setup-project
description: Creates the docs/ directory structure and initializes all template files for a project. Includes docs/INDEX.md, architecture/, api/, ui-ux/, security/, decisions/, customizations/, and rules/. Use at the start of a new project or to initialize docs on an existing one.
---

# setup-project

Create the standard `docs/` structure for a project and initialize all template files. Do not overwrite files that already exist.

---

## Objective

Produce a ready-to-use `docs/` directory that matches the structure defined in the global CLAUDE.md, with all template files in place and `docs/INDEX.md` initialized with an entry for each created file.

---

## Phase 1 — Confirm areas

Before creating anything, present the standard area list to the user and ask which to include:

```
The following docs/ areas will be created. Confirm or remove any that don't apply to this project:

- architecture/     — module docs, architecture index
- api/              — API contracts and service definitions  
- ui-ux/            — user flows, wireframes, component specs
- security/         — security policies and decisions
- decisions/        — ADRs (architecture decision records)
- customizations/   — per-client adaptations
- rules/            — project conventions

Proceed with all, or list the ones to skip.
```

Wait for confirmation before proceeding.

---

## Phase 2 — Create structure

For each confirmed area, create the directory and its template file. Do not create files that already exist — note them as skipped.

### docs/INDEX.md

```markdown
# docs/INDEX.md — [Project name]

Index of all project documentation. One line per file.

| File | Description |
|---|---|
[entries added automatically as files are created]
```

### docs/architecture/INDEX.md

```markdown
# Architecture index

One line per module. Updated as modules are added.

| Module | Responsibility |
|---|---|
```

### docs/architecture/overview.md

```markdown
# Architecture overview

## Architectural pattern

[Feature-based / MVC / Hexagonal / other — fill in]

## Module map

[High-level description of main modules and their relationships]

## Cross-cutting concerns

[Auth, logging, error handling, feature flags — how they are handled globally]

## Key decisions

[Link to relevant ADRs]
```

### docs/api/overview.md

```markdown
# API overview

## Base URL

[Production and staging base URLs]

## Authentication

[Auth mechanism — Bearer token, session cookie, API key, etc.]

## Versioning

[How API versions are handled]

## Endpoints index

| Method | Path | Description |
|---|---|---|
```

### docs/ui-ux/overview.md

```markdown
# UX/UI overview

## Design system

[Component library, token system, or design tool in use]

## Screen index

| Screen | Route | Description |
|---|---|---|

## Shared components

[List of reusable components and their location]

## Accessibility baseline

[WCAG level targeted, known exceptions]
```

### docs/security/overview.md

```markdown
# Security overview

## Auth/authz

[Authentication approach. Authorization model (RBAC, ABAC, etc.)]

## Session handling

[Session storage, expiry, rotation policy]

## Input validation

[Validation library, where validation happens, approach]

## Secrets storage

[Env vars, vault, or other — and where .env.example lives]

## Known risks and mitigations

| Risk | Mitigation | Status |
|---|---|---|
```

### docs/decisions/ (empty dir + template note)

```markdown
# ADR template

Copy this format for each new decision. File naming: ADR-XXX-short-title.md

---

# ADR-XXX: [Title]

Date: YYYY-MM-DD  
Status: proposed | accepted | deprecated | superseded by ADR-XXX

## Context

[What situation or problem led to this decision]

## Decision

[What was decided]

## Consequences

[What changes as a result — positive and negative]

## Alternatives considered

[Other options that were evaluated and why they were rejected]
```

### docs/customizations/ (empty dir + README)

```markdown
# Customizations

Per-client adaptations to the core product. Each file documents changes made for a specific client.

File naming: `<client-name>.md`

## Template

### What was changed
[Description of the change]

### Where
[Files or modules affected]

### How to revert
[Steps or commands to revert to core behavior]
```

### docs/rules/conventions.md

```markdown
# Project conventions

## Naming

[File naming, variable naming, component naming conventions]

## File organization

[Where new files go, how to structure a new module]

## Code style

[Formatter, linter, config file location]

## Patterns

[Recurring patterns to follow — data fetching, error handling shape, etc.]

## Anti-patterns

[Things explicitly avoided in this codebase and why]
```

---

## Phase 3 — Initialize INDEX.md

After all files are created, populate `docs/INDEX.md` with one entry per created file.

Format:

```markdown
| docs/architecture/INDEX.md | Module registry — one line per module |
| docs/architecture/overview.md | Architectural pattern, module map, cross-cutting concerns |
| docs/api/overview.md | API base URL, auth, versioning, endpoint index |
...
```

---

## Rules

- Never overwrite existing files. Skip and note.
- Create directories even if only the template file goes in them.
- Do not create areas the user excluded.
- Keep template content minimal — it is a starting point, not documentation itself.

---

## Output

Write all files directly. Do not return them as drafts.

After completing, output:

```
## Summary
<one sentence: N files created across M areas>

## Output
Files created:
- [list of created files]

Files skipped (already existed):
- [list, or "none"]

## Decisions made
<any areas added or excluded based on user input>

## Open questions
<anything that needs follow-up>

## Dependencies flagged
<none, or relevant dependencies>
```
