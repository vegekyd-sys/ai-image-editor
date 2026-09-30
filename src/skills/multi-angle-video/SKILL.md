---
name: multi-angle-video
description: Turn a supplied single-camera take into story-driven multi-angle coverage, with expressive shot sizes, purposeful details and reactions, and motivated cuts grounded in the original performance. Use for multi-angle, multi-camera re-shoot, 多机位, or 单镜头变专业视频 requests; simple crops and existing multicam synchronization use ordinary editing.
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
      - fal-h3-max
    tags: [video, multi-angle, multi-camera, coverage, source-edit]
---

# Multi-Angle Video

Create synthetic camera coverage of the event already recorded in the source.
The user wants a directed scene: attention, emotion, and pacing shaped through
new viewpoints and professional cutting. The performance and soundtrack remain
the authority. New angles alone do not satisfy this skill. Framewise fidelity is an acceptance target,
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
  "storyArc": "an interpretation supported by the recorded actions, not a new plot",
  "beats": [],
  "shots": [],
  "generation": { "model": "seedance-2.5", "resolution": "720p", "taskId": null },
  "qa": { "status": "planned", "failures": [] }
}
```

Replace example measurements with observed values. Each shot records
`start`, `end`, `beat`, `storyFunction`, `shotSize`, `cameraPosition`, `lensFeel`,
`focus`, `movement`, `action`, and `cutReason`. Record the contrast with the
preceding shot and any implied environment that needs output review.
Shot ranges start at zero, end at the measured source duration, and
cover the clock in order without gaps or overlaps. Preserve action-anchor
uncertainty and speech timing provenance in the plan.

## Find the scene's story before choosing angles

Interpret the recorded performance in one sentence: what draws attention at the
start, what changes, and what resolves or remains at the end? A routine gesture
can carry a small story: anticipation, hesitation, release, discovery, pleasure,
or a visual punchline. Infer tone from actual speech, expressions, and actions;
do not invent a conflict, backstory, or new behavior to create an arc.

Break the source into meaningful beats, each with an observed action, emotional
or informational purpose, and source-clock evidence. Then assign shot functions:
Keep story interpretation separate from visible facts: metaphors in the brief
must not introduce new objects, actions, or contents in shot descriptions. Update
old action uncertainties when denser source frames provide better evidence.

- Establish the person and their relationship to the space, not just a slightly
  rotated version of the source framing.
- Move close when a face or reaction reveals something; leave enough time to
  read it. A close-up must earn its intimacy.
- Use a hand, object, texture, or interaction insert when that detail advances
  attention. Dialogue may continue over it in the unchanged source soundtrack;
  not every spoken word needs a visible face. Do not fabricate screen text.
- Choose a meaningful point of view: over an object, through a foreground edge,
  near table height, above the action, or along an existing motion trajectory.
  Explain what the viewpoint reveals that the previous shot did not.
- Let an environment shot give a pause, scale, or contextual payoff. Preserve
  confirmed landmarks and spatial relationships; allow restrained inferred
  geometry when needed for the viewpoint, mark it for review, and avoid new
  conspicuous features. Unseen geometry is a review risk, not a blanket reason
  to keep every shot at eye level.
- Shape the ending as an observed payoff or reaction. Do not spend the whole
  ending on a generic frontal medium shot if a recorded gesture can resolve it.

Choose number and duration from these beats. A lively 15-second action-led take
may support roughly 8–10 shots; a sustained emotional moment may need far fewer.
Neither that range nor the inspiration's shot count is a template. Do not fill
time with redundant coverage or chop every sentence for variety. Short inserts
can accelerate a beat; a longer reaction or wide shot can let it breathe.

## Compose an expressive shot progression

For a scene with a visible person, setting, and handled objects, actively explore
wide/context, medium/action, close/reaction, and detail/insert coverage. Use clear
changes of scale, height, depth, or viewpoint, rather than a sequence of small
left/right rotations at the same distance. If fewer functions suit the source,
state the creative reason. The point is attention control, not lens numbers.

Audit the proposed sequence before generation: does each cut reveal, emphasize,
connect, or release something? If adjacent shots serve the same purpose and only
change azimuth, replace one with a motivated detail, perspective, or reaction,
or merge them. Make the middle develop and the ending land. A plan dominated by
eye-level medium shots fails creative review even when its timestamps are valid.

Cut at phrase boundaries, changes of attention, action initiations, or reaction
beats. Use continuity across a cut to make a gesture feel uninterrupted. Maintain
screen direction and spatial orientation. Favor clean hard cuts; use focus and
foreground composition to guide attention. Avoid decorative orbits and arbitrary
extreme angles. Tight details and low/high viewpoints are welcome when motivated
by the action and compatible with the source.

Describe the original A-camera in world space. The subject's gaze remains aimed
at that original lens or at source-observed objects. New cameras never attract
their gaze. A look into a new lens is allowed only if it reproduces the source's
actual gaze direction; returning to the A-camera axis can provide a clean end.
Count handled props and lock their locations, hand ownership, and trajectories.
Camera/lens descriptions are aesthetic directions, not measured physical lenses.
Make that distinction explicit in the generation prompt: additional angles are
virtual viewpoints, not additional objects in the set. Do not show cameras,
tripods, filming rigs, lights, or crew unless already visible in the source.
An offscreen A-camera defines an eyeline only; never materialize it in an
over-the-shoulder view.

Build one complete prompt with a short title, source marker, the observed story
arc, and every timed shot's visual purpose and composition. Lead with the desired
film: put the timed shot list immediately after a short creative brief. Describe
each shot concisely by purpose, size/viewpoint, and actual action; do not paste
the plan's entire risk register into every shot. Then give one compact source-performance contract,
the important action anchors and speech/quiet windows, and gaze/equipment rules.
Do not bury cinematography under repeated prohibitions or a generic adjective
such as "cinematic". Example
language to adapt to the observed source:

> Film additional coverage of the event in <<<media_1>>>. Keep the same complete
> source clock in real time. At each timestamp preserve the person's action,
> pose, expression, mouth motion, gaze, and object state. Change only the planned
> camera viewpoint, lens feel, framing, focus, and camera motion. Preserve the
> source lighting, identity, wardrobe, set, and prop counts. Do not redirect the
> performer toward the new lenses. Do not add speech or actions. No retiming,
> repeated actions, slow motion, freezes, or duplicated objects. Preserve source
> audio in sync. These are virtual viewpoints; do not add visible cameras,
> tripods, filming equipment, or crew. Follow these contiguous shot ranges:
> [measured shot list].

Use the user's language for the script and explanations. Do not copy an
article's actor, location, dialogue, props, or action timestamps into a new take.
Optional source-derived stills may anchor identity/set; they cannot substitute
for the source video or create first-frame semantics.

## Submit through the supported product route

The inspiration uses Seedance on fal with `task: editing`. Makaron's Seedance
route currently uses Evolink and its shared source-edit contract requires
reference-to-video semantics. Do not
paste fal parameter names, @Video1 markers, draft IDs, or pricing into Makaron.
Do not bypass product tools to call a different provider.

Respect an explicitly selected model. Seedance 2.5 is the default; FAL H3 Max
(`fal-h3-max`, not the separate `minimax-h3-max` Turbo model) is also available
for an explicitly requested comparison or source-reference generation. On H3
Max, preserving performance/action timing is a prompt target that must be
checked on the actual output, not a guaranteed direct-edit capability. If a
different selected model lacks usable video references, explain the concrete
gap instead of silently rerouting.

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
- For `fal-h3-max`, use `video_intent: "generate"`,
  `video_operation: "generate"`, explicit integer `duration` from 5–15 seconds,
  and the same source-clock prompt and feature video reference. Its default is
  768p; 480p/1080p are available. Each source reference and all source videos
  together must fit 15 seconds. It has no typed edit/extend or exact-original-
  audio toggle. When comparing models, reuse the identical prepared source and
  measured coverage plan, record each model's actual resolution/cost, and label
  native output versus any later original-audio remux separately.
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
Check that the model has not drawn filming equipment into reverse/shoulder shots.
Review moving playback and sound; a contact sheet alone cannot prove continuity.
Creative QA is separate from fidelity QA. Record actual distinct shot sizes and
viewpoints, the inserts/reactions/context that survived, and whether the opening,
development, and ending convey the planned arc. Evaluate shot usefulness and
rhythm, not just cut count. Multiple angles with monotonous scale or no narrative
development remain a failed candidate, even with perfect source timing. Compare
with the supplied inspiration's level of visual storytelling, never require its
specific shot order, invented setting details, or actor-specific gestures.

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

If a generated candidate truncates the ending, consider a deliberate source
closing shot instead of a tiny appended tail. Replace the whole closing shot at
a motivated action/reaction boundary with the same original-clock source range;
a restrained crop may provide a useful change of scale. Check the join's action,
eyeline, appearance, framing, and quality. This cannot fix earlier generated
drift. Preserve the actual recorded ending and disclose the result as a hybrid
edit with its AI/source time ranges, not a full native model output. If the join
does not work, retain the failure and revise rather than manufacture duration.

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
