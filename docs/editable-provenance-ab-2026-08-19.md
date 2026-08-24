# Editable provenance A/B experiment

Date: 2026-08-19

## Conclusion

The provenance-based compiler materially improves editable discovery on the fixed 10-project public corpus without losing any field already recognized by production. The B side now includes runtime marker instrumentation rather than analysis-only field counting.

- Production compiler: 105 fields
- Provenance analyzer: 256 fields
- Added prop-backed fields: 143
- Added literal candidates: 8
- Production fields missing from the new result: 0
- Three clean controls: exact parity, with no added or missing fields

The original racket project improved from 10 to 26 fields. The 16 additions are the eight Chinese and eight English subtitle props that production currently misses.

This remains isolated to the worktree. It does not change production or add a Studio QC stage.

## A/B method

A is the current production `compileEditableManifest()` implementation. B is the experimental `compileEditableManifestWithProvenance()` implementation, including field inference, source-alias materialization, and `data-editable` instrumentation.

For each fixed project ID, the runner:

1. Uses the anonymous Supabase client and verifies `is_public = true`.
2. Downloads the latest snapshot with a Composition payload.
3. Runs A and B against the same code, props, and stored editable manifest.
4. Compares stable prop keys, separates prop-backed discoveries from lifted literals, and reports regressions.

The corpus intentionally contains seven known gap projects and three clean controls. This prevents a favorable result from being produced only by selecting known failures.

## Results

