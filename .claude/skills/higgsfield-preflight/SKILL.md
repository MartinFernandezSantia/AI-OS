---
name: higgsfield-preflight
description: |
  Martin's house rules and mandatory preflight gate for ANY
  Higgsfield generation. Load this ALONGSIDE higgsfield-generate
  / higgsfield-product-photoshoot / higgsfield-marketplace-cards
  whenever about to generate an image or video, make an ad, a UGC
  video, a product demo, animate a photo, image-to-video, edit or
  reframe a clip, or run Marketing Studio. Enforces: references are
  a strict guide (never altered), deliberate/consistent text,
  professional lighting, shot breakdowns + ambient sound for video,
  no random people, cheaper-tool checks, non-premium models by
  default, and a hard pre-generation gate that shows the prompt,
  model, params, and a real credit estimate before anything runs.
  These rules OVERRIDE the marketplace Higgsfield skills' UX rules
  where they conflict (cost estimation and premium-model defaults).
---

# Higgsfield Preflight — Martin's house rules

Martin set these rules so every Higgsfield generation is deliberate, on-brand, and never burns credits by surprise. They sit on top of the marketplace `higgsfield-*` skills (those do the actual CLI work). **Where they conflict, these rules win** — specifically, the marketplace skill says "don't pre-estimate cost" and "prefer the quality default"; Martin's rules require the opposite (always estimate credits, default to non-premium).

**Never run a `higgsfield generate create` / workflow / Marketing Studio generation command until the Part B gate has been shown and Martin has said go.**

---

## Part A — Build the generation right (before showing anything)

Bake these into the prompt and parameters before you present the gate.

1. **References are law.** If Martin uploaded reference image(s), never change their content — not the subject, composition, text, colors, or layout. At most upscale. The reference is the reason; the output must follow it as a strict guide. Pass references through the proper media flag (`--image` / `--start-image` / etc.). If a model would reinterpret rather than respect the reference, say so and pick one that honors it.

2. **Text must be deliberate and consistent.** Any text rendered in the output is intentional and must read correctly and consistently. If a reference image contains text that isn't clearly legible, **stop and ask Martin what it says** before generating anything — never guess at copy.

3. **Fine detail & through-glass interiors are fabricated.** AI re-renders invent anything small or indistinct — interiors seen through windows/glass, distant signage, reflections, stickers/decals, screens, price tags, far-off objects. They look plausible at a glance and fall apart on zoom. **Identify these zones before generating and neutralize them in the prompt:** render through-glass interiors as dark, softly reflective, or out-of-focus glass rather than detailed rooms; keep glass clean (no invented stickers/text); leave distant or indistinct areas softly blurred or in shadow; never invent small text, signage, screens, or product detail. If a real interior or detail must be preserved accurately, an AI re-render is the wrong tool — mask/composite it from the original instead. Call out which zones you're neutralizing in the gate's References line.

4. **No random people.** Do not generate humans unless one of these is true: a consistent character already exists (Soul Character via `higgsfield-soul-id`), or an established AI influencer is being reused. If a person is genuinely needed and none exists, flag it and offer to build a consistent character first rather than spawning a throwaway face.

5. **Professional lighting, always.** Treat lighting on two levels and write both into the prompt:
   - *Diegetic* — the real gear and setup that would capture this scene (key/fill/rim, softboxes, golden hour, practicals).
   - *Post / grade* — editing-level lighting: color grade, contrast, mood, highlight roll-off. Aim for a finished, professionally graded look, not a raw camera dump.

6. **Video → shot breakdown.** Don't treat a video as one undifferentiated clip. Propose it as numbered shots (framing, motion, transition) and show that in the gate.

7. **Video → ambient sound.** Decide and propose the ambient / sound design (room tone, foley, music bed, or intentional silence) and confirm it in the gate before generating.

---

## Part B — The preflight gate (hard block, every generation)

Show this card and **wait for Martin's "go"** before running anything. This holds even in Auto mode.

```
Higgsfield preflight — [image | video]
Prompt:         "<exact prompt to be sent>"
Model:          <model>  (non-premium; one line on why it fits)
Params:         aspect 16:9 · res 2k · duration 12s · <other relevant>
Est. credits:   ~N        (from `higgsfield generate cost`, never guessed)
References:     <files>   — strict guide, content unchanged (upscale only)
Shots:          1) …  2) …            (video only)
Ambient sound:  …                     (video only)
Better tool?    none  /  consider <tool> because <reason>
Assumed/missing: <e.g. aspect ratio defaulted to 16:9> — confirm?

→ Reply "go" to generate, or tell me what to change.
```

Rules for filling the card:

- **Credits are real, not guessed.** Get the estimate from the CLI before showing the card:
  ```bash
  higgsfield generate cost <model> [--prompt "..."] [param flags]
  # workflows: higgsfield generate cost workflow <name> [param flags]
  ```
  If the cost command can't produce a number, say so explicitly rather than inventing one.

- **Flag missing/assumed features.** If the brief omits something the generation should use — aspect ratio, resolution, duration, audio — surface it in "Assumed/missing" and confirm rather than silently defaulting.

- **Cheaper-tool check.** Before settling on a model, ask whether another Higgsfield tool would give a better result for similar cost — e.g. Marketing Studio for ads/UGC/product video, `higgsfield-product-photoshoot` for brand product visuals, Virality Predictor for scoring a finished video. Put the verdict in "Better tool?".

- **Default to non-premium.** Pick the sensible-quality default model, not the most expensive one. "Premium" = materially pricier than the sensible default for this brief, or a top-tier model (e.g. Cinema Studio Video 3.0, Google Veo 3.1 ultra, Nano Banana Pro) — judge by the `generate cost` number. **Never auto-run a premium model.** If a premium model is genuinely worth it for the complexity, that is a *separate, explicit* ask: explain why the result justifies the extra credits and get a clear yes before it goes in the card as the chosen model.

---

## Override

If Martin says "just generate" / "just go" / "skip preflight" for a request, skip the *wait* for that one request. Two rules never get skipped even then:

- References are still never altered (upscale only).
- A premium model is still never used without an explicit, separate yes.

---

## Quick checklist

Before any generation runs:

- [ ] References passed through untouched (upscale only)?
- [ ] All rendered text confirmed legible / intentional?
- [ ] Fine-detail / through-glass / indistinct zones neutralized (not fabricated)?
- [ ] No people unless consistent character / AI influencer?
- [ ] Professional lighting (diegetic + grade) in the prompt?
- [ ] (video) Shots broken out?
- [ ] (video) Ambient sound decided?
- [ ] Missing features (aspect ratio, etc.) flagged?
- [ ] Cheaper/better Higgsfield tool ruled out?
- [ ] Model is non-premium (or premium explicitly approved)?
- [ ] Real credit estimate from `generate cost` shown?
- [ ] Gate shown and Martin said go (unless override)?
