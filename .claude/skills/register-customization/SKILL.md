---
name: register-customization
description: Records a per-client customization in docs/customizations/<client>.md. Use whenever the orchestrator flags that a client-specific change was made to the codebase that deviates from the core product behavior.
---

# register-customization

Appends a customization entry to `docs/customizations/<client>.md`.

## Steps

1. **Resolve the target file.** Path: `docs/customizations/<client>.md` where `<client>` is specified in the brief. If the file does not exist, create it using the template below.

2. **Append the entry.** Always append — never edit or remove existing entries. Each customization is a discrete block.

3. **Write the file.**

4. **Update INDEX.md** if the client file was just created. Append one line to `docs/INDEX.md`:
   ```
   docs/customizations/<client>.md — Per-client customizations for <client>
   ```
   If `docs/INDEX.md` does not exist, note it in output and skip.

## File template (new files only)

```markdown
# Customizations — <Client name>

Customizations applied to the core codebase for this client.
Each entry records what changed, where, and how to revert.

---
```

## Entry format

```markdown
## <YYYY-MM-DD> — <Short description of the customization>

**What changed:** <What behavior or feature was modified from the core.>
**Where:** <File paths and/or function/component names affected.>
**Reason:** <Why this client needed this change.>
**How to revert:** <Steps or diff description to restore core behavior.>
```

## Output

```
## Summary
<one sentence: what customization was recorded for which client>

## Output
<path of the updated file and the entry that was appended>

## Decisions made
<e.g. "Created new client file — no prior customizations existed">

## Open questions
<anything in the brief that left a field incomplete>

## Dependencies flagged
<none>
```
