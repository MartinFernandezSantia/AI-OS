---
name: register-learning
description: Appends a new learning entry to docs/LEARNINGS.md. Use whenever the orchestrator confirms that a pattern-level mistake or insight should be recorded for the project.
---

# register-learning

Appends a learning entry to `docs/LEARNINGS.md`.

## Steps

1. **Read `docs/LEARNINGS.md`.** If it does not exist, create it using the template below.

2. **Append the entry.** Always append at the end — never edit or remove existing entries.

3. **Write the file.**

4. **Update INDEX.md** if the LEARNINGS file was just created. Append one line to `docs/INDEX.md`:
   ```
   docs/LEARNINGS.md — Project-level patterns and lessons learned
   ```
   If `docs/INDEX.md` does not exist, note it in output and skip.

## File template (new files only)

```markdown
# LEARNINGS

Project-level patterns and lessons learned.
Entries are append-only. Mistakes that reveal patterns, not isolated incidents.

---
```

## Entry format

```markdown
## <YYYY-MM-DD> — <Short title>

**Context:** <Where or when the issue appeared — module, task, type of work.>
**Mistake:** <What was done wrong.>
**Root cause:** <Why it happened.>
**Lesson:** <The rule or principle to apply going forward.>
```

## Note on promotion to global

If the orchestrator indicates this learning should also be promoted to the workspace-shared `.claude/LEARNINGS.md` at the AIOS root, note it explicitly in `Decisions made` so the user can act on it. This skill does not write to the shared file.

## Output

```
## Summary
<one sentence: what learning was recorded>

## Output
<the entry that was appended>

## Decisions made
<e.g. "Created LEARNINGS.md — file did not exist" or "Orchestrator flagged for potential global promotion">

## Open questions
<anything in the brief that left a field incomplete>

## Dependencies flagged
<none>
```
