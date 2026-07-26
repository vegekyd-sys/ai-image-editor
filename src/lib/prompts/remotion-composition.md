## Remotion Composition

Use this prompt only for editable Remotion compositions: motion graphics, video timelines, subtitles, kinetic typography, overlays, trims, title cards, and patchable composition drafts.

Use `runtime: "composition"` for new work. `runtime: "design"` is a legacy alias that maps to the same implementation.

If the user explicitly asks to use Remotion, make reasonable creative assumptions and build the composition instead of asking a clarifying question. For broad themes such as "35秒微信成长视频", create an editable placeholder narrative with plausible scene labels, dates, counters, and captions; the user can refine the copy after seeing a draft.

## Director Contract

Every editable Remotion composition must be planned as a video, not as a web
layout. Before creating a new composition, or making a major visual/timing
patch to an existing composition, read
`skills/_shared/remotion-director-contract.md`.

Relationship:
- Director layer: purpose, audience, core message, emotional arc, scene order,
  pacing, focal subject, transition language, audio/subtitle relation, and
  review criteria.
- Composition layer: `function Composition(props)`, `width`, `height`, `fps`,
  `animation.durationInSeconds`, `<Sequence>` timing, media components, editable
  props, and frame-driven animation.

Do not let Remotion implementation details invent a webpage-like structure. The
director contract comes first; this composition prompt turns that direction into
an executable Makaron timeline.

When the user asks to put two existing timeline videos together, cut clips freely, add transitions, add subtitles, or make a sequence that can be edited later, this is the default runtime. Use Remotion `<Sequence>` and `<Video>` rather than FFmpeg.

Do not fall back to FFmpeg/node for ordinary timeline splicing just because a preview needs adjustment or the first composition attempt is imperfect. Patch the Remotion composition, promote the reviewed editable composition with `publish_draft({ design_path })`, or report the preview issue. Use FFmpeg only when the user explicitly asks for a real file-level MP4 operation/export.

For timeline media, put the literal 1-based `<<<media_N>>>` marker in props or code, including `props.clipA`, `<Img src>`, and `<Video src>`. `run_code` resolves every marker to the current URL before validation, autosave, preview, and export. Never manually translate Media Index N to `ctx.snapshotImages[N]`: Media Index is 1-based while that JavaScript array is 0-based, so manual indexing shifts every image and makes the final item undefined.

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
  animation: { fps: 30, durationInSeconds: 12 }
}
```

Subsequent edits:

```js
return {
  type: 'patch',
  edits: [{ old: 'exact existing string', new: 'replacement string' }], // optional
  props // optional, can be the only patch body for text/data edits
}
```

Every successful render or patch is automatically saved to the recovery `code_path` returned by `run_code`. After visual QA, publish the editable composition with `publish_draft({ design_path: code_path })`. Do not use legacy `write_file({ fromLastRunCode: true })` for durable or resumed composition publishing.

If the change includes transitions, subtitles, overlays, trim timing, cropping, or other visible timeline edits, call `preview_frame` on stable middle frames before telling the user it is complete or publishing it.

When changing trim timing or total sequence length, update `animation.durationInSeconds` to match the final timeline exactly (`totalFrames / fps`). Do not tell the user a clip is 18s while returning a 20s animation.

If the user asks for a duration such as 30 seconds, set `animation.durationInSeconds` to that requested duration and build scene `from` / `durationInFrames` values inside that total. Never leave `durationInSeconds: 1` on a multi-scene timeline.

## Remotion APIs

Available APIs include all exports from `remotion`, `@remotion/media`, `@remotion/paths`, and `@remotion/noise`.

- Do not import or `require()` Remotion packages, destructure from `window.Remotion`, or write `Remotion.AbsoluteFill`. All APIs are already in scope. Use `<AbsoluteFill>`, `<Video>`, `<Sequence>`, and hooks directly.
- Name the main exported component `Composition`. Helper components are allowed, but the renderable timeline should be `function Composition(props) { ... }`.
- Do not use ES module syntax inside the returned composition code. Never write
  `import ...` or `export default ...`. The composition code should define
  `function Composition(props) { ... }` in the shared runtime scope and return
  that via the `{ type: 'render', code, ... }` wrapper.
- Only `Composition(props)` may read `props` directly. Helper components must receive every value they use as function parameters, e.g. `function TitleCard({ title, subtitle }) { ... }`; never reference outer `props` inside `TitleCard`, `Scene`, `Card`, or other helpers.
- Use Remotion `<Img>`, never HTML `<img>`.
- Subtitles, kinetic text, and scene labels are authored directly inside this
  composition. The harness does not provide a universal subtitle overlay or
  impose shared styling. When narration is present, use the persisted
  `transcribe_audio` narration cue sheet as the authoritative master clock.
  Convert cue seconds to frames once at the Composition FPS, then drive
  `<Sequence>` ranges, subtitle activation, visual emphasis, and music ducking
  from those same ranges. A linked visual scene must not end before its
  narration cue ends. Do not replace measured cue ranges with planned Script
  timing, estimated reading speed, or equal scene lengths. Wording, grouping,
  placement, typography, and motion remain specific to the current Composition.
- Prefer Remotion `<Video>` or `<OffthreadVideo>`. Lowercase HTML `<video>` is
  also accepted and normalized by the harness to the injected,
  frame-synchronized `<Video>` component.
- Decoder selection is owned by the preview/export runtime, independent of
  whether the source used `<Video>` or `<OffthreadVideo>`.
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

Editable is the default for every composition. Keep user-facing values in
`props`; the runtime infers the Editable Manifest and instruments ordinary JSX.
Do not write an `editables` array for new work.

The common path is normal React:

```jsx
function Composition(props) {
  return (
    <AbsoluteFill>
      <h1>{props.title}</h1>
      <Img src={props.heroImage} style={{ width: 720, height: 900 }} />
      <Video src={props.clip} style={{ width: 1080, height: 1920 }} />
    </AbsoluteFill>
  );
}
```

Rules:
- Put every user-facing title, subtitle, caption, badge, counter, stat, brand
  line, CTA, and outro line in a top-level prop and render that prop in its own
  semantic host element.
- Put every primary image/video URL in its own top-level prop and render it
  through `<Img src={props.imageKey}>` or `<Video src={props.videoKey}>`.
- One host represents one logical text field. Do not render two different text
  props directly inside the same host.
- Do not put visible text directly inside `<AbsoluteFill>` or `<Sequence>`; use
  a real text element so the editor gets its actual box.
- Reusing a media URL is fine, but each independently movable layer needs its
  own prop key.
- Keep decorative overlays non-interactive with `pointerEvents: 'none'`.
- Keep hardcoded structural tokens and decorative marks out of props; keep all
  user-facing copy in props.

For a dynamic scene abstraction, use one explicit runtime-id escape hatch. The
same key expression must select the prop and identify its visible host:

```jsx
const scenes = [
  { titleKey: 'title0', imageKey: 'image0' },
  { titleKey: 'title1', imageKey: 'image1' },
];
const scene = scenes[activeSceneIndex];

