# Pre-generation review — agent roles

The pre-generation review runs **before every Higgsfield generation** (unless Martin overrides with "just generate" / "skip review"). It replaces solo prompt-drafting with three agents, each spawned via the `Agent` tool with **only the context it needs** — the reference image path(s) and the stated intent, never the chat history. Subagents read images with the `Read` tool, so always pass absolute file paths.

Run order: **Reference Auditor → Prompt Engineer → Adversarial Reviewer → (revise loop, max 2) → gate.** Auditor and Reviewer are read-only (use `Explore` or `general-purpose`); the Prompt Engineer is `general-purpose`.

The final prompt + params feed the Part B gate. The gate's `References` and `Assumed/missing` lines are populated from the Structure Spec (preserve/neutralize zones + open questions).

---

## 1. Reference Auditor (read-only)

**Context to pass:** absolute path(s) to the reference image(s); the user's stated intent (what to change, remove, crop; output format/aspect); for interior-reference jobs, which interior image maps to which opening.

**Prompt:**
> You are auditing reference image(s) for an AI image edit. Read every provided image carefully. You have no other context. Produce a Structure Spec describing what the generation MUST honor. Be specific and spatial.
> - **Preserve exactly:** architecture/geometry, signage and its *exact legible text* (transcribe it), colors, materials, proportions, and the spatial layout (what sits where, left-to-right and depth).
> - **Fabrication-risk zones:** anything an AI re-render would invent — interiors seen through glass, distant signage, reflections, stickers/decals, screens, small text, far objects. List each and how to handle it (neutralize, or render from a supplied interior reference).
> - **Requested changes:** removals, crops, reframing, aspect ratio.
> - **Open questions:** illegible text, ambiguous removals, anything needing Martin's confirmation before generating.

**Returns (schema):**
```json
{
  "preserve": ["..."],
  "exact_text": ["SANTÍA PROPIEDADES", "..."],
  "fabrication_zones": [{"zone": "...", "handling": "neutralize|from_reference|composite"}],
  "changes": ["..."],
  "open_questions": ["..."]
}
```

## 2. Prompt Engineer

**Context to pass:** the Structure Spec (full JSON) + the stated intent. Do NOT pass the chat history.

**Prompt:**
> Write a single Higgsfield edit prompt from this Structure Spec. Fill these slots in order, keep it tight, and bias toward *constraints* over scene description (this is an edit that must respect a reference, not a fresh render):
> 1. **Subject / structure** — one line naming what the image is.
> 2. **Preserve exactly** — the must-honor elements and exact signage text.
> 3. **Change** — the removals/crops/reframe.
> 4. **Neutralize** — each fabrication zone (clean glass, no stickers, dark/reflective/out-of-focus where no reference exists; render from the supplied interior reference where one does).
> 5. **Lighting + grade** — diegetic setup AND post/grade for a finished professional look.
> 6. **Camera / framing** — implied lens, framing, aspect.
> 7. **Avoid** — fabrication, invented text, warped geometry.
> Then state chosen params: model (non-premium default), aspect ratio, resolution, and a one-line rationale.

**Returns:** `{ "prompt": "...", "params": {"model": "...", "aspect_ratio": "...", "resolution": "..."}, "rationale": "..." }`

## 3. Adversarial Reviewer (read-only, fresh context)

**Context to pass:** reference image path(s) + the Structure Spec + the drafted prompt. Nothing else.

**Prompt:**
> Adversarially review this drafted edit prompt against the reference image(s) and Structure Spec. Default to skeptical. Find: fabrication zones the prompt fails to neutralize; preserve-constraints it drops; contradictions; text the model is likely to garble; geometry/perspective risks. For each, state the gap and the exact fix. Verdict: `pass` only if nothing material is missing, else `revise`.

**Returns:** `{ "verdict": "pass|revise", "gaps": [{"issue": "...", "fix": "..."}] }`

**Loop:** if `revise`, hand the gaps back to the Prompt Engineer for one tightening pass. Cap at 2 revise rounds, then take the best prompt and surface any residual reviewer notes in the gate's `Assumed/missing`.
