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
3. Read only the shared director modules needed by the recipe:
   - `reference-analysis.md` for reference-led work.
   - `taste-direction.md` for new art direction or atelier work.
   - `audio-direction.md` for narration, source speech, music, or dubbing.
   - `review-contract.md` before every gated artifact and final delivery.
4. Persist each stage with `studio_run(operation: "put_artifact")` before
   moving to the next one.
5. Build editable video with `run_code({ runtime: "composition" })`, inspect
   representative frames with `preview_frame`, and materialize the MP4 before
   final review.

## Stage Meanings

- `brief`: outcome, audience, source/reference status, format, and constraints.
- `proposal`: at least two meaningfully different treatments, honest tool path,
  cost estimate, selected direction, and locked delivery promise.
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
- `delivery`: final MP4, editable source, hash, and delivery time.

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
