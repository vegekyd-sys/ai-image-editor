Edit the current photo or generate a new image from text.

Call `read_file('prompts/image.md')` before complex, multi-image, annotated, restoration, caption, model-selection, or layout work.

For a clear direct edit, call `generate_image` without reading the full guide first.

Core contract:

- For edits, pass the 1-based `media_index`. Omit it for text-to-image; never pass `0`.
- `reference_media_indices` sends extra timeline snapshots named by `editPrompt`.
- To restore original detail, include that snapshot through `reference_media_indices`.
- `image_refs` is only for workspace asset provider URLs, not timeline snapshots.
- `skill` labels general intent; omit it for precise manual instructions.
- `model` is optional. Use `qwen` for NSFW risk; `openai` for layout/mockup images and director storyboard images required by `long-video-director`; `gemini-lite` only on explicit Lite requests.
- Background removal, subject isolation/cutout, 去背景/抠图/抠像, or transparent PNG/sticker/overlay/alpha delivery means: set `background: "transparent"`; prompt wording alone is insufficient.
- Existing-image cutout: pass its `media_index`; with no source, omit `media_index` for transparent text-to-image.
- Existing-image cutout: omit `aspectRatio`; Makaron uses Image 2 `size: "auto"` and restores the source canvas dimensions without stretching or cropping the generated cutout.
- Transparent output is strict: it uses GPT Image 2 only and never returns an opaque fallback. Otherwise omit `background`.

Built-in skill routing is in `agent.md`; read only that one skill prompt file once. Do not read `prompts/image.md` just to route the skill.

Edit Mode prompt shape for ordinary in-place edits:

1. Face rule when people are present.
2. Exact edit instruction in detailed English.
3. Preservation line: preserve exact composition, positions, poses, actions, and scene layout.
4. End line: "Do NOT add any text, watermarks, or borders." Omit this if the user explicitly requested text or captions.

Transparent cutout: read `prompts/cutout.md` once, follow its canonical ordered contract, and do not append ordinary composition/scene-layout preservation.

Context Mode for `model='openai'`: pass the user's request verbatim as `editPrompt`; do not rewrite, translate, expand, or invent layout/color details. For multi-turn layout/mockup image tasks, include concise prior feedback.
