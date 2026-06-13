---
name: generate-adr
description: Generates a new ADR (Architecture Decision Record) in docs/decisions/ following the project format. Use whenever the orchestrator needs to record an architectural decision at session close or mid-session when a significant decision has been made.
---

# generate-adr

Creates a new ADR file in `docs/decisions/`.

## Steps

1. **Determine next number.** Read `docs/decisions/` and list existing ADR files. Find the highest `ADR-XXX` number and increment by 1. If no ADRs exist, start at `ADR-001`.

2. **Build the file.** Use the format below. Populate from the brief the orchestrator provided — do not invent content.

3. **Write the file.** Path: `docs/decisions/ADR-<NNN>-<kebab-case-title>.md`.

4. **Update INDEX.md.** Append one line to `docs/INDEX.md`:
   ```
   docs/decisions/ADR-<NNN>-<title>.md — <one-line description of the decision>
   ```
   If `docs/INDEX.md` does not exist, note it in output and skip this step.

## ADR format

```markdown
# ADR-<NNN>: <Title>

Date: <YYYY-MM-DD>
Status: accepted

## Context
<Why this decision was needed. What problem or situation prompted it.>

## Decision
<What was decided. State it clearly and directly.>

## Consequences
<What changes as a result. Include trade-offs, not just benefits.>

## Alternatives considered
<What else was evaluated and why it was not chosen.>
```

## Output

```
## Summary
ADR-<NNN> created at docs/decisions/<filename>.md

## Output
<full path of the created file>

## Decisions made
<e.g. "Assigned number ADR-004 based on existing files">

## Open questions
<anything missing from the brief that left a section incomplete>

## Dependencies flagged
<none, unless updating INDEX.md requires attention>
```
