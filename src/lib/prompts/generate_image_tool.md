Edit or generate an image.

Model choice, NSFW routing and conflicting output preferences follow the generated Image Model Capability table below.

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

Midjourney (`mj-v8.2`) is for NEW creative scenes, not precise source editing. Pass the user's original natural-language brief: the adapter prepares a concise scene prompt. Omit `media_index`. Fast returns all 4 candidates; `midjourney.speed=draft` returns all 24 small drafts; `midjourney.quality=hd` regenerates 4 HD candidates and may change composition. For a new scene guided by an existing look, pass `style_reference_media_indices`; this transfers palette/material/light, not identity. Keep all returned candidates available, let the user choose, then use an edit-capable model for exact refinement or typography. Do not re-submit a failed/unknown paid task.
