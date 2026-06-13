---
name: update-architecture-index
description: Updates docs/architecture/INDEX.md when a module is added, removed, or its responsibility changes. Use whenever the orchestrator flags that the architecture index is out of sync after a module is created or significantly modified.
---

# update-architecture-index

Keeps `docs/architecture/INDEX.md` in sync with the actual module set.

## Steps

1. **Read `docs/architecture/INDEX.md`.** If it does not exist, create it with the header below.

2. **Determine the operation** from the brief:
   - **Add**: module is new, not yet listed.
   - **Update**: module exists but its responsibility description changed.
   - **Remove**: module was deleted or merged into another.

3. **Apply the change.** One line per module, format: `<module> — <one-line responsibility>`.

4. **Write the file.**

## INDEX.md format

```markdown
# Architecture index

| Module | Responsibility |
|---|---|
| <module> | <one-line description> |
```

## Merge rules

- **Add**: append a new row. Maintain alphabetical order within the table.
- **Update**: find the existing row and replace only the responsibility text. Do not change the module name or order.
- **Remove**: delete the row. Do not leave blank lines.

Never reformat or reorder the entire table when only one entry is changing.

## Output

```
## Summary
<one sentence: what was added/updated/removed in the index>

## Output
<the modified line(s) and their final form>

## Decisions made
<e.g. "Created INDEX.md — file did not exist">

## Open questions
<any ambiguity in the brief about module name or responsibility>

## Dependencies flagged
<none>
```
