Edit the current photo or generate a new image from text.

Call `read_file('prompts/image.md')` before complex, multi-image, annotated, restoration, caption, model-selection, or layout work.

For a clear direct edit, call `generate_image` without reading the full guide first.

Core contract:

- `media_index` selects the timeline snapshot to edit. When editing a photo, pass it explicitly.
- `reference_media_indices` sends extra timeline snapshots mentioned by `editPrompt`.
- Omit `media_index` entirely for pure text-to-image generation. Never pass `0`.
- `image_refs` is only for workspace asset provider URLs, not timeline snapshots.
- `skill` may be `enhance`, `creative`, `wild`, `captions`, or a user skill. Use it for general style intent; omit it for precise manual instructions.
- To restore details from the original photo, edit the current snapshot with `media_index` and pass the original timeline snapshot, usually `<<<media_1>>>`, through `reference_media_indices`.
- `model` is optional. Use `qwen` for NSFW risk; `openai` for text, identity, layout/mockup images, and director storyboard images required by `long-video-director`; `gemini-lite` only when the user asks for Nano Banana 2 Lite / Lite.
- Background removal, subject isolation/cutout, 去背景/抠图/抠像, or transparent PNG/sticker/overlay/alpha delivery means: set `background: "transparent"`; prompt wording alone is insufficient.
- For a transparent cutout of an existing image, pass its `media_index` so GPT Image 2 runs image-to-image and preserves the subject. With no source image, omit `media_index` for transparent text-to-image.
- Transparent output is strict: it uses GPT Image 2 only and never returns an opaque fallback. Otherwise omit `background`.

Built-in skill routing is in `agent.md`. If selected, read only that one skill prompt file once. Do not read `prompts/image.md` just to route the skill. For precise instructions, omit `skill`.

Edit Mode prompt shape:

1. Face rule when people are present.
2. Exact edit instruction in detailed English.
3. Preservation line: preserve exact composition, positions, poses, actions, and scene layout.
4. End line: "Do NOT add any text, watermarks, or borders." Omit this if the user explicitly requested text or captions.

Context Mode for `model='openai'`: pass the user's request verbatim as `editPrompt`; do not rewrite, translate, expand, or invent layout/color details. For multi-turn layout/mockup image tasks, include concise prior feedback.