| Project | Cohort | Production fields | Production unsupported | Provenance fields | Added props | Literal candidates | Missing |
|---|---:|---:|---:|---:|---:|---:|---:|
| [Racket dynamic bilingual cue map](https://www.makaron.app/projects/0d3a8e2d-8731-4e26-8e9d-39ff2d8cdef6) | gap | 10 | 2 | 26 | 16 | 0 | 0 |
| [Connector scene assembly](https://www.makaron.app/projects/b2d30afe-5ac9-4c5a-b521-d5fe6f341442) | gap | 0 | 6 | 30 | 30 | 0 | 0 |
| [Captured Moment chapter map](https://www.makaron.app/projects/b9b233ad-378a-4799-9776-3a5925f93df5) | gap | 2 | 2 | 16 | 14 | 0 | 0 |
| [Card Magic captions](https://www.makaron.app/projects/500f638f-2702-4e78-bdd9-4972f72f76a9) | gap | 1 | 2 | 7 | 6 | 0 | 0 |
| [Fiber process vertical explainer](https://www.makaron.app/projects/4ec89615-f119-475d-a0d5-67cbe8f3b72d) | gap | 10 | 3 | 34 | 24 | 0 | 0 |
| [Fiber manufacturing full process](https://www.makaron.app/projects/d2d75494-a7bf-488e-88c2-421f3d8cc0e1) | gap | 29 | 1 | 37 | 0 | 8 | 0 |
| [Long TikTok word captions](https://www.makaron.app/projects/97568c36-5aef-42ba-b1c1-0b8d4ce7fea5) | gap | 8 | 2 | 61 | 53 | 0 | 0 |
| [Racket explicit normalized control](https://www.makaron.app/projects/3dbd6024-c9d2-4fe4-b53b-72b9c312a3f9) | control | 25 | 0 | 25 | 0 | 0 | 0 |
| [Makaron 35s image control](https://www.makaron.app/projects/323ef939-736c-41b9-ad9c-3e8e3a09e652) | control | 13 | 0 | 13 | 0 | 0 | 0 |
| [Generation-first mixed media control](https://www.makaron.app/projects/0208cf9d-9d57-451a-8ff6-56c6a890656b) | control | 7 | 0 | 7 | 0 | 0 | 0 |
| **Total** |  | **105** | **18** | **256** | **143** | **8** | **0** |

## Precision audit

The added prop-backed fields correspond to visible content sources:

- Racket: all 16 bilingual subtitle props.
- Connector: six video sources and the scene names, beats, effects, and captions assembled through helper components.
- Captured Moment: seven video sources and seven chapter labels. Derived counter separators remain excluded.
- Card Magic: all six caption props.
- Fiber vertical: eight labels, eight tags, and eight captions.
- Long TikTok: 48 word-caption props and five step labels.

The eight literal candidates were inspected separately. They are the visible Spanish captions stored directly in the Fiber composition's caption array, not CSS values, counters, or technical constants. Keeping literal candidates separate is deliberate: prop-backed fields can be accepted automatically, while literal lifting can retain a stricter policy or an explicit confidence threshold.

During the experiment, two false-positive classes were found and removed:

- Replacement strings passed to `.replace()` were initially treated as content provenance. The analyzer now preserves only the receiver's provenance for string transforms.
- The literal separator in a derived chapter counter was initially lifted. Mixed literal-plus-derived expressions are now excluded; only a pure visible JSX literal or a constant expression that supplies the complete text is eligible.

## Why this is more general than adding cases

The analyzer propagates source provenance from concrete `props` values to render sinks. It follows object and array assembly, destructuring, computed member access, local function calls, component props, conditionals, and map callbacks. A rendered node can point to multiple possible source bindings, which is necessary for timeline captions where one component renders different props at different frames.

The key separation is:

- `fields`: editable sources and stable binding keys.
- `nodes`: rendered sinks and the set of source bindings that can reach each sink.

This matches the earlier compiler-owned editable design: authors continue writing natural React, while the compiler derives the binding graph. No `<Editable.Text>` wrapper and no project-specific caption rule are required.

## Runtime transform contract

Every provenance-discovered text, image, or video node is compiled back into the existing runtime contract:

- The rendered leaf receives a real `data-editable` ID.
- Selection continues through `SceneRegistry` and `DesignOverlay`.
- Desktop movement and corner scaling continue through Moveable.
- Touch movement and pinch scaling continue through the existing pointer handlers.
- Persisted transforms remain `_pos_<id>` and `_scale_<id>`.
- Preview and materialized export continue to apply transforms through the shared React runtime using independent CSS `translate` and `scale` properties.

Nested arrays and object paths are materialized as stable top-level aliases. The injected provenance path lets the runtime keep resolving the original render source after the editable alias has changed, including after refresh. For mixed text such as `WORD: {value}`, only the source value is overridden; the static prefix is preserved.

Focused runtime tests cover computed-key captions, nested-array text, and video nodes. They assert real runtime markers plus persisted position and scale styles.

Browser validation on the original racket project at `http://localhost:3047` confirmed:

- The Composition snapshot renders without a framework overlay under webpack dev mode.
- At the opening cue, `openingEn` and `openingZh` are both real DOM editables alongside the active media nodes.
- Selecting `openingEn` produces the selected outline, label, four Moveable corner controls, and drag area.
- The bottom editable panel exposes `Opening En` and `Opening Zh` separately.

The Browser control surface used for this run supports selection and screenshot evidence but not continuous pointer drag. Actual persisted `_pos` and `_scale` mutation is therefore covered by the shared-runtime tests rather than claimed as a Browser drag result.

## Remaining gate before product integration

Before production integration, the next stage should:

1. Put the worktree compiler path behind a production feature flag.
2. Add browser drag/scale persistence coverage through a pointer-capable E2E surface.
3. Verify text editing, refresh, preview, and exported MP4 on representative dynamic, literal, image, and video projects.
4. Expand the fixed public corpus before enabling the flag broadly.
5. Keep unsupported syntax observable in compiler diagnostics instead of adding another Studio run or QC pass.

The current result establishes substantially broader discovery plus reuse of the existing move/scale runtime contract. It is not yet a production rollout decision.

## Reproduction

```bash
MAKARON_ENV_FILE=/absolute/path/to/.env.local \
  /absolute/path/to/node_modules/.bin/tsx scripts/editable-provenance-ab.ts
```

Use `--json` to inspect every added field and render node.
