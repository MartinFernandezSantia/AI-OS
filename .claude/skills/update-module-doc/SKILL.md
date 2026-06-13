---
name: update-module-doc
description: Updates docs/architecture/<module>.md with new or changed information about a module's public interface, dependencies, or decisions. Use whenever the orchestrator flags that a module's documentation needs updating after implementation or architectural changes.
---

# update-module-doc

Updates `docs/architecture/<module>.md` in place, modifying only what changed.

## Steps

1. **Read the target file.** Path: `docs/architecture/<module>.md` where `<module>` is specified in the brief. If the file does not exist, create it using the template below.

2. **Identify what changed.** From the brief, determine which section(s) need updating: public interface, dependencies, or decisions. Do not touch sections not mentioned.

3. **Merge the change.** Edit only the relevant section(s). Preserve all other content exactly as-is.

4. **Write the file.**

5. **Check INDEX.md.** If the module is not yet listed in `docs/architecture/INDEX.md`, append one line:
   ```
   <module> — <one-line description of the module's responsibility>
   ```
   If the file does not exist, note it in output and skip this step.

## Module doc template (new files only)

```markdown
# <Module name>

## Responsibility
<What this module does. One or two sentences.>

## Public interface
<Exported functions, API routes, events, or services this module exposes to others.>

## Dependencies
<Other modules or external services this module depends on. One item per line.>

## Decisions
<Key decisions made for this module, with brief rationale. Add entries as they accumulate.>
```

## Merge rules

- **Public interface**: if a function/route was modified, update its entry. If added, append. If removed, delete.
- **Dependencies**: if a dependency was added, append. If removed, delete. Do not reorder existing entries.
- **Decisions**: always append — never edit or remove existing entries. Each entry is a one-line summary; link to the ADR if one was generated.

## Output

```
## Summary
<one sentence: what section(s) were updated in which module>

## Output
<path of the updated file and a summary of what changed>

## Decisions made
<e.g. "Created new file — module was not previously documented">

## Open questions
<anything in the brief that was ambiguous or incomplete>

## Dependencies flagged
<none, unless a dependency found in the code is not reflected in docs>
```
