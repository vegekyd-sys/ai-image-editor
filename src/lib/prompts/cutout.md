# Transparent Cutout Prompt Contract

Read this file once before any existing-image background removal, subject
isolation, cutout, 抠图, 抠像, or transparent PNG extraction. This is the
canonical `editPrompt` contract for GPT Image 2. Sticker and video Skills may
add staging or QA requirements, but must not replace or weaken this contract.

## Tool Contract

- Existing image: pass its literal 1-based `media_index` and set
  `background: "transparent"`.
- No source image: omit `media_index` and set `background: "transparent"` for
  transparent text-to-image.
- Never use prompt wording, white, checkerboard, or chroma as a substitute for
  the `background` field. Never fall back to an opaque provider.
- Do not append the ordinary "preserve exact composition / scene layout" line.
  A cutout intentionally removes that scene.

## Existing-Image Prompt Order

Write the `editPrompt` in detailed English in this order:

1. **Intent:** begin exactly with:
   `Pixel-faithful foreground extraction, not a redesign or regeneration.`
2. **Keep:** say `Keep only ...` and name every intended subject plus any
   attached, worn, held, or directly interacted-with item that must survive.
3. **Preserve:** enumerate the original details whose fidelity matters.
4. **Remove:** enumerate the background and excluded objects or graphics. Do
   not rely on a generic "remove background" when the scene is complex.
5. **Prohibit:** say not to beautify, retouch, restyle, alter anatomy or
   geometry, or invent hidden details.
6. **Deliver:** end with:
   `Return a real transparent PNG with clean natural edges and no halo, shadow, border, text, or background.`

If text, glow, a shadow, or another element is part of the intended foreground
asset, explicitly preserve it and remove that noun from the delivery exclusion.

## Content-Specific Preservation

Choose only the details that exist in the source and matter to the request.

- **Person:** exact identity, face, expression, skin texture, hair and flyaway
  strands, glasses, earrings, clothing, pose, proportions, visible arms,
  hands, fingers, and held objects.
- **Multiple people:** identify subjects by position or appearance. Say that
  they may remain disconnected foreground subjects. Preserve each identity and
  explicitly remove unrelated people.
- **Text or graphics over people:** explicitly remove every overlay, burst,
  logo, caption, border, and scene object while preserving the visible people.
  Do not invent hidden body areas.
- **Semi-transparent UI or effects:** preserve exact layout, color, glow,
  translucency, holes, and semi-transparent pixels; remove only the physical
  environment and unrelated devices.
- **Architecture:** preserve exact geometry, perspective, materials, windows,
  balcony slabs, columns, podiums, and connected structures. Explicitly remove
  sky, ground, roads, vehicles, people, trees, and landscaping. Do not
  straighten, enhance, rebuild, or invent occluded architecture.

## Selection Rules

- Preserve only the intended foreground, not every prominent object.
- Attached or directly held items belong to the subject only when the request
  implies they should remain.
- For thin hair, fingers, rails, holes, glass, glow, or translucent materials,
  name them explicitly; generic preservation language is not enough.
- Keep the source crop and visible extent. Do not ask the model to complete
  cropped limbs, bodies, buildings, or objects unless the user requests it.

## Transparent Text-to-Image

With no source, describe the wanted subject, pose, material, camera angle, full
silhouette, and transparent padding. Request no floor, horizon, environmental
shadow, border, unrelated object, or scenic background. Do not use the
pixel-faithful extraction opening because there are no source pixels to retain.
