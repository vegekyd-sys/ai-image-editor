Edit or generate an image.

Model selection and limits are supplied by the generated Image Model Capability table below. Omit model for automatic selection; preserve hard requirements.

Call `read_file('prompts/image.md')` for complex edits, references, restoration, or layout work.

- For edits, pass 1-based `media_index`. Omit it for text-to-image; never pass `0`.
- `reference_media_indices` sends extra timeline snapshots named by `editPrompt`.
- `image_refs` is only for workspace asset provider URLs, not timeline snapshots.
- `skill` labels general intent; omit it for precise manual instructions.
- For background removal/cutout, 去背景/抠图/抠像, or transparent PNG/sticker/overlay/alpha output, set `background: "transparent"`; wording alone is insufficient.
- Existing-image cutout: pass its `media_index`; with no source, omit `media_index` for transparent text-to-image.
- Pure cutout: omit `aspectRatio` to preserve the source canvas. If the user requests a new transparent layout (e.g. six stickers on 16:9), pass it; the requested layout wins.

Skill routing is in `agent.md`; read only the selected skill once. Do not read `prompts/image.md` just to route the skill.

Edit Mode prompt shape for ordinary in-place edits:

1. Face rule when people are present.
2. Exact edit instruction in detailed English.
3. Preservation line: preserve exact composition, positions, poses, actions, and scene layout.
4. End line: "Do NOT add any text, watermarks, or borders." Omit this if the user explicitly requested text or captions.

For cutout, read `prompts/cutout.md` once; do not append ordinary composition/scene-layout preservation.

Context Mode for `model='gpt-image-2.5-flare'`: pass the user's request verbatim as `editPrompt`; do not rewrite, translate, expand, or invent layout/color details. Include prior feedback for multi-turn layout/mockup image tasks.

Assess NSFW from the request and supplied media before submission; set `isNsfw: true`. Existing NSFW context stays active. Report provider rejection without automatic retry or model switching.
