---
name: aesthetic-lottiefiles-motion
description: >
  A Makaron aesthetic lens adapted from LottieFiles Motion Design, giving video
  scenes a coherent motion personality, layered choreography, and material feel.
allowed-tools: read_file
metadata:
  makaron:
    icon: "↝"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    sourceProject: "github:lottiefiles/motion-design-skill@f9a8a041b85185ee4881b3471d3415e939aac772"
    sourceSkill: "motion-design"
    sourceKind: "agent-skill"
    supportLevel: "adapted"
    adapterFamily: "aesthetic"
    tags: [aesthetic, motion-design, choreography, video, mit]
---

# LottieFiles Motion Lens

Adapted from LottieFiles' MIT-licensed Motion Design skill. Apply it only through
`skills/_shared/aesthetic-lens-contract.md` and translate timing to deterministic
Remotion frames.

## Three Pillars

Every important motion decision must connect:

- **Emotional intent**: what the viewer should feel.
- **Visual narrative**: setup -> action -> resolution.
- **Motion craft**: believable paths, weight, easing, and follow-through.

## Motion Personality

Choose one dominant personality for the film and calibrate it to the subject:

- **Playful**: curved paths, controlled overshoot, quick anticipation.
- **Premium**: controlled arcs, longer settling, little or no overshoot.
- **Corporate**: direct paths, restrained amplitude, precise rhythm.
- **Energetic**: sharp acceleration, bold scale change, decisive cuts.

Define one signature easing family, a three-value duration palette in frames,
and one recognizable entrance grammar. Vary scenes without changing worlds.

## Three Motion Layers

- **Primary**: the single action the viewer follows.
- **Secondary**: delayed reactions, shadow/edge response, small companion motion.
- **Ambient**: restrained background life that supports depth and atmosphere.

Do not turn this into more objects. A layer can be a light response, crop shift,
texture drift, or counter-motion. At most one third of visible elements should
be in prominent motion simultaneously.

## Material Motion

Let the chosen material change timing and path:

- rigid surfaces settle slowly without overshoot
- elastic forms compress, stretch, and settle
- fluid/light forms move in longer curves
- paper-like planes carry slight fold/lag
- glass-like forms move crisply and reveal through refraction or light

Use entrance deceleration, exit acceleration, and curved on-screen movement.
Important changes should not be opacity-only. Keep motion distance below one
third of the frame unless an intermediate pose changes the action.

## Handoff

Put the motion personality, frame-duration palette, primary/secondary/ambient
layers, and material behavior into the storyboard motion language. Review actual
frames for staging and the preview sequence for rhythm; do not judge motion from
CSS-like adjectives.
