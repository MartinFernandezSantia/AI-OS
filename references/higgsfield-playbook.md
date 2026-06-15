# Higgsfield Playbook

How to get the most out of Higgsfield on a tight credit budget, for emotionally-driven business content (real-estate as the worked example). Last researched 2026-06-14.

## The one rule that protects your credits

**Iterate on images. Commit on video.**

Image generations are cheap (~2 credits). Video generations are expensive (~8-9 credits each, more for premium models). Most wasted credits come from re-rolling video because the source frame was wrong. So:

1. Get the still frame *perfect* first (cheap loop).
2. Only then animate it (expensive, do it once).

Lock the image before you ever hit "generate video."

## Credit budget cheat-sheet

Costs vary by model and aren't always shown on the pricing page, but Higgsfield **displays the credit cost per generation before you confirm** — always read it. Rough ratios:

| Generation | Approx. credits | Notes |
|---|---|---|
| Nano Banana / Nano Banana Pro image | ~2 | Your cheap iteration workhorse |
| Flux / GPT-Image high-quality image | ~3-5 | Use only for hero frames |
| Kling / Seedance video clip | ~8-9 | Standard image-to-video |
| Veo 3 / premium video | higher | Save for the one hero shot |

With ~200 credits that's roughly **100 images OR ~20 video clips**, or a realistic mix of **~12-18 finished clips/month** if you iterate the image cheaply and animate once. Extra credits expire in 90 days. Don't hoard, don't waste.

## The validated pipeline (image -> video)

This is exactly the flow you described, confirmed by current real-estate workflows:

```
1. Source/clean photo   -> a real listing photo, or a generated scene
2. Nano Banana Pro       -> stage, declutter, relight, fix angle (cheap loop here)
3. Lock the still         -> straight angles, clean light, no people, no busy mirrors
4. Image-to-video         -> ONE camera move per clip, 4-8 seconds
5. Stitch                 -> 4-6 clips -> a 15-30s tour
```

Why image-to-video (not text-to-video): feeding a real frame costs fewer credits, kills hallucination, and keeps brand/property accurate. Text-to-video is for B-roll you can't photograph.

## Model picks (Higgsfield exposes 30+)

- **Image, fast iteration:** Nano Banana / Nano Banana Pro
- **Image, hero quality:** Flux (cinematic/editorial) or GPT-Image (polished)
- **Video, standard:** Kling or Seedance (good motion, lower cost — use for drafts and most clips)
- **Video, hero shot:** Veo 3 (top quality + synced audio) — one per piece, not every clip
- **Drone / aerial:** Higgsfield's DoP/drone model — convincing DJI-style trajectory from a single still
- **Cinema Studio:** can stack up to 3 simultaneous camera moves for advanced shots

If you don't specify, Higgsfield auto-selects. Specify when budget matters.

## Prompt formula (Higgsfield-specific)

```
[camera move/preset] + [subject/scene] + [time of day & lighting] + [mood/style] + [quality tags]
```

Rules that matter:
- **One camera move per clip** unless you're deliberately stacking in Cinema Studio.
- **Slow moves read premium.** Fast moves expose AI artifacts.
- **4-8 second clips.** Longer clips drift and distort.
- Don't ask the model to render text — add text in post.

### Real-estate camera presets

| Preset | Use it for |
|---|---|
| Dolly In | Front-door entry, room openings |
| 360 Orbit | Kitchen islands, dining tables, focal points |
| Crane Up | Exteriors, backyards, tall spaces |
| Dolly Out | Open-plan reveals |
| FPV / Drone | Floor-plan sweeps, aerial establishing shots |
| Tilt Up | Ceiling height, big windows |
| Handheld | Natural walk-through feel |
| Boom Down | Staircase transitions |
| Static Hero | Feature-room showcase |

### Ready-to-use prompts

- **Entry:** "slow dolly forward through the front entry into a bright open-plan living room, eye-level, smooth steady gimbal, warm natural daylight, photorealistic"
- **Kitchen:** "smooth orbit around a modern kitchen island, glide past the countertop and pendant lights, bright even lighting, premium real estate look"
- **Bedroom:** "slow dolly in toward a made bed in a calm primary bedroom, large window with soft morning light, steady motion"
- **Exterior:** "crane up over the front of a modern house at golden hour, reveal the facade and driveway, smooth rising motion, cinematic"
- **Backyard:** "slow dolly out from the patio to reveal the backyard and pool, late afternoon light, steady cinematic pull-back"
- **Drone reveal:** "FPV drone rising over a modern house at golden hour, glide forward and tilt down to reveal the property and street, realistic DJI trajectory, cinematic"

