## Remotion Composition

Use this prompt only for editable Remotion compositions: motion graphics, video timelines, subtitles, kinetic typography, overlays, trims, title cards, and patchable composition drafts.

Use `runtime: "composition"` for new work. `runtime: "design"` is a legacy alias that maps to the same implementation.

When the user asks to put two existing timeline videos together, cut clips freely, add transitions, add subtitles, or make a sequence that can be edited later, this is the default runtime. Use Remotion `<Sequence>` and `<Video>` rather than FFmpeg.

Do not fall back to FFmpeg/node for ordinary timeline splicing just because a preview needs adjustment or the first composition attempt is imperfect. Patch the Remotion composition, save/publish the editable composition, or report the preview issue. Use FFmpeg only when the user explicitly asks for a real file-level MP4 operation/export.

For timeline media, use actual Media Index URLs in props or code. Do not leave `<<<media_N>>>` placeholders inside `props.clipA`, `<Video src>`, or saved composition code. `<<<media_N>>>` is only a conversational reference; Remotion preview/export needs a real URL.

Do not use this prompt for static posters, infographics, e-commerce pages, or ordinary layout images unless the user explicitly asks for editable code or animation.

## Canvas Aspect Contract

For timeline videos, derive the Remotion canvas from the selected Media Index video dimensions. Preserve the source aspect ratio unless the user explicitly asks to reframe.

- If the selected videos share a 9:16 aspect (for example `360x640`, `720x1280`, or `1080x1920`), return a 9:16 canvas such as `width: 1080, height: 1920`. Never place 9:16 timeline videos into a 16:9 canvas.
- If the selected videos share a 16:9 aspect, use a 16:9 canvas such as `width: 1920, height: 1080`.
- If the selected videos share a square aspect, use a square canvas such as `width: 1080, height: 1080`.
- If dimensions are mixed, choose the user's target platform/aspect when stated; otherwise preserve the current composition's aspect when editing, or use `contain` with an intentional background instead of silently cropping into the wrong aspect.
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

## Remotion APIs

Available APIs include all exports from `remotion`, `@remotion/media`, `@remotion/paths`, and `@remotion/noise`.

- Use Remotion `<Img>`, never HTML `<img>`.
- Use Remotion `<Video>` or `<OffthreadVideo>`, never HTML `<video>`.
- Use `<Sequence>` for every scene or clip so media mounts only when needed.
- Use `trimBefore`, `trimAfter`, `playbackRate`, and `volume` on `<Video>` for non-destructive timeline edits.
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

## Editable Fields

Every user-facing text field should be editable.

Required connections:
- `props`: stores the editable value.
- JSX reads from props: `{props.title}`.
- `data-editable="title"` is on a block or inline-block wrapper.
- `editables`: maps the field id to `propKey`.

Correct pattern:

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
- Visual verification is required for transitions, subtitles, overlays, trim timing, cropping, or any composition you are about to publish to the timeline.
- If `preview_frame` returns an image or no explicit textual error, do not infer a Remotion compatibility failure from missing prose. Continue by patching if needed, then save/publish the composition.
- For trim edits, verify the final `animation.durationInSeconds` matches the actual total frame count before saving or publishing.
- Capture stable middle frames for each scene, not transition starts.
- Check subject cropping, text readability, overlay placement, and final frame content.
