---
name: multi-angle-video
description: Turn a supplied single-camera take into multi-angle coverage whose framing and cuts express the source dialogue, emotion, and actions. Use for multi-angle, multi-camera re-shoot, 多机位, or 单镜头变专业视频 requests; simple crops and existing multicam synchronization use ordinary editing.
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
new viewpoints and professional cutting. Understand what is being communicated
before deciding how to film it: spoken meaning shapes framing, attention, and
rhythm, rather than serving only as a lip-sync clock. The performance and soundtrack remain
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

First use `analyze_video` on the selected take to understand dialogue together
with the visible performance, unless equivalent analysis of this exact take is
already persisted. Ask for spoken meaning, tone, rhetorical/emotional turns,
actual actions, and their relationship, as well as geometry and eyeline. Ask it
to distinguish what is said from what is visibly done and to flag uncertainty.
An analysis can suggest interpretation; it cannot establish precise timestamps
or facts unsupported by the recording. If the tool fails, record the failure
and combine transcription with decoded frames; do not replace speech analysis
with an action-only storyboard. Use FFmpeg frame extraction or
`preview_frame` for measured event anchors: about 1 frame/second for orientation,
then denser samples around quick gestures, prop transfers, throws, or catches.
Check labels against decoded frame timestamps; analysis prose alone is not a
precise motion clock. A 4 fps sheet is a starting point, not proof of subframe
precision. Record the measurement uncertainty rather than inventing decimals.

Classify the actual sound before treating it as speech: performer dialogue,
voiceover, music/lyrics, ambience, or silence. Burned-in captions can communicate
the lesson even when the performer does not speak; keep their meaning separate
from a speech clock. If ASR reports no speech, check the sound and decoded frames
before calling it a missing transcript. Do not make a silent demonstrator recite
the source captions or song lyrics. Record any requested removal/recreation of
overlays separately from performance preservation.

If speech is present, read `skills/_shared/speech-clock.md` and transcribe the
chosen source once. Reuse its full persisted word timings when the inline list
is compacted. Group neighboring spoken words into talking windows (a gap near
0.3s is a useful starting point); gaps form quiet windows. Check laughter,
chewing, humming, and other vocal activity against audio and frames: ASR silence
does not mean a closed or motionless mouth. With no speech, skip transcription.
With no audio stream, keep the final silent unless new sound was requested.

Reconcile analysis with the measured speech and action clocks before planning.
Use persisted word timings for phrase boundaries and source frames for actions;
video analysis may round times or put an action inside the wrong utterance.
Keep literal words, their interpretation, and visible facts distinct. A speaker
mentioning an action does not authorize enacting it; a spoken referent may be
offscreen, figurative, remembered, or hypothetical.

Persist a compact coverage plan through `write_file` before paid generation:

```json
{
  "source": { "mediaIndex": 1, "duration": 20.08, "fps": 30, "sourceOffset": 0, "hasAudio": true },
  "aCamera": "original lens position and the performer's established eyeline",
  "locked": ["identity", "wardrobe", "prop counts", "blocking", "action clock", "original audio"],
  "talkingWindows": [],
  "quietWindows": [],
  "actionAnchors": [],
  "meaningBeats": [],
  "storyArc": "an interpretation supported by the recorded actions, not a new plot",
  "beats": [],
  "shots": [],
  "generation": { "model": "seedance-2.5", "resolution": "720p", "taskId": null },
  "qa": { "status": "planned", "failures": [] }
}
```

Parse the saved plan with Node `JSON.parse` before submission and verify that
shot ranges form one contiguous source clock. Reference the complete persisted
ASR artifact rather than manually retyping long word arrays. The final submitted
prompt and plan must have the same reviewed shot ranges; revise both when
creative review changes the sequence.

Replace example measurements with observed values. Each shot records
`start`, `end`, `beat`, `storyFunction`, `shotSize`, `cameraPosition`, `lensFeel`,
`focus`, `movement`, `action`, `meaningBeatIds`, and `cutReason`. Record the contrast with the
preceding shot and any implied environment that needs output review.
Shot ranges start at zero, end at the measured source duration, and
cover the clock in order without gaps or overlaps. Preserve action-anchor
uncertainty and speech timing provenance in the plan.
Carry those anchors into each shot's opening state: an action begun before a cut
continues from its current pose and prop state, rather than restarting in the
new angle. Remove contradicted action claims from the shot and prompt; retaining
both conflicting instructions with a general "follow the source" caveat is
insufficient. Resolve uncertain state before paid submission or mark that part
of the plan unverified and inspect the source.

## Find the scene's story before choosing angles