## The differentiator: sell the desire, not the asset

This is what makes content stop-scroll instead of stock-generic. People don't buy a house — they buy a future self: belonging, status, safety, the morning coffee on the patio. Encode the *emotional payoff* into the shot:

- **Time of day does the emotional work.** Golden hour = aspiration/arrival. Blue hour with warm interior lights = belonging/cozy. Bright morning = fresh start/calm.
- **Imply a life, not an empty room.** A set table, a lit fireplace, a book on the arm of a chair. (Generate these in the still with Nano Banana; don't rely on video to add them.)
- **Cinematic moves signal premium.** The slow crane reveal at golden hour reads "luxury listing," not "Zillow upload."
- **Reveal = dopamine.** Hide-then-reveal (dolly out, crane up, drone push) outperforms static. The brain rewards the unveil.
- **Match the move to the buyer's fantasy.** Family buyer: warm, lived-in, soft light. Luxury buyer: slow, wide, architectural, dramatic. Investor: clean, bright, efficient.

Same logic transfers to the print-shop and any other business: show the customer's win-state, not the product on a shelf.

## Where generated assets live

`project-context/<Project>/assets/` — e.g. `project-context/SantiaPropiedades/assets/`.

- **Finals** go in `assets/` (subfolder by type if useful: `images/`, `video/`). Committed and synced.
- **Drafts / re-rolls** go in `assets/drafts/` — gitignored, so the repo doesn't bloat with throwaway clips.
- **Naming:** `YYYY-MM-DD_subject_shot.ext` (e.g. `2026-06-14_kitchen_orbit.mp4`).

## Connecting it to Claude (the MCP)

The Higgsfield MCP lets Claude drive all 30+ models directly — no API keys, no glue code. That means Claude can run the whole pipeline: write the prompt, generate the image, iterate, then animate.

**Setup (Claude Code):**
```
claude mcp add --transport http -s user higgsfield "https://mcp.higgsfield.ai/mcp"
```
First tool call opens a browser OAuth on port 8080 — sign into Higgsfield, return to terminal, done. Verify with `/mcp`.

Note on this repo's rules: install at repo level, not user level. Prefer adding it to `.claude/settings.json` (committed) over `-s user` so it travels with the AIOS. Confirm with Martin before wiring.

**Critical:** Higgsfield runs generations on its server and does **not** ping Claude when done. Claude must poll every 60-90s to fetch finished assets, or it times out.

**Credit-saving hybrid:** use Higgsfield only for the hero visual; build text/title slides and overlays locally with HTML/CSS (Hyperframes/Remotion). Same look, fraction of the spend.

## Skills already in this repo that help

- `image` — model selection, prompt structure, web optimization, OG/social specs
- `video` — production approach, model comparison, programmatic overlays, repurposing
- `marketing-psychology` — desire/emotion hooks (the differentiator above)
- `social` — what to post, hooks, platform formats and aspect ratios
- `ad-creative` — scaling paid creative variations
- `copywriting` — scripts, captions, the text that rides on top of the visuals

## Sources

- [Higgsfield MCP playbook (zachdoesAI)](https://zachdoesai.com/guides/higgsfield-mcp-playbook/)
- [Generate AI Videos From Claude with Higgsfield MCP](https://higgsfield.ai/blog/Generate-AI-Videos-From-Claude-with-Higgsfield-MCP)
- [Higgsfield MCP](https://higgsfield.ai/mcp)
- [Real-estate camera presets & prompts (MeltFlex)](https://www.meltflexai.com/blog/higgsfield-real-estate-walkthrough-videos)
- [Higgsfield pricing 2026 (imagine.art)](https://www.imagine.art/blogs/higgsfield-ai-pricing)
- [Higgsfield free plan & pricing (Segmind)](https://blog.segmind.com/higgsfield-ai-features-pricing-guide/)
