---
name: multi-angle-video
description: Turn a supplied single-camera take into professional multi-angle coverage with new camera positions and motivated cuts, preserving its performance, action timing, gaze, identity, and original soundtrack. Use for multi-angle, multi-camera re-shoot, 多机位, or 单镜头变专业视频 requests; simple crops and existing multicam synchronization use ordinary editing.
allowed-tools: read_file list_files analyze_video analyze_image transcribe_audio preview_frame generate_animation run_code write_file
metadata:
  makaron:
    icon: "🎥"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: true
    manifestVisible: true
    sourceMediaRequired: true
    modelPreference:
      - seedance-2.5
    tags: [video, multi-angle, multi-camera, coverage, source-edit]
---

# Multi-Angle Video

Create synthetic camera coverage of the event already recorded in the source.
The user wants new viewpoints and professional cutting, while the performance
and soundtrack remain the authority. Framewise fidelity is an acceptance target,
not a guarantee made before inspecting the generated result.

This is a specialized source edit. Read `prompts/animate.md` and
`skills/video-edit/SKILL.md` before generation. Use its source-edit change/preserve
contract: change camera placement, lens, framing, focus, and approved camera
motion; preserve the event. Do not use its replication profile or
`replication_contract`, which would lock the camera grammar we intend to change.

## Establish the source clock

- Resolve one actual source video from Media Index or workspace. If absent, ask
  for a clip; do not generate a substitute take. Reuse existing upload evidence.
- Probe duration, dimensions, FPS, rotation, file size, and audio streams with
  Node media runtime. Read `skills/video-ffmpeg-lab/SKILL.md` for file operations.
  Record the selected source and any trim's offset in a workspace plan.
- Prefer a continuous, reasonably stable shot with visible actions. For already
  cut footage, preserve its existing boundaries and plan coverage per continuous
  take. A moving camera may need more conservative angles; do not imply it is a
  locked-off take. Account for uncertain or unseen geometry when choosing shots.
- Current Makaron Seedance 2.5 input/output is 4–30 seconds per take. Follow the
  runtime's current size/FPS limits, not the article's fal limits. Prepare format
  or size repairs deterministically. For a longer source, plan model-sized
  sections and their seams without compressing the original performance. Keep
  original-global and section-local times explicit; avoid a final section under
  the model's minimum duration by adjusting earlier boundaries.
- Settle trimming before analysis. Every subsequent measurement uses the actual
  submitted clip's clock. Crops/transcodes retain its timing and audio.

## Measure actions and speech

Inspect only evidence still needed to design coverage. Use `analyze_video` for
uncertain action, geometry, eyeline, or blocking. Use FFmpeg frame extraction or
`preview_frame` for measured event anchors: about 1 frame/second for orientation,
then denser samples around quick gestures, prop transfers, throws, or catches.
Check labels against decoded frame timestamps; analysis prose alone is not a
precise motion clock. A 4 fps sheet is a starting point, not proof of subframe
precision. Record the measurement uncertainty rather than inventing decimals.

If speech is present, read `skills/_shared/speech-clock.md` and transcribe the
chosen source once. Reuse its full persisted word timings when the inline list
is compacted. Group neighboring spoken words into talking windows (a gap near
0.3s is a useful starting point); gaps form quiet windows. Check laughter,
chewing, humming, and other vocal activity against audio and frames: ASR silence
does not mean a closed or motionless mouth. With no speech, skip transcription.
With no audio stream, keep the final silent unless new sound was requested.

Persist a compact coverage plan through `write_file` before paid generation:

```json
{
  "source": { "mediaIndex": 1, "duration": 20.08, "fps": 30, "sourceOffset": 0, "hasAudio": true },
  "aCamera": "original lens position and the performer's established eyeline",
  "locked": ["identity", "wardrobe", "prop counts", "blocking", "action clock", "original audio"],
  "talkingWindows": [],
  "quietWindows": [],
  "actionAnchors": [],
  "shots": [],
  "generation": { "model": "seedance-2.5", "resolution": "720p", "taskId": null },
  "qa": { "status": "planned", "failures": [] }
}
```

Replace example measurements with observed values. Each shot records
`start`, `end`, `cameraPosition`, `lensFeel`, `focus`, `movement`, `action`, and
`cutReason`. Shot ranges start at zero, end at the measured source duration, and
cover the clock in order without gaps or overlaps. Preserve action-anchor
uncertainty and speech timing provenance in the plan.

## Direct professional coverage

Choose shot count and pacing from the scene and brief. A compact take often
needs only a few useful angles; thirteen is an example, not a requirement.
Alternate establishing view, face/reaction, and meaningful hand/prop inserts.
Give dialogue enough room; cut at phrase boundaries, action initiations, or
reaction beats. Maintain screen direction and spatial orientation. Favor clear
hard cuts over decorative transitions. Avoid gratuitous orbits, extreme macro,
and invented background details when unseen geometry would dominate the shot.

