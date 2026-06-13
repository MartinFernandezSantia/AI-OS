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

## 2026-06-13 — Companion files for external projects live in `project-context/`

**Decision:** External project repos go under `projects/` (gitignored in AIOS, since they have their own remotes). Files related to those projects that I want the AIOS to read but don't want in the project's own repo live in a sibling `project-context/` folder, mirroring project names.

**Why:** `project-context/` is committed and synced by AIOS, so companion files get versioned and backed up like the knowledge artifacts they are. Nesting them inside `projects/` would leave them double-ignored (not in the project repo, not in AIOS), local-only, and at risk from `git clean`. Sibling folder also keeps the project repos pristine with one ignore rule (`projects/`) instead of per-project gitignore edits. Would change my mind if companion files turn out to be mostly sensitive/local-only data, in which case a gitignored `project-context/private/` covers the exceptions.

**Alternatives considered:** Folder inside each project added to that project's `.gitignore`.

**Owner:** Martin.
