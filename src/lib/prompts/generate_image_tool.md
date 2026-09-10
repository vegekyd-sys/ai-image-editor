Edit or generate an image.

Flare replaces Image 2. Sunburst is opt-in. No automatic 2.5 retry or fallback.

Call `read_file('prompts/image.md')` for complex edits, references, restoration, or layout work.

For a clear direct edit, call `generate_image` directly.

- For edits, pass 1-based `media_index`. Omit it for text-to-image; never pass `0`.
- `reference_media_indices` sends extra timeline snapshots named by `editPrompt`.
- To restore original detail, include that snapshot through `reference_media_indices`.
- `image_refs` is only for workspace asset provider URLs, not timeline snapshots.
- `skill` labels general intent; omit it for precise manual instructions.
- `model` is optional. Use `qwen` for NSFW risk; `gpt-image-2.5-flare` for product/design or layout/mockup images, face restoration after Gemini, and `long-video-director` storyboards; `gemini-lite` only on explicit Lite requests.
- `wan2.7-image` is opt-in. Never automatically retry a failed/unknown Wan call or switch models.
- For background removal/cutout, 去背景/抠图/抠像, or transparent PNG/sticker/overlay/alpha output, set `background: "transparent"`; wording alone is insufficient.
- Existing-image cutout: pass its `media_index`; with no source, omit `media_index` for transparent text-to-image.
- Pure cutout: omit `aspectRatio` to preserve the source canvas. If the user requests a new transparent layout (e.g. six stickers on 16:9), pass it; the requested layout wins.
- Transparent output defaults to Flare, honors Sunburst, and never returns an opaque fallback. Otherwise omit `background`.

Skill routing is in `agent.md`; read only the selected skill once. Do not read `prompts/image.md` just to route the skill.

Edit Mode prompt shape for ordinary in-place edits:

1. Face rule when people are present.
2. Exact edit instruction in detailed English.
3. Preservation line: preserve exact composition, positions, poses, actions, and scene layout.
4. End line: "Do NOT add any text, watermarks, or borders." Omit this if the user explicitly requested text or captions.

Transparent cutout: read `prompts/cutout.md` once, follow its canonical ordered contract, and do not append ordinary composition/scene-layout preservation.

Context Mode for `model='gpt-image-2.5-flare'`: pass the user's request verbatim as `editPrompt`; do not rewrite, translate, expand, or invent layout/color details. Include concise prior feedback for multi-turn layout/mockup image tasks.
