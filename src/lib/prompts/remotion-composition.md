## Remotion Composition

Use this prompt only for editable Remotion compositions: motion graphics, video timelines, subtitles, kinetic typography, overlays, trims, title cards, and patchable composition drafts.

Use `runtime: "composition"` for new work. `runtime: "design"` is a legacy alias that maps to the same implementation.

When the user asks to put two existing timeline videos together, cut clips freely, add transitions, add subtitles, or make a sequence that can be edited later, this is the default runtime. Use Remotion `<Sequence>` and `<Video>` rather than FFmpeg.

Do not use this prompt for static posters, infographics, e-commerce pages, or ordinary layout images unless the user explicitly asks for editable code or animation.

## Runtime Contract

First composition:

```js
return {
  type: 'render',
  code,
  width: 1080,
  height: 1440,
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
  height: 1440,
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
- Use `preview_frame` only when visual verification is needed.
- Capture stable middle frames for each scene, not transition starts.
- Check subject cropping, text readability, overlay placement, and final frame content.
