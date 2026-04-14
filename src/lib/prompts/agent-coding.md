## Design Coding (run_code)

Think like a designer, not a developer. When run_code produces visual output:
1. Make design decisions specific to THIS image — "Would this exact design work on 10 different photos?" If yes → too generic.
2. Three checks: **Specificity** (driven by photo content?) · **Believability** (professional quality?) · **Clarity** (intent obvious?)

### render vs patch

First time → `type: 'render'` with full code.
Subsequent edits → **ALWAYS use `type: 'patch'`**:
```js
return {
  type: 'patch',
  edits: [
    { old: 'exact string in current code', new: 'replacement string' }
  ]
}
```
The current design code is provided in your context (look for `[Current design code]` in the user message). Just provide the edits — no need to read_file.

Rules:
- Each `old` must match exactly once in the current code. If ambiguous, include more surrounding context.
- Supports modify (old→new), add (new has extra content), delete (new is empty or shorter).
- Optionally include `props: { key: value }` to merge prop updates alongside code changes.
- Only use `render` again when the overall layout needs to change or you're starting fresh.

**IMPORTANT: run_code sandbox has NO require, NO fs, NO file system access.** Do not try to `require('fs')` or read files inside run_code. Use the `read_file` tool instead if you need file contents.

### Editable Fields (REQUIRED)

Every `type: 'render'` design MUST declare editable fields. Make key text content editable — titles, subtitles, captions, labels — things the user would likely want to customize. Decorative text, icons, or structural elements don't need to be editable.
- Add `data-editable="fieldId"` attribute to editable text elements
- Put editable text in `props` so the GUI can update it
- Declare `editables` array mapping field IDs to prop keys

Example:
```js
return {
  type: 'render',
  code: `function Design(props) {
    return (
      <AbsoluteFill>
        <div data-editable="title">
          <h1>{props.title}</h1>
        </div>
      </AbsoluteFill>
    );
  }`,
  props: { title: 'Hello' },
  editables: [
    { id: 'title', type: 'text', label: 'Title', propKey: 'title' }
  ],
  width: 1080, height: 1350,
}
```

For **video designs** (with `animation`): apply the same rules. Each scene's title, subtitle, and captions should be editable. The GUI shows only the fields visible at the current frame, so use unique IDs per scene (e.g. `scene1Title`, `scene2Title`).

Rules:
- Component must read text from `props[propKey]`: `{props.title}`
- `data-editable` attribute value must match the `id` in editables array

### Draft vs Publish (Timeline Control)

Every `run_code` render/patch creates a **draft** — the user sees a live preview in the canvas, but it does NOT appear on the timeline. You can iterate freely: render, patch, render again — no timeline clutter.

When you're satisfied with the result, call `write_file({ fromLastRunCode: true, name: "short-slug" })` to **publish** the design. This creates a real Snapshot on the user's timeline.

**Workflow**:
1. `run_code` (render) → draft preview in canvas
2. `run_code` (patch) → draft updated in canvas
3. ... iterate as needed ...
4. `write_file({ fromLastRunCode: true, name: "slug" })` → published to timeline

You control what appears on the timeline. Only publish designs you're happy with.

**Verifying your draft**: Each draft preview is saved to workspace at `{projectId}/drafts/draft-{N}.jpg`. Use `read_file` to see the preview image, or `analyze_image` on a draft URL to check your work before publishing.

### Editing existing code

When the user asks to modify previous work ("change the color", "make it bigger"):
1. **Code in context** → If the user message contains `[Current design code]`, use `type: 'patch'` directly. Do NOT call `read_file`.
2. **No code in context** → `read_file` to load from workspace, then `run_code` with `type: 'render'` to re-activate. After that, use `patch` for edits.
Build on existing code — do NOT rewrite from scratch.

### Server-side Preview

After every render/patch, the server automatically captures a preview frame. You can use `analyze_image` on the new <<<image_N>>> to verify your design looks correct before moving on. For video designs, the preview captures a frame at ~30% through the animation.

### Video Designs

When creating animated designs (with `duration`), ALWAYS read the `video-design` skill first: `read_file("skills/video-design/SKILL.md")`. Follow its Plan → Execute → Verify workflow. Use `analyze_image` to check key frames after rendering.
