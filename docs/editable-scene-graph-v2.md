# Editable Scene Graph V2

Status: implemented with local engineering acceptance complete on
`codex/editable-scene-graph-v2`. The branch remains isolated from `dev`.

This document is the implementation contract and acceptance gate for the
Editable V2 refactor. The branch must not be merged into `dev` until every
Definition of Done item below is proven.

## Problem

The legacy authoring contract asks a composition author to keep three separate
descriptions synchronized:

1. A value in `props`.
2. A `data-editable` wrapper in JSX.
3. An `editables` metadata entry.

The harness then uses source regexes to guess whether those descriptions match.
Duplicate wrappers can produce multiple DOM instances for one logical field,
and the transform proxy can apply the same transform to every instance. This
raises Agent repair cost and causes selection, drag, Safari alignment, preview,
and export inconsistencies.

## Target Contract

`props` is the value source of truth. Ordinary React authoring should be enough
for the common path:

```tsx
function Composition(props) {
  return (
    <AbsoluteFill>
      <h1>{props.title}</h1>
      <Img src={props.heroImage} />
      <Video src={props.clip} />
    </AbsoluteFill>
  );
}
```

The Editable Manifest compiler must infer:

```ts
[
  { id: 'title', type: 'text', label: 'Title', propKey: 'title' },
  { id: 'heroImage', type: 'image', label: 'Hero image', propKey: 'heroImage' },
  { id: 'clip', type: 'video', label: 'Clip', propKey: 'clip' },
]
```

It must also instrument the relevant JSX host with a stable runtime node id.
Authors may use one explicit `data-editable` attribute as an escape hatch for
custom components or dynamic scene abstractions. New compositions must not need
to return an explicit `editables` array.

Legacy compositions with explicit `editables` and `data-editable` remain
supported without migration.

## Ownership Model

- `Editable Manifest compiler`: maps composition props to logical editable
  nodes and instruments ordinary JSX. Remotion media components are owned by
  their nearest single-media DOM box because `<Video>` does not forward
  arbitrary data attributes to its rendered DOM.
- `SceneRegistry`: maps each logical node to the active rendered DOM instance
  for the current frame.
- `Editable override store`: owns user text/media/position/scale/trim changes.
- `DesignOverlay`: renders selection and interaction for active instances only.
- `Remotion preview and export`: consume the same node identity and overrides.
- `Harness`: validates compiled structure and real invariants. It must not make
  the Agent repeat metadata merely to satisfy source regexes.

## Implementation Stages

1. Compatibility registry for legacy duplicate DOM instances.
2. AST Manifest inference and JSX instrumentation.
3. Optional `editables` in `run_code`, composition parts, patch, and persistence.
4. Harness validation against the inferred Manifest.
5. Preview, Moveable, mobile gestures, trim, poster, and export on one ownership
   path.
6. Short Remotion Composition prompt describing props-first authoring and the
   explicit escape hatch.
7. Legacy regression and three blind Agent E2E runs.

## Definition of Done

### Agent burden

- Run three new composition prompts that never mention Editable.
- Cover natural text, generated image plus text, and uploaded video plus text
  and trim.
- Every visible user-facing text and primary media layer is discovered.
- New generated source does not need an explicit `editables` array.
- Harness repair count is zero per run, with one repair allowed only when it is
  unrelated to Editable wiring.

### Harness burden

- Direct `props.title`, `props["title"]`, image `src`, and video `src` are
  inferred through AST analysis.
- Prop ownership follows ordinary nested helper chains such as
  `props.title -> IntroScene.title -> BrushTitle.text -> DOM`; component depth
  must not force the Agent to add Editable metadata.
- Supported dynamic `props[scene.titleKey]` authoring remains valid through the
  explicit runtime id escape hatch.
- Valid natural React is not rejected for missing wrapper geometry or repeated
  metadata.
- Diagnostics identify real missing prop wiring, unsupported ambiguity, trim,
  syntax, media, or timeline errors.

### Editor behavior

- Text, image, and video select from canvas and pill.
- Move and resize target only the active DOM instance.
- Text supports double-click and keyboard entry without playback conflicts.
- Video trim edits only the selected video node.
- Canvas playback works outside a selected editable, including compositions
  with a full-canvas media node.
- Twenty alternating selections do not misalign or disable Moveable.
- Drag release does not flash the poster or move an ancestor shell.

### Preview and export

- Edit text, move and resize image, trim video, then export MP4.
- Preview and exported frame placement match.
- Resolution, FPS, duration, and trim boundaries are correct.
- No parent-and-child double transform, black frame, or poster flash.

### Compatibility and mobile

- Existing Apple Vision Pro duplicate-node project works without migration.
- Existing multi-scene text/image project, static long composition, and video
  trim project remain editable.
- Desktop and iPhone viewport automation pass.
- A real Mobile Safari smoke confirms handle alignment, stable TipBar height,
  canvas position, selection, playback, and gestures.

### Repository gates

- Focused contract and interaction tests pass.
- Full Vitest suite passes.
- `npx tsc --noEmit --pretty false` passes.
- `npm run build` passes.
- `git diff --check` passes.

Any missing editable, required prompt hint, preview/export mismatch, selected
video trim affecting another node, or recurring Agent repair means the refactor
is not complete.

## Blind E2E Evidence

The prompts below did not mention Editable, Manifest, Harness, `data-editable`,
or metadata arrays.

1. Text helper composition:
   `http://localhost:3002/projects/044debdc-89a3-4c94-adbe-baeafcdb697c`
   inferred 11 text fields. Canvas drag, corner alignment, double-click edit,
   keyboard entry, reload persistence, and export were verified.
2. Generated image composition:
   `http://localhost:3002/projects/4c43f922-dddc-4c4e-8f61-1fe0136681c0`
   inferred three text fields, one image field, and one scene label. Pill
   selection, move, resize, reload persistence, and a 150-frame MP4 export were
   verified.
3. Uploaded video composition:
   `http://localhost:3002/projects/eea720ca-bc4d-4e76-bdf5-03e4818b2077`
   inferred six text fields and one video field through an ordinary mixed
   helper. Move, resize, selected-node trim, timestamp scrub, range drag,
   out-of-bounds release, reload persistence, synchronized trim playback, and a
   180-frame MP4 export were verified.
4. Nested calligraphy title composition:
   `http://localhost:3002/projects/95c5270d-e0d1-47e8-baa2-84dd934d35ee`
   originally exposed only four direct helper leaves. Transitive prop inference
   restored 13 text fields, including title, opening, five chapter titles,
   ending, and brand. Persisted compositions are upgraded in memory when opened
   so the fix applies without rewriting production workspace data.

The video run exposed and now permanently covers two runtime/compiler failures:

- Compiler-owned media markers on `<Video>` were invisible because the Remotion
  component consumes unknown props. Existing internal markers migrate
  idempotently to the nearest single-media DOM owner; a direct `<Video>` also
  receives a forwarded runtime class marker. Explicit user markers are
  untouched.
- Authored numeric trim values seed `_trimBefore_<id>` and
  `_trimAfter_<id>`. Once the GUI changes them, those values override the
  authored defaults in preview and export.

## Final Gates

- Focused Editable contracts: 35 tests passed in the final changed surface.
- Full Vitest suite: 164 files and 958 tests passed.
- TypeScript: `npx tsc --noEmit --pretty false` passed.
- Production build: `npx next build --webpack` passed. The existing
  `libheif-js` dynamic-require warning remains unchanged.
- Patch hygiene: `git diff --check` passed.
- The physical Mobile Safari smoke remains the final user sign-off before any
  future merge; this branch is intentionally not merged or deployed.
