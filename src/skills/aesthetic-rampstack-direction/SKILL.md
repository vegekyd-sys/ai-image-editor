---
name: aesthetic-rampstack-direction
description: >
  A Makaron aesthetic lens adapted from Rampstack Creative Direction and Art
  Direction, translating a video's subject into coherent visual axes and a
  specific production look.
allowed-tools: read_file
metadata:
  makaron:
    icon: "◇"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    sourceProject: "github:rampstackco/claude-skills@bc6d96180124d7469b19f2641678963d7bdcf924"
    sourceSkill: "creative-direction+art-direction"
    sourceKind: "agent-skill"
    supportLevel: "adapted"
    adapterFamily: "aesthetic"
    tags: [aesthetic, art-direction, video, mit]
---

# Rampstack Direction Lens

Adapted from Rampstack's MIT-licensed Creative Direction and Art Direction
skills. Apply it only through `skills/_shared/aesthetic-lens-contract.md`.

## Direction Axes

Choose a gravitational center on each axis from the subject, audience, goal,
and reference media. Do not ask the user during auto-approved production.

- **Tone**: professional / conversational / playful / provocative.
- **Aesthetic philosophy**: editorial restrained / polished standard /
  controlled maximalist / expressive maximalist.
- **Audience relationship**: authority / peer / companion / coach.
- **Sensory ambition**: functional / considered / resonant.

Surface tensions. A playful subject does not automatically require maximalist
frames; a resonant film does not automatically require darkness or slow motion.
The selections must exclude alternatives and materially change the frame.

## Five-Layer Video Direction

1. **Story**: premise, emotional through-line, role of the subject, takeaway.
2. **Look**: composition scale, crop, lighting, palette, material, typography,
   transition family, and reference-subject treatment.
3. **Execution**: required hero frames, reusable motifs, and production limits.
4. **Variants**: ensure the look survives the target aspect without shrinking
   the subject into a decorative badge.
5. **Standards**: define what an approved and rejected representative frame
   looks like.

## Distinctness Rules

- Replace vague terms such as "modern, clean, premium" with visible decisions.
- Use a specific recurring visual mechanism, not a style collage.
- State what to avoid. A rejection list is more useful than extra adjectives.
- Let the reference subject carry the story. Do not bury it inside generic SaaS
  cards, dashboard chrome, or an interchangeable neon background.
- Composition, lighting, texture, and type must answer the same axis choices.

## Handoff

Encode the chosen axes and rejection list inside the proposal rationale and
storyboard art direction. The downstream Composition should feel impossible to
mistake for a different four-axis combination.
