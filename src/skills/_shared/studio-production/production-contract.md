# Studio Production Contract

This contract turns a Makaron video skill into a durable Studio Run. The user
chooses a recipe; the recipe chooses the production logic. The eight Studio Run
stages remain stable so progress, resume, approvals, invalidation, and delivery
work the same across video types.

## Required Order

1. Start `studio_run` before writing the creative packet. Set `recipe` to the
   active skill's `metadata.makaron.studioRunRecipe` value. Keep
   `include_stage_schemas` false for the normal path; later schemas are loaded
   only when their stage begins.
2. Lock the delivery promise. Do not silently change duration, canvas, FPS,
   runtime, editability, audio, or subtitle requirements later.
   - When the user does not specify resolution and explicitly prioritizes
     speed, lock `1280x720` for 16:9 or an equivalent 720-short-side canvas.
   - When the promise is larger than the `fast_720p` result, materialize with
     `profile: "source"` on the first and only export. Never render fast and
     then render source merely to repair a known resolution mismatch.
3. Read only the shared director modules needed by the recipe, once:
   - `taste-direction.md` for every authored video.
   - `reference-analysis.md` for reference-led work.
   - `audio-direction.md` for narration, source speech, music, or dubbing.
   - `review-contract.md` once before Composition review begins.
4. For `approval_policy=auto`, make one coherent creative decision containing
   the brief, at least two concepts, the selected direction, and timed script.
   Submit it once with `studio_run(operation: "put_creative_packet")`. The
   harness projects it into separately validated Brief, Proposal, and Script
   artifacts and emits each stage to CUI without another model continuation.
   Then generate and transcribe continuous narration before authoring Storyboard
   from real speech timing. Guided/manual runs continue to use one
   `put_artifact` at a time so their approval pauses remain explicit.
5. Build editable video with `run_code({ runtime: "composition" })`, save the
   first complete draft, and pass the Composition draft gate before any publish
   or MP4 export. The gate checks exact timeline duration, every scene boundary,
   the final visible frame, resolved audio sources, and zero unresolved issue.
   Fix all findings directly in the Remotion source, publish the exact gated
   draft, and materialize it once. Successful materialization completes the run.

## Stage Meanings

- `brief`: outcome, audience, source/reference status, format, and constraints.
- `proposal`: at least two meaningfully different treatments, an honest tool
  path, cost estimate, selected direction, and locked delivery promise.
- `script`: the timed content spine. For source-led work this can be transcript
  selections, edit beats, or translated cues instead of new narration.
- `storyboard`: shot/scene plan, visual relationships, treatment, transition, safe areas,
  asset links, and real narration timing evidence when subtitles are promised.
- `assets`: every source, generated asset, voice, music, font, and code module
  that the composition actually uses. Persist this stage only after required
  voice/music generation; missing assets or promised audio block composition.
- `composition`: the real editable Remotion design path plus draft-gate evidence
  for full timeline coverage, every scene boundary, the ending, audio sources,
  three or more preview frames, and per-section subtitle/narration/visual timing.
- `review`: a system-projected completion state after the Agent's Composition
  preview-and-patch loop and successful materialization; no Agent JSON.
- `delivery`: a system-projected final MP4 and editable source record created by
  successful materialization; no Agent JSON.

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

## Efficient Execution

- Prefer existing timeline/workspace assets and local code before paid generation.
- Do not request all eight stage schemas at `studio_run start`. The typed
  `creative_packet` input already covers Brief through Script. Load only the
  current later-stage schema with `status` after a handoff, or `schema` when the
  artifact shape is not already present in context.
- Before the first composition `run_code`, read
  `prompts/remotion-composition.md` and follow its original director contract at
  `skills/_shared/remotion-director-contract.md`. Studio Run does not replace or
  abbreviate the composition and director guidance.
- For complete theme-driven work, read `skills/_shared/visual-direction/SKILL.md`
  and `skills/_shared/studio-production/taste-direction.md` before Storyboard.
  The Visual Invention Pass is included in every dedicated Studio Composition
  attempt as well. Store the dominant technical carrier and shot-scale decision
  in each substantial scene's optional `visualPlan`; this metadata does not
  limit supporting layers, visual density, or scene invention. Old runs without
  this field remain valid.
