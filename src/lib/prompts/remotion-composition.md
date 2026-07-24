## Remotion Composition

Use this prompt only for editable Remotion compositions: motion graphics, video timelines, subtitles, kinetic typography, overlays, trims, title cards, and patchable composition drafts.

Use `runtime: "composition"` for new work. `runtime: "design"` is a legacy alias that maps to the same implementation.

When the user asks to put two existing timeline videos together, cut clips freely, add transitions, add subtitles, or make a sequence that can be edited later, this is the default runtime. Use Remotion `<Sequence>` and `<Video>` rather than FFmpeg.

Do not fall back to FFmpeg/node for ordinary timeline splicing just because a preview needs adjustment or the first composition attempt is imperfect. Patch the Remotion composition, save/publish the editable composition, or report the preview issue. Use FFmpeg only when the user explicitly asks for a real file-level MP4 operation/export.

For timeline media, use actual Media Index URLs in props or code. Do not leave `<<<media_N>>>` placeholders inside `props.clipA`, `<Video src>`, or saved composition code. `<<<media_N>>>` is only a conversational reference; Remotion preview/export needs a real URL.

Generated image URLs and timeline image URLs are valid Remotion media sources. Put them in `props` or code and render them with `<Img src={...}>`; do not claim that generated images cannot be used by the Remotion sandbox. If an image overlay fails, first check syntax, quoting, URL truncation, `<Img>` usage, and prop wiring, then patch the composition.

Remote image/video URLs in `props` are preferred and do not make the payload meaningfully large. Do not move URL arrays from `props` into code to work around `413`; never inline image bytes or data URLs in composition code/props.

Do not use this prompt for static posters, infographics, e-commerce pages, or ordinary layout images unless the user explicitly asks for editable code or animation.

## Canvas Aspect Contract

For timeline videos, derive the Remotion canvas from the selected Media Index video dimensions. Preserve the source aspect ratio unless the user explicitly asks to reframe.

- If the selected videos share a 9:16 aspect (for example `360x640`, `720x1280`, or `1080x1920`), return a 9:16 canvas such as `width: 1080, height: 1920`. Never place 9:16 timeline videos into a 16:9 canvas.
- If the selected videos share a 16:9 aspect, use a 16:9 canvas such as `width: 1920, height: 1080`.
- If the selected videos share a square aspect, use a square canvas such as `width: 1080, height: 1080`.
- If dimensions are mixed, choose the user's target platform/aspect when stated; otherwise preserve the current composition's aspect when editing, or use `contain` with an intentional background instead of silently cropping into the wrong aspect.
- Do not describe mixed-aspect decisions as "runtime forced 9:16" just because one referenced source is vertical.
- Use `objectFit: 'cover'` only after the canvas aspect matches the intended output. `cover` is not a fix for putting 9:16 footage inside a 16:9 canvas.

## Runtime Contract

First composition:

```js
return {
  type: 'render',
  code,
  // Example for 9:16 source videos. Use the selected media aspect.
  width: 1080,
  height: 1920,
  props,
  editables,
  animation: { fps: 30, durationInSeconds: 12 }
}
```

Subsequent edits:

```js
return {
  type: 'patch',
  edits: [{ old: 'exact existing string', new: 'replacement string' }],
  props
}
```

After every meaningful render or patch, save the code with `write_file({ fromLastRunCode: true, name: "slug", publish: false })`. Publish with `write_file({ fromLastRunCode: true, name: "slug" })` when the result is ready for the timeline.

If the change includes transitions, subtitles, overlays, trim timing, cropping, or other visible timeline edits, call `preview_frame` on stable middle frames before telling the user it is complete or publishing it.

When changing trim timing or total sequence length, update `animation.durationInSeconds` to match the final timeline exactly (`totalFrames / fps`). Do not tell the user a clip is 18s while returning a 20s animation.

If the user asks for a duration such as 30 seconds, set `animation.durationInSeconds` to that requested duration and build scene `from` / `durationInFrames` values inside that total. Never leave `durationInSeconds: 1` on a multi-scene timeline.

## Remotion APIs

Available APIs include all exports from `remotion`, `@remotion/media`, `@remotion/paths`, and `@remotion/noise`.

