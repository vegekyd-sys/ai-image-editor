# Studio Reviewer Contract

Review artifacts before approvals and review the actual MP4 before delivery.
Criticism must be observable and actionable.

## Stage Reviews

- A draft carrying `__makaronScaffold: true` is only a durable structural
  checkpoint. It must never pass Composition, Review, publish, or Delivery.
  Apply the original Composition and Director guidance first.
- Brief: a concrete audience, outcome, and source/reference classification.
- Proposal: concepts differ in structure and visual mechanism; the selected
  path is feasible with current Makaron tools and budget.
- Script: timing covers the promise; hooks, claims, selections, or translated
  cues are coherent and speakable.
- Storyboard: one focal point per scene, visible variety, feasible assets, and
  clear subtitle/UI safe areas.
- Assets: every referenced file is ready, attributable, and linked to scenes.

## Composition Draft Gate

Run this gate on the first complete autosaved Remotion draft, before publishing
the composition or materializing an MP4.

1. Compute `expectedDurationFrames = round(durationSeconds * fps)` and confirm
   the scene timeline covers exactly that duration. Overlap must not shorten the
   ending or leave uncovered tail frames.
2. Inspect every scene boundary at its exact transition time. Batch timestamps
   into 2-6 frame contact sheets; include stable hook/body frames and the final
   visible frame. A generic hook/body/end sample is not enough for a multi-scene
   video with transitions.
3. Check for black/blank frames, transition gaps, accidental double exposure,
   missing media, unreadable text, subtitle collisions, and ending-frame loss.
   Compare each sampled frame to its Storyboard `visualPlan`. A close/medium
   hero rendered as a small centered icon on a mostly empty field is an
   underfilled frame and must be patched before export.
4. For each narrated Script section, inspect the representative speaking frame
   recorded in `subtitleSyncEvidence`. The displayed phrase must describe the
   same beat as both the current picture and the narration actually sounding
   then. Planned Script ranges alone are not timing evidence for a continuous
   TTS file. Use ASR timing, retime mismatches, and keep evidence linked to the
   persisted Storyboard scene. Do not standardize wording, placement,
   typography, JSX, or animation to pass this gate.
   Composition timing must exactly reuse Storyboard `narrationTimingEvidence`;
   do not silently invent a second timing map after assets are generated.
   Composition must also record the exact `subtitleText` it authored at each
   representative frame. It may use the spoken line or a concise phrase from
   that same Script section's `onScreenText`; do not force a transcript when
   kinetic or integrated copy better serves the scene. Unrelated copy from a
   different beat is invalid.
   Studio Run verifies that every claimed phrase exists in the saved
   Composition code, props, or editables; evidence cannot invent unseen copy.
   In Final Review, preview the materialized MP4 at every representative time
   and persist one `subtitleVisualEvidence` record per section with that raw
   `drafts/video-...` frame path, the exact displayed phrase, and the
   observed non-text subject/action. `displayedText` must exactly match Composition
   `subtitleText`; a design-preview frame or unrelated phrase is not valid
   evidence.
   Do not use the title or subtitle itself as the observed picture. This is a
   semantic scene check, not a subtitle styling or word-level timing template.
5. Confirm required audio props are resolved public URLs, not undefined values
   or `<<<audio_N>>>` markers.
6. Patch and rerun only the affected boundary/ending checks until there are no
   unresolved issues. Persist this evidence in the Composition `draftGate`.

Only a passing draft gate may advance to Review.

## Final Review

1. Materialize the MP4 from the exact gated design with `wait: true` and retain
   the returned `.mp4` URL/path. Editable Composition JSON is not review media.
2. Verify container, duration, resolution, FPS, and audio presence.
3. Sample opening, strongest body beat, ending, and one previously checked risky
   transition to detect renderer drift. Reuse the Composition draft-gate plan;
   do not restart timeline debugging from scratch.
4. Check black/blank frames, missing media, unreadable text, overlaps, source
   crop, subtitle safe areas, and final-frame quality.
   Recheck visual-plan fidelity and reject underfilled frames even when all
   text remains readable.
   When a compact contact sheet looks ambiguous at its display scale, inspect
   the corresponding full-resolution frame paths before declaring a black or
   blank frame.
5. Check audio for unexpected silence, intelligible speech, music balance, and
   sync. Reconfirm that each sampled subtitle or kinetic phrase matches the
   active narration and visible beat in the materialized MP4; readable but
   semantically early or late text is a review failure.
   Numeric LUFS and true-peak fields must come from the deterministic FFmpeg
   measurement attached to `materialize_media`; Studio Run fills these values
   from the final MP4 and never trusts estimates from listening or Composition
   volume settings.
6. Confirm the locked runtime and editability promise were honored.
7. Confirm the story names its subject, completes setup-transformation-payoff,
   and holds long enough on an intentional ending.

## Delivery Risk Checks

- Reference drift: promised pacing or structure disappeared without an explicit
  decision.
- Source betrayal: generated filler displaced the footage or voice the user
  asked to preserve.
- Semantic completeness: the visual metaphor supports rather than replaces the
  subject name, core claim, payoff, and final line.
- Audio intent: unless silence was explicitly requested, narration, music, or
  sound design supports the narrative and final resolution.

A passing review has no unresolved blocking issue. If revision is needed,
invalidate the earliest responsible Studio Run stage and regenerate downstream
work instead of patching the delivery record. Delivery must not render, patch,
preview, or publish media; it only records the already-reviewed output and
editable source paths.