Describe the original A-camera in world space. The subject's gaze remains aimed
at that original lens or at source-observed objects. New cameras never attract
their gaze. A look into a new lens is allowed only if it reproduces the source's
actual gaze direction; returning to the A-camera axis can provide a clean end.
Count handled props and lock their locations, hand ownership, and trajectories.
Camera/lens descriptions are aesthetic directions, not measured physical lenses.

Build one complete prompt with a short title, the source marker, locked event,
speech/quiet windows, action anchors, gaze rule, and every timed shot. Example
language to adapt to the observed source:

> Film additional coverage of the event in <<<media_1>>>. Keep the same complete
> source clock in real time. At each timestamp preserve the person's action,
> pose, expression, mouth motion, gaze, and object state. Change only the planned
> camera viewpoint, lens feel, framing, focus, and camera motion. Preserve the
> source lighting, identity, wardrobe, set, and prop counts. Do not redirect the
> performer toward the new lenses. Do not add speech or actions. No retiming,
> repeated actions, slow motion, freezes, or duplicated objects. Preserve source
> audio in sync. Follow these contiguous shot ranges: [measured shot list].

Use the user's language for the script and explanations. Do not copy an
article's actor, location, dialogue, props, or action timestamps into a new take.
Optional source-derived stills may anchor identity/set; they cannot substitute
for the source video or create first-frame semantics.

## Submit through the supported product route

The inspiration uses fal's `task: editing`. Makaron currently uses Evolink and
its shared source-edit contract requires reference-to-video semantics. Do not
paste fal parameter names, @Video1 markers, draft IDs, or pricing into Makaron.
Do not bypass product tools to call a different provider.

Respect an explicitly selected model. If it cannot preserve the source clock
while changing viewpoint, explain the concrete capability gap and propose
Seedance 2.5; do not silently submit the same script to a different model.

- `model: "seedance-2.5"`, `video_intent: "generate"`,
  `video_operation: "generate"`, `duration: -1`, `output_format: "mp4"`.
- Put the timeline source's `<<<media_N>>>` in the complete `story_prompt`.
  For a workspace source outside Media Index, use its actual HTTPS URL as
  `video_ref_url`, with `video_ref_type: "feature"`, and clearly identify that
  reference's source-clock authority in the prompt. Do not reference unrelated
  timeline media.
- Default to one 720p pass. Use 480p for an explicitly requested draft or budget
  test. Preserve a selected resolution within the current capability; this route
  does not expose fal draft completion or 1080p. An additional final pass is a new
  generation, not an upscale, and needs the applicable budget/authorization.
- Omit `keep_original_sound` (unsupported on this route), and describe source
  audio preservation in the prompt. Keep the original audio asset for remuxing;
  a prompt alone cannot guarantee an unchanged soundtrack.
- Follow the existing generation authorization gate. A skill selection alone
  grants no paid submission. Reuse explicit direct-submit authority; otherwise
  show the measured shot script and current cost estimate for confirmation.
- Record the returned task ID. Submission is pending work. Resume from that task
  and its actual completed media; never resubmit merely because it is slow.
  If the UI requires a follow-up, use `completion_actions` for reviewing coverage
  and restoring the original audio, carrying the source and plan workspace path.

## Verify and deliver

Compare actual decoded source/output frames at each shot's midpoint, every cut,
important motion anchors, and speech close-ups. Confirm new angles are visible,
cuts are motivated, identity/props stay stable, gaze does not chase the cameras,
mouth activity matches talking/quiet windows, and fast actions keep their timing.
Review moving playback and sound; a contact sheet alone cannot prove continuity.

After visual timing passes, use Node FFmpeg to keep the generated picture and
replace its entire audio with the selected original take's stream, or remove
generated audio when the source is silent. Stream-copy source audio if compatible
with MP4; otherwise encode once for playback and disclose that re-encoding.
Retain the source audio stream start offset. Verify decoded audio timing and
source/output duration within one source frame or the codec's measured tolerance.
Trim harmless trailing picture only after checking its clock; do not stretch,
pad, freeze, or speed-adjust a short/drifting result to manufacture fidelity.
Do not use `-shortest` to conceal a missing ending. If visual action or lip timing
drifts, remuxing audio does not fix it: record the failure and revise the prompt
or use an accepted source segment rather than claiming success.

Publish the assembled workspace MP4 once with `write_file` and its exact
`workspacePaths`. Persist final media paths and QA in the same plan. Report
duration, resolution, shot coverage, original-audio treatment, and visible
limitations. Distinguish a pending job, a generated candidate, and an accepted
playable deliverable. A paid retry needs an observed failure and a concrete
correction; keep the user's budget/retry limit, and do not loop on unchanged
prompts. Exact reshoot fidelity that cannot be demonstrated remains unverified.

## Source

Workflow inspiration: [fal multi-angle article](https://fal.ai/learn/tools/how-to-create-multi-angle-video-seedance-2-5).
Its current [API schema](https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api)
describes fal, not Makaron's available provider route. Recheck product capabilities
when the route changes.