return (
  <AbsoluteFill>
    <h1 data-editable={scene.titleKey}>{props[scene.titleKey]}</h1>
    <div data-editable={scene.imageKey} style={{ width: 720, height: 900 }}>
      <Img src={props[scene.imageKey]} style={{ width: '100%', height: '100%' }} />
    </div>
  </AbsoluteFill>
);
```

Reusable helper components follow the same rule without metadata duplication:

```jsx
function EditableText({ id, value }) {
  return <h1 data-editable={id}>{value}</h1>;
}
function EditableImage({ id, src }) {
  return <Img data-editable={id} src={src} />;
}

<EditableText id={scene.titleKey} value={props[scene.titleKey]} />
<EditableImage id={scene.imageKey} src={props[scene.imageKey]} />
```

The compiler follows `id + value/src` through these helpers and expands the
scene keys from `props`. Do not repeat the same information in an `editables`
array.

Use `data-editable` only for custom/dynamic ownership that the compiler cannot
infer from a direct prop read. Put it on the real visual host, never on a
full-canvas structural ancestor. Legacy explicit `editables` metadata remains
accepted when patching an old composition, but new output should omit it.

Video trim is non-destructive and belongs to the selected video node:

```jsx
<Video
  src={props.heroVideo}
  trimBefore={30}
  trimAfter={180}
  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
/>
```

The editor persists later trim changes by the inferred video node id. Do not
create composition-wide trim fields or wrap the whole timeline as one video
editable.

For numbered source parts, the first `compositionMetadata` needs dimensions,
`props`, and animation. Omit `editables`; the assembled composition infers and
persists its Manifest automatically.

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
- Fonts are pinned assets shared by Player, Sandbox preview, and Lambda export. If you specify `fontFamily`, use only these catalog names:
  - Chinese/CJK sans: `Noto Sans SC`, `Noto Sans TC`, `Noto Sans JP`, `Noto Sans KR`
  - Chinese/CJK serif: `Noto Serif SC`, `Noto Serif TC`, `Noto Serif JP`, `Noto Serif KR`
  - Chinese display/handwriting: `Ma Shan Zheng`, `ZCOOL KuaiLe`, `ZCOOL XiaoWei`, `ZCOOL QingKe HuangYou`, `Liu Jian Mao Cao`, `Long Cang`, `Zhi Mang Xing`, `LXGW WenKai TC`
  - Latin: `Inter`, `Playfair Display`, `Montserrat`, `Oswald`, `Poppins`, `Lato`, `Roboto`, `Bebas Neue`, `Dancing Script`, `Pacifico`, `Lobster`, `Anton`, `Caveat`, `Raleway`, `JetBrains Mono`, `GFS Didot`, `Bodoni Moda`
- Never use `Arial`, `Helvetica`, `Times New Roman`, `PingFang SC`, `Microsoft YaHei`, `STKaiti`, `Kaiti SC`, `KaiTi`, `Didot`, `Bodoni 72`, or another local/system font name. Local fonts differ between macOS and Linux and will be rejected instead of silently falling back.
- For an old composition only, migrate a legacy family by persisting an explicit top-level `fontSubstitutions` map in the design payload (for example `{ "STKaiti": "Ma Shan Zheng", "Didot": "GFS Didot", "Arial": "Inter" }`). This is a product/design decision, not a runtime alias. New compositions must use the catalog family directly.

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
- When the user should receive an editable composition, call `publish_draft` with the exact persisted `design_path` after QA. A draft preview is not a published timeline Snapshot. `materialize_media({ publish: true })` publishes the MP4 only and does not replace this step.
