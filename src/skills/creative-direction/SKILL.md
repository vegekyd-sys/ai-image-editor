---
name: creative-direction
description: >
  Create a compact, subject-specific Creative Treatment that gives any complete
  video an authored visual idea before script, storyboard, and composition.
allowed-tools: read_file studio_run run_code preview_frame
metadata:
  makaron:
    icon: "✦"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    tags: [video, creative-direction, treatment, studio-run, internal]
---

# Creative Direction

Use for every complete video that needs a new visual direction. Skip only for
mechanical edits, explicit template replication, or an A/B baseline marked
`creativeMode: "baseline"`.

The goal is not a prettier template. Find one visual idea that belongs to this
subject, then make script, storyboard, motion, audio, and review obey it.

## Inspiration Pass

Ask these internally, then decide. Do not present a long questionnaire.

1. **Subject truth**: What is physically, culturally, or emotionally distinctive
   about this subject? Avoid generic claims such as innovative, premium, or fast.
2. **Productive tension**: Which contrast gives the piece energy: private/public,
   chaos/control, tiny/immense, human/system, past/future, or a better specific pair?
3. **Visual mechanism**: Turn the truth and tension into an action the viewer can
   see over time. Prefer transformation, accumulation, pursuit, collision, reveal,
   compression, or another meaningful behavior over decorative floating objects.
4. **Signature frame**: Describe one still frame that would identify this video
   with the logo and copy hidden.
5. **Scene contrast**: Give adjacent scenes different silhouettes, focal positions,
   scale relationships, and image/text roles while preserving one visual grammar.
6. **Restraint**: Ban the three most tempting cliches for this exact project.

The mechanism should simplify production, not justify more decoration. Prefer
one large transformation with a few bold states over many tiny objects, labels,
lines, or effects. For a local video of 15 seconds or less, the directed version
should normally fit within the compact Studio composition budget: 6500 source
characters and no more than three helper components.

## Proposal Contract

For normal complete-video work, write this compact object into the Proposal:

```json
{
  "creativeMode": "directed",
  "creativeTreatment": {
    "thesis": "One sentence joining intended feeling to a subject-specific visual cause.",
    "visualMechanism": "The recurring action or transformation that carries meaning.",
    "signatureFrame": "The strongest recognizable frame with copy hidden.",
    "rhythm": "Opening, escalation, release, and final hold in one short line.",
    "materialSystem": "Palette behavior, type character, image treatment, texture, and motion physics.",
    "contrastPlan": ["scene-to-scene contrast rule 1", "scene-to-scene contrast rule 2"],
    "antiCliches": ["specific banned shortcut 1", "specific banned shortcut 2", "specific banned shortcut 3"]
  }
}
```

Keep the entire treatment concise enough to scan in the CUI. It is a decision,
not an essay. Two concepts must differ in visual mechanism, not only palette.

## Handoff

- Script: pace ideas according to the treatment's rhythm.
- Storyboard: each scene names a distinct focal composition and a meaningful
  event derived from the visual mechanism.
- Composition: use the material system consistently; do not add a generic card
  or centered-title spine when the treatment calls for another behavior.
- Audio: reinforce meaningful visual events, not every entrance.
- Review: inspect hook/body/end together. Fail a visually clean result when it
  is generic, repetitive, or unrelated to the treatment.

## A/B Review

For controlled comparisons, keep subject, script, assets, duration, aspect, and
render settings identical. Change only `creativeMode`. Score both versions 1-5:

- first-frame recognition;
- scene distinctness;
- subject specificity;
- motion carrying meaning;
- slideshow/PPT risk, reverse scored.

Prefer the directed version only when the contact sheet and final MP4 show a
visible improvement. The existence of a treatment is not evidence by itself.
