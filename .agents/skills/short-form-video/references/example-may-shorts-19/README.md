# Example: may-shorts-19 (source only)

The canonical short-form vertical reference the `short-form-video` skill is built
around — 18.84s, 1080×1920, 7 scenes, face-mode choreography, karaoke captions
(with a `shift()` retime function), ambient background + seam treatment.

**This is a read reference, not a runnable project.** To keep AIOS lean and stay
clear of licensing, the following were stripped from the original:

- all media — `final.mp4`, `may_shorts_19.mp4` / `-edit.mp4` / `.wav`, transcript JSON
- AIS brand assets — `AIS Logo PNG.png`, the brand guideline image, `brand-tokens.css`
  (those are AI Automation Society property, not MIT-licensed)
- the `compositions/_archive/` scratch files

What remains is the MIT-licensed composition source: `index.html`,
`compositions/*.html`, `meta.json`, `hyperframes.json`. Read these to see how the
4-layer scaffold, face-mode array, scene sub-compositions, and karaoke captions
fit together. The `--ais-*` CSS custom properties they reference are just token
names — define your own in a project `brand-tokens.css` per
`references/hyperframes-brand-capture.md` (two levels up).

Source: Nate Herk, hyperframes-student-kit (MIT). Framework © HeyGen.
