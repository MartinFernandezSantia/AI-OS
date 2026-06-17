# HyperFrames brand capture — match a brand as tightly as the AIS examples

How to make a HyperFrames video *look like it belongs to a brand* — not generic
motion graphics with the logo dropped on top. This is the method Nate Herk uses
across the AI Automation Society (AIS) projects, generalized so you can apply it
to your print-shop product, your own brand, a client's brand, or your dad's
real-estate business.

The whole trick is **two files per project, written before you build a single
scene**:

1. **`DESIGN.md`** — the human-readable brand spec. The single source of truth.
   Every palette, font, and motion choice in the video must trace back to it.
2. **`brand-tokens.css`** — the machine-readable `:root` of CSS custom properties
   that *every composition imports*, so brand values live in one place and never
   get hardcoded scene-by-scene.

> Model to study: Nate's `DESIGN.ais-example.md` and `assets/brand-tokens.css` in
> the [hyperframes-student-kit](https://github.com/nateherkai/hyperframes-student-kit).
> Read them for *shape*, not values — the AIS hex codes, logo, and guideline image
> are AI Automation Society property, not licensed for reuse. The templates below
> reproduce the structure with neutral placeholders.

---

## Why a token file (not hardcoded hex)

The AIS compositions never write `#37bdf8` inline. They write `var(--accent)`.
That means:

- One edit re-skins the whole video — swap `brand-tokens.css`, re-render.
- The same composition is reusable for a different brand by swapping the token file.
- A grep for stray hardcoded hex (see the sweep below) catches brand drift.

This is exactly why the bundled `example-may-shorts-19` has **zero** hardcoded
AIS strings — it's fully tokenized.

---

## Step 1 — Gather ground truth

Before writing anything, collect the raw brand inputs. Best to worst source:

1. **Official brand guideline / style guide** (PDF or image) — palette, fonts, logo rules straight from the source.
2. **The logo file** — pull exact colors from it; note clearspace and whether it has a glow/effect.
3. **The live website** (great when paired with `/website-to-hyperframes`) — screenshot it, sample the CSS `:root` or computed colors, read the font stack.
4. **Existing marketing collateral** — decks, ads, social posts — to infer the mood and "what they'd never do."

If none exist (common for small local businesses), you're *creating* the brand —
make deliberate choices and write them down so they stay consistent across videos.

State at the top of `DESIGN.md` where each value came from, like the AIS file does
("Ground truth extracted from …"). Future-you needs to know what's canonical vs. invented.

---

## Step 2 — Write `DESIGN.md`

Copy this template into the project folder as `DESIGN.md` and fill every section.
The section list mirrors the AIS spec — keep all of them; an empty section is a
decision you haven't made yet.

```markdown
# <Brand Name> — Visual Identity

Ground truth extracted from <source(s): guideline PDF / logo file / website URL>.
Every composition in this project MUST trace its palette, typography, and motion
choices back to this file.

## Style Prompt
<2–4 sentences. The mood in plain language + one "X meets Y" analogy.
 Say what it is AND what it is NOT. e.g. "Warm, trustworthy, local — 'neighborhood
 print shop meets modern SaaS'. Confident, not corporate. Not neon, not playful-cartoon.">

## Colors
| Token | Hex | Role |
|---|---|---|
| `--bg`         | `#______` | Primary background |
| `--surface`    | `#______` | Cards, panels |
| `--surface-2`  | `#______` | Secondary surface |
| `--border`     | `#______` | Borders, hairlines |
| `--accent`     | `#______` | Primary accent — highlights, numbers, CTAs |
| `--accent-glow`| `#______` | Logo / focal glow (note opacity + blur) |
| `--warn`       | `#______` | Secondary accent — use sparingly |
| `--text`       | `#______` | Primary text |
| `--text-dim`   | `#______` | Secondary / meta text |
<Keep palettes tight: one background family + one or two accents + neutrals.
 A loud short reads as ONE accent doing the work, not five.>

## Typography
- **<Mono font>** — monospace. Use for: labels, stats, numbers, terminal lines, pills, URLs, CTAs.
- **<Display font (weights)>** — sans/serif display. Use for: headlines, body, taglines.
- Pair them — the house pattern is a mono label above a display headline. Never use only one.
- All fonts must be Google Fonts or have a local file path (renders headless — no system fonts).

## Logo
- File: `assets/<logo>.png` (or `.svg`) — describe it (wordmark? symbol? colors? transparent bg?).
- Placement glow on dark: `filter: drop-shadow(0 0 <N>px rgba(<r,g,b>, <a>));`
- Clearspace: <e.g. half a logo-height on all sides>.
- Never recolor / stretch / add effects beyond the spec.

## Motion Rules
- Entrance-only: every element animates in via `gsap.from()`; transitions handle exits.
- Easing palette: <list the eases this brand uses, e.g. `power3.out`, `expo.out`, `back.out(1.4)`>.
- Use ≥3 different eases per scene.
- Duration bands: snap entrances 0.3–0.5s · headlines 0.5–0.8s · ambient drifts 2–4s.
- Offset first animation 0.1–0.3s from scene start.
- Numbers: GSAP `{innerText, snap}` count-up + `font-variant-numeric: tabular-nums`.

## Transitions
| Scene change | Transition | Duration | Ease |
|---|---|---|---|
| 1 → 2 | <e.g. zoom through> | 0.35s | <ease> |
| ...   | ...                 | ...    | ...   |
<Pick ONE primary transition (~60% of cuts) + 1–2 accent transitions. Rotate flavors.>

## Buttons / CTA
<Shape, fill, border, font, padding, the exact CTA text. e.g. "[ GET A QUOTE → ]">

## Iconography
<Stroke weight, fill/no-fill, color, allowed icon set. Or "none — type only".>

## What NOT to Do
1. <Brand-specific banned move, e.g. "No full-screen gradients on dark — H.264 banding.">
2. <Banned colors / fonts.>
3. No `transparent` keyword in gradients — use `rgba(...,0)` (shader-compatible CSS).
4. No `Math.random()` / `Date.now()` — render determinism.
5. No exit animations except the final scene — transitions handle exits.
6. <Logo misuse rules.>

## File References
- `assets/<logo>` — official logo
- `assets/<guideline image>` — the one-pager these specs came from (if any)
- `assets/brand-tokens.css` — the CSS `:root` vars imported by every composition
```

---

## Step 3 — Write `brand-tokens.css`

The token names must match the `--token` column of your `DESIGN.md` Colors table.
Use neutral names (`--accent`, not `--acme-accent`) so compositions are portable
across brands — then only this one file changes per project.

```css
:root {
  --bg:          #______;
  --surface:     #______;
  --surface-2:   #______;
  --border:      #______;
  --accent:      #______;
  --accent-glow: #______;
  --warn:        #______;
  --text:        #ffffff;
  --text-dim:    #______;
  --font-mono:    "<Mono Font>", ui-monospace, Menlo, monospace;
  --font-display: "<Display Font>", system-ui, sans-serif;
}
```

Drop it in the project's `assets/` and import it once at the top of `index.html`
(and any sub-composition that needs it):

```html
<link rel="stylesheet" href="assets/brand-tokens.css">
```

Then author scenes against the vars only:

```css
.headline { font-family: var(--font-display); color: var(--text); }
.stat     { font-family: var(--font-mono); color: var(--accent); }
.card     { background: var(--surface); border: 1px solid var(--border); }
```

---

## Step 4 — Verify nothing drifted (find-and-fix sweep)

Before you call a render done, grep the project for hardcoded brand values that
should have been tokens. Adapt the pattern to your palette's hexes and any brand
strings (handles, product names):

```bash
# from the project folder — flag raw hex + brand strings that belong in tokens
grep -rEn "#[0-9a-fA-F]{6}|@yourbrand|YourBrand Logo" compositions/ index.html
```

Every hit should become a `var(--token)` reference (or be a deliberate one-off you
can justify). This is the same discipline that keeps the AIS compositions clean.

---

## How this plugs into the skills

- **`/make-a-video` Gate 3 (style intake):** when the user supplies brand inputs,
  run Steps 1–3 here and write `DESIGN.md` + `brand-tokens.css` into the project
  before scaffolding. The skill's `references/style-intake.md` MOTION_PHILOSOPHY
  defaults are the fallback only when the user explicitly declines to supply a brand.
- **`/short-form-video`:** karaoke caption accent, ambient-background base, and
  face-grade tint should all reference your tokens, not literals.
- **`/website-to-hyperframes`:** the capture step gives you the site's real colors
  and fonts — pour them straight into `DESIGN.md` so the video matches the site.
- **`references/MOTION_PHILOSOPHY.md`:** the cross-brand aesthetic baseline (the
  11 Laws, pacing, pre-flight). Brand tokens say *which* colors; MOTION_PHILOSOPHY
  says *how* things move. Use both.

---

## TL;DR

Two files, written first: `DESIGN.md` (the spec) + `brand-tokens.css` (the vars).
Tokenize everything, never hardcode hex, grep before you ship. That's the entire
gap between "a video with the logo on it" and "unmistakably this brand."
