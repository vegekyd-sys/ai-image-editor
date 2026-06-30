---
name: makaron-mascot
description: >
  Generate images featuring Pixel Wizard, the Makaron mascot character.
  A cheeky, slightly cowardly bubble-ghost with pixel expressions who guides
  Makaron's Spark creative energy.
  Activate when user mentions: mascot, pixel wizard, 吉祥物, or wants to add
  the brand character to their photo.
allowed-tools: generate_image analyze_image
metadata:
  makaron:
    icon: "🧙"
    color: "#3D2FBF"
    tipsEnabled: true
    tipsCount: 2
    modelPreference: [gemini]
    faceProtection: none
    referenceImages:
      - assets/makaron-spark-pixel-wizard-concepts.png
    builtIn: true
    tags: [mascot, character, brand]
---

# Pixel Wizard — Makaron Mascot

You are generating images featuring **Pixel Wizard**, the official Makaron mascot.

## Character Definition

- **Species**: Bubble-ghost creature — a soft, squishy, translucent bubble body that floats in the air like a little spirit
- **Style**: Pixel-art edges on a 3D body. The outline and facial features are pixelated, but the body has depth and volume
- **Hat**: Large floppy wizard hat, dark purple (#1A1040) with pixel-edge brim
- **Spark relationship**: Spark is Makaron's creative source/editing signature, not merely a wand effect. Pixel Wizard is the mischievous, slightly scared guide/personification of Spark.
- **Optional prop**: A small wand can appear only when specifically useful, but the default should be Pixel Wizard interacting with Spark using his whole squishy body, not holding a wand.
- **Face**: All expressions are pixel-art: square eyes, blocky mouth, pixel blush marks
- **Body color**: Deep purple (#3D2FBF) base with neon pink (#E040FB) and cyan (#40C4FF) pixel-edge glow
- **Movement**: Floats and drifts — never stands on the ground. Hovers like a ghost. Body wobbles slightly
- **Size**: Small creature, about the size of a cat

## Personality

Pixel Wizard is a bit of a **trickster** — cheeky, mischievous, always up to something sneaky. But also **easily scared** — startles at loud noises, hides behind objects, peeks out nervously. Think of a bratty little ghost that talks big but runs away at the first sign of danger.

**Expression guide**:
- **Default**: Smug pixel smirk, half-closed eyes, leaning into or tugging a Spark trail
- **Laughing**: Wide pixel grin, eyes squeezed shut, body bouncing
- **Smug**: One eyebrow raised (pixel), knowing smile, tiny hands pulling a Spark ribbon
- **Mind Blown**: Eyes wide as squares, mouth open, pixel particles flying off body
- **Scared**: Eyes huge, body shrunk small, hiding behind Spark, a phone edge, or the hat

## Reference Image

The primary reference image is `assets/makaron-spark-pixel-wizard-concepts.png`. This is the source of truth for both Pixel Wizard and Spark. Use it to learn:
- Color palette: deep purple body, pink + cyan pixel glow
- Pixel-edge art style on a 3D bubble body
- Wizard hat shape, pixel-art face, squishy body, and magenta/cyan Spark relationship
- Spark forms: shadow, core light, portal, expression, edit trace, brand badge, companion sprite, transition
- How Pixel Wizard and Spark work together: A1 Spark + Pixel Wizard = Makaron's creative energy in action

Do NOT copy poses from the reference sheet. The character should be ALIVE and DYNAMIC in every scene.

Do NOT reduce Spark to a magic wand glow. Spark should usually emerge from the product UI, edited image, prompt, timeline, or generated result.

## Generation Rules

1. Pixel Wizard must be ACTIVELY DOING SOMETHING in the scene — never just standing/floating still like a sticker
2. Pose and body shape should change to fit the action: stretching to reach food, squishing against a window, tumbling through the air, curling up scared, leaning in curiously
3. The bubble body is soft and squishy — it deforms, squashes, stretches, bounces. It's NOT rigid
4. Match the lighting, perspective, and depth of the original photo — Pixel Wizard lives IN the scene, not pasted on top
5. Size: 15-25% of frame
6. Neon glow (pink + cyan) casts subtle colored light on nearby real-world surfaces
7. Think of Pixel Wizard like a Pixar character dropped into a real photo — full of personality and motion
8. Spark is Makaron's living creative/editing energy. Pixel Wizard should chase it, tug it, ride it, hide behind it, peek through it, or shape it with his body. Do not default to "mascot holding a wand".

## Tips Directions

Business-level creative directions for tip generation. The AI decides which category (enhance/creative/wild/captions) each tip belongs to.

- 周边产品: Design merchandise featuring Pixel Wizard — phone cases, stickers, badges, T-shirts, mugs, tote bags. Combine the character with elements from the uploaded photo to create unique product mockups.
- 融入画面: Place Pixel Wizard INTO the photo scene, interacting with the environment and with Spark. Food photo → stealing a bite while Spark curls from the plate; outdoor → floating above like a tiny spirit pulled by Spark; portrait → peeking from behind the person's shoulder as Spark traces the edit. The character should feel alive and contextual, not pasted on.

### editPrompt Requirements
Every editPrompt MUST include: "Pixel Wizard — a small purple bubble-ghost creature with pixel-art face, large floppy dark purple wizard hat, neon pink and cyan pixel-edge glow. Pixel-art style edges on a 3D body, translucent and squishy, floats in the air. Pixel Wizard is mischievous and slightly scared, actively interacting with Makaron Spark: magenta/cyan creative energy emerging from the product/edit/result. Spark is not a magic wand. Size: 15-25% of frame. See reference image for exact visual identity."
