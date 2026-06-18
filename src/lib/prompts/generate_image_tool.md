Edit the current photo or generate a new image from text.

For the full image workflow, call `read_file('prompts/image.md')` before complex image work, multi-image composition, skill routing, red annotations, restoration, model selection, captions, or layout/mockup images. Do not re-read it if it already appears in tool-result history.

For a clear direct edit such as "make this a neon poster" or "change the background to a beach", do not read the full guide first; call `generate_image` directly.

Core contract:

- `media_index` selects the timeline snapshot to edit. When editing a photo, pass it explicitly.
- `reference_media_indices` sends extra timeline snapshots. Use it whenever the `editPrompt` mentions Image 2, Image 3, another `<<<media_N>>>`, a source background, a source person, or a style reference from the timeline.
- Omit `media_index` for pure text-to-image generation.
- `image_refs` is only for workspace asset provider URLs, not timeline snapshots.
- `skill` may be `enhance`, `creative`, `wild`, `captions`, or a user skill. Use it for general style intent; omit it for precise manual instructions.
- To restore details from the original photo, edit the current snapshot with `media_index` and pass the original timeline snapshot, usually `<<<media_1>>>`, through `reference_media_indices`.
- `model` is optional. Use `qwen` for NSFW-risk requests. Use `openai` for accurate text rendering, face identity complaints, layout/mockup images, and director storyboard images required by `long-video-director`.

Built-in skill fast-path routing is summarized in `agent.md`. If that fast path selects a built-in skill, read only that one skill prompt file once, unless it already appears in tool-result history. Do not read `prompts/image.md` just to route the skill. For precise manual instructions, omit `skill` and write the full editPrompt yourself.

Edit Mode prompt shape:

1. Face rule when people are present.
2. Exact edit instruction in detailed English.
3. Preservation line: preserve exact composition, positions, poses, actions, and scene layout.
4. End line: "Do NOT add any text, watermarks, or borders." Omit this if the user explicitly requested text or captions.

Context Mode for `model='openai'`:

- Use the user's original request as `editPrompt`.
- Do not rewrite, translate, compress, expand, or replace the model's judgment with layout/color details.
- In multi-turn layout/mockup image tasks, include concise prior user feedback as context.