For speech-led footage, map the actual phrases into `meaningBeats` before choosing
shots. Each beat records `id`, `start`, `end`, `words`, `meaning`, `tone`,
`visibleEvidence`, `attentionTarget`, and `visualPurpose`, with timing provenance
and uncertainty. Identify the speaker's claim, admission, contrast, reveal,
question, or payoff; combine phrases when they form one thought. Map pauses and
physical reactions too. For a silent take, use observed actions in these fields
and omit `words`. Do not label beats only with objects or generic action names.

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

Choose size, composition, and duration from the meaning of each beat. A personal
admission may need face intimacy; an explanation may need the relevant detail;
a reversal may need a held reaction; a claim about the surroundings may need
space to become visible. These are options, not a fixed face/detail/wide recipe.
If a selected excerpt begins mid-thought, use the available source context to
interpret the fragment, and record any remaining uncertainty. Do not turn a
fragment into a different claim merely to give the opening a story.
Keep a face when delivery carries the meaning; show a referent when seeing it
helps the thought. Do not cut to every noun or illustrate absent events.
If speech turns from one idea to another, let the visual emphasis turn with it,
at the measured phrase boundary. A connecting phrase can stay on the speaker
until the new subject is introduced. Hold the resulting shot long enough for
the thought to land; variety must not interrupt an important reveal or sentence.

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
When meaning calls for a wider space, specify observable composition: a smaller
person in frame, readable landmarks and their relationship, and the depth or
area revealed relative to the preceding shot. Calling a shot "wide" or naming
a lens is insufficient if the result retains the source medium framing.

Audit the proposed sequence before generation: does each cut reveal, emphasize,
connect, or release something? If adjacent shots serve the same purpose and only
change azimuth, replace one with a motivated detail, perspective, or reaction,
or merge them. Make the middle develop and the ending land. A plan dominated by
eye-level medium shots fails creative review even when its timestamps are valid.

Every shot's `cutReason` must explain why this framing belongs at this point in
the spoken thought or observed action. Listing the current action and a lens is
insufficient. Before generation, review the shot list with the transcript:
does the viewer's visual attention follow the speaker's changing meaning?
Would exactly the same sequence fit unrelated dialogue? If so, revise its
emphasis and timing. Permit purposeful holds and speech over inserts; avoid
forcing a new shot for every phrase.
Check changes of framing inside a shot too: if a move provides the semantic
reveal, describe its starting composition and how it changes on the relevant
phrase. Repairing action continuity must preserve that visual emphasis. An
action may continue outside the frame; showing every action in full is not a
reason to reveal the next idea prematurely.

A semantic transition need not add a separate short bridge shot: a continuous
reframe or focus change can let a product arrive in its real source gesture,
then become the attention target. Avoid near-identical adjacent face portraits
and subsecond bridges that fragment a single thought without revealing anything.

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
For a product insert, move the virtual camera closer to the recorded held item;
do not have the presenter thrust it toward the lens or add a beauty pose to
create the framing. Do not add corrective diagrams, dotted lines, or teaching
overlays unless requested. These would change the event or its presentation
beyond new camera coverage.
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
each shot concisely by purpose, size/viewpoint, and actual action. For speech-led
shots, identify the relevant source phrase (a semantic label or beat ID can
avoid repeating dialogue) and why its meaning motivates this
composition or hold; give measured source-clock ranges, not only a list of
shots to distribute across the clip. Do not paste
the plan's entire risk register into every shot. Then give one compact source-performance contract,
the important action anchors and speech/quiet windows, and gaze/equipment rules.
Do not bury cinematography under repeated prohibitions or a generic adjective
such as "cinematic".

Keep dialogue separate from directing instructions. If quoting the complete
source text is necessary, quote it once with its clock; use meaning labels in
other sections. These are directions for preserving the recorded speech, not
new lines to recite. A source audio feature reference can help voice consistency
on a supported model, but it does not guarantee phrase timing or unchanged sound.

Source-performance contract to adapt to the observed source:

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
Transcribe a speech-bearing native candidate once to check omissions, repetition,
extra words, overlapping voices, and phrase drift before any original-audio
replacement. A repeated benefit or new claim invalidates a testimonial even if
the product reveal lands on time. A source audio feature is a reference, not a
protected immutable sound layer. Resolve
conflicting automated reports against the actual audio and decoded frames;
video analysis can hallucinate actions or echo supplied reference timestamps.
Creative QA is separate from fidelity QA. Replay with the original speech and
compare the actual cuts/framing with `meaningBeats`, especially turns and payoffs.
Record whether each key thought receives its intended visual emphasis and whether
the shot arrives on its phrase, not merely somewhere in the scene. A visually
varied result still fails semantic QA if unrelated inserts distract from delivery,
the relevant subject stays unreadable, or the key visual reveal arrives before
or after its spoken meaning. Fix the observed mismatch before accepting it;
shared audio in a comparison is not evidence of semantic or lip-sync success.
Record actual distinct shot sizes and
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
