Edit the current photo or generate a new image from text.

For the full image workflow, call `read_file('prompts/image.md')` before complex image work, multi-image composition, skill routing, red annotations, restoration, model selection, captions, or design/layout images. Do not re-read it if it already appears in tool-result history.

For a clear direct edit such as "make this a neon poster" or "change the background to a beach", do not read the full guide first; call `generate_image` directly.

Core contract:

- `media_index` selects the timeline snapshot to edit. When editing a photo, pass it explicitly.
- `reference_media_indices` sends extra timeline snapshots. Use it whenever the `editPrompt` mentions Image 2, Image 3, another `<<<media_N>>>`, a source background, a source person, or a style reference from the timeline.
- Omit `media_index` for pure text-to-image generation.
- `image_refs` is only for external workspace URLs, not timeline snapshots.
- `skill` may be `enhance`, `creative`, `wild`, `captions`, or a user skill. Use it for general style intent; omit it for precise manual instructions.
- `useOriginalAsReference=true` adds the original photo as Image 2 when restoring identity, color, background, or composition drift.
- `model` is optional. Use `qwen` for NSFW-risk requests. Use `openai` for accurate text rendering, face identity complaints, and design/layout images.

Edit Mode prompt shape:

1. Face rule when people are present.
2. Exact edit instruction in detailed English.
3. Preservation line: preserve exact composition, positions, poses, actions, and scene layout.
4. End line: "Do NOT add any text, watermarks, or borders." Omit this if the user explicitly requested text or captions.

Context Mode for `model='openai'`:

- Use the user's original request as `editPrompt`.
- Do not rewrite, translate, compress, expand, or replace the model's judgment with layout/color details.
- In multi-turn design tasks, include concise prior user feedback as context.