- If a scene selects `cutout` or `edge-video`, read
  `skills/_shared/visual-asset-bridge/SKILL.md`, call `prepare_visual_asset`
  during Assets, and store the returned record in that asset's optional
  `prepared` field. Set `visualPlan.primaryAssetId`, the manifest asset ID, and
  the Bridge `asset_id` to the same value; set the manifest path to
  `preparedUrl`. Studio Run rejects ad hoc keying for these carriers. Do not add
  another Studio stage or a fixed renderer.
- Build one complete composition and save its exact `design_path` before visual
  review. Derive all scene-boundary timestamps from the storyboard/root
  timeline, then batch those boundaries, a hook/body frame, and the final
  visible frame into the minimum number of 2-6 frame `preview_frame` calls.
- Do not publish or materialize until exact frame-count math, every boundary,
  the ending, required audio URLs, visual-plan fidelity, absence of underfilled
  scenes, and subtitle/narration/visual alignment pass the Composition draft
  gate.
- When subtitles are promised, author them as part of the Composition's own
  scene design. `transcribe_audio` may provide editorial timing reference, but
  the harness does not create a separate caption artifact, inject caption props,
  impose a cue schema, or select a visual renderer.
- Resolve continuous narration timing before final Storyboard. Generate or load
  the voice track after Script, call `transcribe_audio`, and set Storyboard scene
  boundaries so every narrated section fits its linked visual beat. Do not keep
  convenient equal-length scenes when the real speech has already drifted.
  Persist one `narrationTimingEvidence` record per narrated Script section;
  Studio Run blocks Storyboard before Assets when these ranges do not fit.
- Before the Composition gate passes, inspect representative speaking frames
  and confirm a three-way match: the authored subtitle or kinetic phrase, the
  visual action/information on screen, and the narration actually sounding at
  that time. Do not infer speech timing from planned Script section boundaries.
  A continuous voiceover needs real timing evidence from `transcribe_audio`;
  independently placed scene clips may use their explicit Remotion start times.
  Persist one `subtitleSyncEvidence` record per narrated Script section. The
  record must include the `subtitleText` intended for its representative frame.
  That text may preserve the spoken line or use a
  concise phrase already authored in that same Script section's
  `onScreenText`; it does not have to duplicate narration word for word. It
  cannot introduce unrelated copy from another beat. The harness cross-checks
  its linked Storyboard range and representative overlap. It does not require a
  duplicate copy in props or editables: the Composition gate checks the actual
  displayed text and picture alignment in representative preview frames.
  Retiming and visual treatment remain the Agent's job.
- Lock `width` and `height` from the approved delivery promise before the first
  `run_code` call. The harness rejects a mismatched Studio Composition before
  autosave, preview, or publication; do not prototype in another orientation.
- Review is the Agent's preview-and-patch loop on the Remotion source. Resolve
  all blocking issues directly in that code before export; do not author Review
  JSON.
- After one clean gate, call `publish_draft` with that exact `design_path` once,
  then materialize it once when MP4 Delivery is requested. Do not export a
  timeline `media_index` that may point to an older
  snapshot. Successful Studio Run materialization waits for the real MP4 and
  automatically completes Review and Delivery. Do not author Delivery JSON or
  perform more tool calls after success.
- Probe source media once. Reuse that result throughout Composition review.
- Do not compute SHA unless the user explicitly requests an integrity checksum.

## Test Timing

For every Studio Run used as a sample or acceptance test, retain its Agent run
ID and report elapsed milestones from the event log. Create a fresh project and
fresh Studio Run for every test round; source URLs may be reused as controlled
inputs, but do not refine an older test project. Record Agent completion,
MP4-ready time, and Delivery completion; Studio Run materialization should make
the three terminal milestones identical. Include planning, asset/audio
generation, first composition, visual review/revision, export, total wall time,
and counts for revisions, previews, and exports. Do not report an aesthetic
comparison without its production-time comparison.
