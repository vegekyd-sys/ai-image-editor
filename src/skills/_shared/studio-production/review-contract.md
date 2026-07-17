# Studio Composition Review Contract

Review is not a separate document-writing stage. Review the actual Remotion
source, fix every blocking issue in that source, and materialize only when the
Composition is ready to ship.

## Stage Checks

- A draft carrying `__makaronScaffold: true` is only a durable structural
  checkpoint. It must never pass Composition or be materialized.
- Brief: concrete audience, outcome, and source/reference classification.
- Proposal: concepts differ in structure and visual mechanism; the selected
  path is feasible with current Makaron tools and budget.
- Script: timing covers the promise; hooks, claims, selections, or translated
  cues are coherent and speakable.
- Storyboard: intentional visual relationships, visible variety, feasible
  assets, and clear subtitle/UI safe areas.
- Assets: every referenced file is ready, attributable, and linked to scenes.

## Composition Review Loop

Run this loop on the first complete autosaved Remotion draft, before publishing
or materializing an MP4.

1. Compute `expectedDurationFrames = round(durationSeconds * fps)` and confirm
   the scene timeline covers exactly that duration. Overlap must not shorten the
   ending or leave uncovered tail frames.
2. Inspect every scene boundary at its exact transition time. Batch timestamps
   into 2-6 frame contact sheets; include stable hook/body frames and the final
   visible frame. A generic hook/body/end sample is insufficient for a
   multi-scene video with transitions.
3. Check for black/blank frames, transition gaps, accidental double exposure,
   missing media, unreadable text, subtitle collisions, source crop, and
   ending-frame loss. Compare each sampled frame to its Storyboard intent. When
   a frame feels generic, accidental, or unresolved, use the Visual Invention
   Pass to consider a more authored crop, environment, relationship,
   transformation, or scene handoff, then patch the actual source when that
   improves the piece. This is not a fixed density or object-structure gate.
4. For each narrated Script section, inspect the representative speaking frame
   recorded in `subtitleSyncEvidence`. The displayed phrase must describe the
   same beat as both the current picture and the narration actually sounding
   then. Planned Script ranges alone are not timing evidence for a continuous
   TTS file. Use ASR timing, retime mismatches, and keep evidence linked to the
   persisted Storyboard scene. Do not standardize wording, placement,
   typography, JSX, or animation merely to pass this check.
5. Confirm required audio props are resolved public URLs, not undefined values
   or `<<<audio_N>>>` markers. Check unexpected silence, intelligible speech,
   music balance, and sync from the Composition preview.
6. Confirm the story names its subject, completes setup-transformation-payoff,
   and holds long enough on an intentional ending.
7. Patch the Remotion source and rerun only affected checks until no blocking
   issue remains. Persist the final Composition artifact with its real design
   path and review evidence.

## Materialization Boundary

- Publish the exact reviewed `design_path` once.
- Call `materialize_media` once. In Studio Run it waits for the real MP4 at the
  locked source resolution.
- Successful materialization automatically completes the Review and Delivery UI
  stages and records the MP4 plus editable source paths.
- Do not author Review or Delivery JSON, and do not start another review,
  preview, publish, or render loop after materialization succeeds.
- If export fails, keep the editable Composition and report the export failure.
  If the source itself needs revision, patch Composition before retrying.

## Delivery Risk Checks

- Reference drift: promised pacing or structure disappeared without an explicit
  decision.
- Source betrayal: generated filler displaced footage or voice the user asked
  to preserve.
- Semantic completeness: the visual metaphor supports rather than replaces the
  subject name, core claim, payoff, and final line.
- Audio intent: unless silence was explicitly requested, narration, music, or
  sound design supports the narrative and final resolution.