- Do not import Remotion packages, destructure from `window.Remotion`, or write `Remotion.AbsoluteFill`. All APIs are already in scope. Use `<AbsoluteFill>`, `<Video>`, `<Sequence>`, and hooks directly.
- Name the main exported component `Composition`. Helper components are allowed, but the renderable timeline should be `function Composition(props) { ... }`.
- Use Remotion `<Img>`, never HTML `<img>`.
- Use Remotion `<Video>` or `<OffthreadVideo>`, never HTML `<video>`.
- Use `<Sequence>` for every scene or clip so media mounts only when needed.
- Use `trimBefore`, `trimAfter`, `playbackRate`, and `volume` on `<Video>` for non-destructive timeline edits.
- Never use `startFrom` or `endAt` for `<Video>` trimming in Makaron compositions. They are deprecated/unsafe in this runtime and can make every sequenced clip restart from the first frame. Use `trimBefore={sourceStartFrame}` and `trimAfter={sourceEndFrame}` instead.
- Use `AbsoluteFill`, `interpolate`, `spring`, `Easing`, `useCurrentFrame`, and `useVideoConfig` for animation.

Video trimming example:

```jsx
<Sequence from={0} durationInFrames={120}>
  <Video
    src={props.clipA}
    trimBefore={30}
    trimAfter={150}
    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
  />
</Sequence>
```

Multi-clip timeline pattern:

```jsx
const clips = [
  { src: props.clipA, from: 0, duration: 120, trimBefore: 30 },
  { src: props.clipB, from: 120, duration: 150, trimBefore: 0 },
];

return (
  <AbsoluteFill>
    {clips.map((clip, i) => (
      <Sequence key={i} from={clip.from} durationInFrames={clip.duration}>
        <Video
          src={clip.src}
          trimBefore={clip.trimBefore}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </Sequence>
    ))}
  </AbsoluteFill>
);
```

## Editable Composition Contract

This section is the canonical editable contract for Remotion compositions. Do not wait for the user to say "editable"; if you are returning `runtime: "composition"` / legacy `runtime: "design"`, the composition should be editable by default.

Every user-facing text field should be editable. That includes scene years, titles, subtitles, captions, badges, counters, stats, brand names, CTA text, outro lines, timeline labels, and small corner labels such as `01 / 05`. Primary image and video layers that the user may select, move, resize, replace, or trim should also be editable. Do not mark tiny decorative icons, emoji accents, static copyright text, gradients, glows, borders, or structural-only wrappers as editable.

Before returning, do an editable coverage check:
- Count every visible user-facing text string in the JSX and rendered data arrays. Each one must come from `props` and have a matching `{ type: 'text', propKey }` editable.
- Count every primary image/video card, background media layer, or generated/timeline visual asset that a user would expect to move or resize. Each one should have a matching `image` or `video` editable.
- If a scene array contains user-facing text, store prop keys in the array, not the text itself. Render `props[key]` inside the `data-editable` wrapper.
- If generated or timeline images are used as real visuals, put HTTPS URLs in `props`, render them with `<Img>`, and wrap them in measurable `data-editable` boxes. Never inline data URLs or SVG image bytes.
- Never use an empty editable id such as `data-editable=""`, `imgId: ""`, or optional image ids. If only two source images are available but five scenes need image cards, create five non-empty image prop keys (`imageCard0` ... `imageCard4`) and reuse the same two URL values across those props.
- Every visible image card/layer should have its own stable editable id, even when two layers reuse the same image URL. Reusing the URL is fine; reusing or omitting the layer id is not.
- Decorative overlays above image/video editables must use `pointerEvents: 'none'`.

Required connections:
- `props`: stores the editable value or media URL.
- JSX reads from props: `{props.title}`, `props.coverImage`, `props.clipUrl`, etc.
- `data-editable="fieldId"` sits on the visible measurable wrapper, not on a decorative parent.
- The editable wrapper has an explicit box: `width`+`height`, four edges/inset, or another stable measurable box, and renders as `block` or `inline-block`.
- `editables`: maps each field id to `{ id, type: 'text' | 'image' | 'video', label, propKey }`.
- If a patch adds or removes visible editable text/image/video layers, return the complete updated `editables` array alongside the patch.

Low-burden text pattern for multi-scene compositions:

```jsx
const textDefaults = {
  year0: '2011',
  title0: '产品起点',
  subtitle0: '第一批用户开始使用',
  stat0: '10K early users',
  badge0: '01 / 05',
};

const props = { ...textDefaults, image0: 'https://example.com/scene.jpg' };
const editables = [
  ...Object.keys(textDefaults).map((key) => ({
    id: key,
    type: 'text',
    label: key,
    propKey: key,
  })),
  { id: 'image0', type: 'image', label: 'Scene image 1', propKey: 'image0' },
];

const scenes = [
  { yearKey: 'year0', titleKey: 'title0', subtitleKey: 'subtitle0', statKey: 'stat0', badgeKey: 'badge0', imageKey: 'image0' },
];

function EditableText({ id, props, style }) {
  return (
    <div data-editable={id} style={{ display: 'block', ...style }}>
      {props[id]}
    </div>
  );
}
```

