# Studio Production Contract

This contract turns a Makaron video skill into a durable Studio Run. The user
chooses a recipe; the recipe chooses the production logic. The eight Studio Run
stages remain stable so progress, resume, approvals, invalidation, and delivery
work the same across video types.

## Required Order

1. Start `studio_run` before writing the brief. Set `recipe` to the active
   skill's `metadata.makaron.studioRunRecipe` value.
2. Lock the delivery promise. Do not silently change duration, canvas, FPS,
   runtime, editability, audio, or subtitle requirements later.
   - When the user does not specify resolution and explicitly prioritizes
     speed, lock `1280x720` for 16:9 or an equivalent 720-short-side canvas.
   - When the promise is larger than the `fast_720p` result, materialize with
     `profile: "source"` on the first and only export. Never render fast and
     then render source merely to repair a known resolution mismatch.
3. Read only the shared director modules needed by the recipe:
   - `skills/creative-direction/SKILL.md` once for every complete video needing
     new art direction. It replaces `taste-direction.md`; skip it only for a
     mechanical edit, explicit template replication, or an A/B baseline.
   - `reference-analysis.md` for reference-led work.
   - `audio-direction.md` for narration, source speech, music, or dubbing.
   - `review-contract.md` before every gated artifact and final delivery.
4. Persist each stage before moving to the next one. For `approval_policy=auto`,
   prefer one `studio_run(operation: "put_artifacts")` call for the contiguous
   text-only planning stages from brief through assets. Each artifact is still
   validated, stored, and emitted to CUI separately. Guided/manual runs continue
   to use one `put_artifact` at a time.
5. Build editable video with `run_code({ runtime: "composition" })`, inspect
   representative frames with `preview_frame`, and materialize the MP4 before
   final review.

## Stage Meanings

- `brief`: outcome, audience, source/reference status, format, and constraints.
- `proposal`: at least two meaningfully different treatments, the compact
  subject-specific `creativeTreatment` for directed work, concrete theme
  evidence, a paper-only visual-form comparison, honest tool path, cost
  estimate, selected direction, and locked delivery promise. Render only the
  selected form.
- `script`: the timed content spine. For source-led work this can be transcript
  selections, edit beats, or translated cues instead of new narration.
- `storyboard`: shot/scene plan, focal point, treatment, transition, safe areas,
  and asset links.
- `assets`: every source, generated asset, voice, music, font, and code module
  that the composition actually uses. Missing assets block composition.
- `composition`: the real editable Remotion design path plus three or more
  preview frames.
- `review`: technical, visual, audio, and delivery-promise checks against the
  materialized MP4.
- `delivery`: final MP4, editable source, optional hash, and delivery time.

## Approval Policy

- Use `auto` only when the user explicitly preauthorizes the complete run.
- Otherwise use `guided`; stop when Studio Run reports an approval gate.
- A failed artifact write is a blocker. Never narrate progress that was not
  persisted.

## Recipe Discipline

- Preserve the recipe's subject. Screen footage, podcast speech, or source
  clips stay primary in source-led recipes.
- Use generated media only for a declared role: subject, evidence, transition,
  or atmosphere.
- Reuse Makaron's tools and Remotion runtime. OpenMontage tool names are design
  references, not callable Makaron tools.
- Quick trims, one-off image animation, and tiny utility edits do not need a
  Studio Run.

## Fast Path

- Prefer existing timeline/workspace assets and local code before paid generation.
- Reuse the complete `stageSchemas` returned by `studio_run start`; do not call
  `schema` separately for stages already present there. Use `schema` and
  `status` only for recovery or after validation errors.
- Before the first composition `run_code`, read
  `prompts/studio-remotion-fast-path.md`. It replaces the longer generic coding,
  Remotion composition, and director guides for this Studio Run.
- Build one complete composition, call `preview_frame` once with three
  representative frames to create one contact sheet, publish once, and
  materialize once.
- Do not add another preview after one clean hook/body/end contact sheet.
- Probe source/output media once. Reuse that result for review and delivery.
- Do not compute SHA unless the user explicitly requests an integrity checksum.

## Test Timing

For every Studio Run used as a sample or acceptance test, retain its Agent run
ID and report elapsed milestones from the event log. Create a fresh project and
fresh Studio Run for every test round; source URLs may be reused as controlled
inputs, but do not refine an older test project. Separate Agent completion,
MP4-ready time, and Delivery completion; asynchronous export may make them
different. Include planning, asset/audio generation, first composition, visual
review/revision, export, total wall time, and counts for revisions, previews,
and exports. Do not report an aesthetic comparison without its production-time
comparison.
