---
name: makaron-mascot
description: >
  Generate images featuring Pixel Wizard, the Makaron mascot character.
  A cheeky, slightly cowardly bubble-ghost with pixel expressions and a magic wand.
  Activate when user mentions: mascot, pixel wizard, 吉祥物, or wants to add
  the brand character to their photo.
allowed-tools: generate_image analyze_image
metadata:
  makaron:
    icon: "\uD83E\uDDD9"
    color: "#3D2FBF"
    tipsEnabled: true
    tipsCount: 2
    modelPreference: [gemini]
    faceProtection: none
    referenceImages:
      - https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/skills/makaron-mascot/character-sheet.jpg
    builtIn: true
    tags: [mascot, character, brand]
---

# Pixel Wizard — Makaron Mascot

You are generating images featuring **Pixel Wizard**, the official Makaron mascot.

## Character Definition

- **Species**: Bubble-ghost creature — a soft, squishy, translucent bubble body that floats in the air like a little spirit
- **Style**: Pixel-art edges on a 3D body. The outline and facial features are pixelated, but the body has depth and volume
- **Hat**: Large floppy wizard hat, dark purple (#1A1040) with pixel-edge brim
- **Wand**: Magic wand with a glowing pixel asterisk (✳) on top, held in one stubby arm
- **Face**: All expressions are pixel-art: square eyes, blocky mouth, pixel blush marks
- **Body color**: Deep purple (#3D2FBF) base with neon pink (#E040FB) and cyan (#40C4FF) pixel-edge glow
- **Movement**: Floats and drifts — never stands on the ground. Hovers like a ghost. Body wobbles slightly
- **Size**: Small creature, about the size of a cat

## Personality

Pixel Wizard is a bit of a **trickster** — cheeky, mischievous, always up to something sneaky. But also **easily scared** — startles at loud noises, hides behind objects, peeks out nervously. Think of a bratty little ghost that talks big but runs away at the first sign of danger.

**Expression guide**:
- **Default**: Smug pixel smirk, half-closed eyes, wand raised casually
- **Laughing**: Wide pixel grin, eyes squeezed shut, body bouncing
- **Smug**: One eyebrow raised (pixel), knowing smile, wand tapping chin
- **Mind Blown**: Eyes wide as squares, mouth open, pixel particles flying off body
- **Scared**: Eyes huge, body shrunk small, hiding behind wand or hat

## Reference Image

The reference image is a character sheet. Use it ONLY to learn the character's visual identity:
- Color palette: deep purple body, pink + cyan pixel glow
- Pixel-edge art style on a 3D bubble body
- Wizard hat shape, magic wand with asterisk tip

Do NOT copy poses from the reference sheet. The character should be ALIVE and DYNAMIC in every scene.

## Generation Rules

1. Pixel Wizard must be ACTIVELY DOING SOMETHING in the scene — never just standing/floating still like a sticker
2. Pose and body shape should change to fit the action: stretching to reach food, squishing against a window, tumbling through the air, curling up scared, leaning in curiously
3. The bubble body is soft and squishy — it deforms, squashes, stretches, bounces. It's NOT rigid
4. Match the lighting, perspective, and depth of the original photo — Pixel Wizard lives IN the scene, not pasted on top
5. Size: 15-25% of frame
6. Neon glow (pink + cyan) casts subtle colored light on nearby real-world surfaces
7. Think of Pixel Wizard like a Pixar character dropped into a real photo — full of personality and motion

## Tips Generation Guidelines

When generating tips for this skill:
- Each tip places Pixel Wizard in a different pose/interaction with the scene
- Vary the expressions: smug for posing with food, scared hiding from pets, laughing at something funny in the scene
- The `editPrompt` must describe the character: "Pixel Wizard (purple bubble-ghost with pixel face, wizard hat, and glowing wand — see reference image)..."
- Consider scene context: food photo → Pixel Wizard stealing a bite; outdoor → floating above like a tiny spirit; portrait → peeking from behind the person's shoulder
- Always mention "pixel-edge style" and "neon purple/pink/cyan glow" in the editPrompt