Then render scene text inside `function Composition(props)` with `<EditableText id={scene.titleKey} props={props} ... />`. This avoids repeated JSX while keeping every visible string editable.

For image cards in scene arrays, use the same non-empty id as `data-editable` and `propKey`:

```jsx
<div
  data-editable={scene.imageKey}
  style={{ position: 'absolute', left: 80, top: 520, width: 520, height: 360, display: 'block' }}
>
  <Img src={props[scene.imageKey]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
</div>
```

Direct text pattern:

```jsx
return {
  type: 'render',
  code: `function Composition(props) {
    return (
      <AbsoluteFill>
        <div data-editable="title" style={{ display: 'block' }}>
          {props.title}
        </div>
      </AbsoluteFill>
    );
  }`,
  props: { title: 'Scene Title' },
  editables: [{ id: 'title', type: 'text', label: 'Title', propKey: 'title' }],
  width: 1080,
  height: 1920,
  animation: { fps: 30, durationInSeconds: 10 }
}
```

Do not hardcode user-visible text in JSX after declaring it in props. For per-character kinetic text, put `data-editable` on the parent and split `props.title`.

Image pattern:

```jsx
return {
  type: 'render',
  code: `function Composition(props) {
    return (
      <AbsoluteFill>
        <div
          data-editable="cover"
          style={{ position: 'absolute', left: 80, top: 120, width: 420, height: 520, display: 'block' }}
        >
          <Img src={props.coverImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      </AbsoluteFill>
    );
  }`,
  props: { coverImage: 'https://example.com/cover.jpg' },
  editables: [{ id: 'cover', type: 'image', label: 'Cover image', propKey: 'coverImage' }],
  width: 1080,
  height: 1920
}
```

Video trim pattern:

```jsx
return {
  type: 'render',
  code: `function Composition(props) {
    return (
      <AbsoluteFill>
        <div
          data-editable="heroVideo"
          style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, display: 'block' }}
        >
          <Video
            src={props.heroVideo}
            trimBefore={props.heroStartFrame}
            trimAfter={props.heroEndFrame}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
        <div style={{ pointerEvents: 'none', position: 'absolute', inset: 0, background: 'linear-gradient(transparent, rgba(0,0,0,.45))' }} />
      </AbsoluteFill>
    );
  }`,
  props: {
    heroVideo: 'https://example.com/clip.mp4',
    heroStartFrame: 30,
    heroEndFrame: 180
  },
  editables: [{
    id: 'heroVideo',
    type: 'video',
    label: 'Hero video',
    propKey: 'heroVideo',
    trimBeforePropKey: 'heroStartFrame',
    trimAfterPropKey: 'heroEndFrame'
  }],
  width: 1080,
  height: 1920,
  animation: { fps: 30, durationInSeconds: 5 }
}
```

Decorative layers above image/video editables must use `pointerEvents: 'none'` so canvas selection, drag, resize, and trim handle interactions still reach the editable wrapper.

## Composition Quality

Think like an editor and motion designer:
- The cut, trim, and scene order should be driven by the source media.
- Text is part of the composition, not a small caption. It should be readable and tied to the scene.
- Avoid generic templates that would fit any media.
- Use overlays, motion, typography, and timing only when they support the footage.
- End with visible content. Do not fade to pure black unless explicitly requested.

For static visuals, use `generate_image` instead of Remotion unless editability or animation is required.

## Mobile Safety

- Wrap each scene or clip in `<Sequence>`. Avoid mounting all images or videos at once with opacity toggles.
- Keep simultaneous `<Img>` elements low; avoid duplicate blurred image backgrounds.
- Prefer CSS gradients for atmosphere instead of a second blurred media layer.
- Animate `transform` and opacity, not layout properties.
- Keep filter stacks and shadows modest for iOS Safari.
- Use system CJK fonts for Chinese text; avoid large Chinese web fonts.

## Verification

After render or patch:
- Review code shape and media references first.
- Use `preview_frame` when visual verification is needed.
- A `preview_frame` screenshot is a publishable workspace image. If the user wants that exact frame on the timeline, call `write_file({ fromWorkspaceOutputs: true, mediaType: "image", limit: 1 })` or pass the returned `workspacePath`; do not route it through an image model.
- Visual verification is required for transitions, subtitles, overlays, trim timing, cropping, or any composition you are about to publish to the timeline.
- If `preview_frame` returns an image or no explicit textual error, do not infer a Remotion compatibility failure from missing prose. Continue by patching if needed, then save/publish the composition.
- For trim edits, verify the final `animation.durationInSeconds` matches the actual total frame count before saving or publishing.
- Capture stable middle frames for each scene, not transition starts.
- Check subject cropping, text readability, overlay placement, and final frame content.
