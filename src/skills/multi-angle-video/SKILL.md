---
name: multi-angle-video
description: Change the camera coverage and cutting of a supplied single-camera take while preserving its recorded content, performance, dialogue and source clock. Use for multi-angle, multi-camera re-shoot, 多机位, or 单镜头变专业视频 requests; simple crops and existing multicam synchronization use ordinary editing.
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
      - wan-3.0
      - fal-h3-max
    tags: [video, multi-angle, multi-camera, coverage, source-edit]
---

# Multi-Angle Video

The source is a finished performance, not inspiration for a new film. Change
only how we observe it: camera position/direction, framing, lens/focus and cuts.
The words, people, scene, expressions, gestures, prop states, action order and
action times remain those already recorded. Narrative direction means deciding
what existing evidence to show when; it never means rewriting what happened.
Content fidelity takes precedence over an impressive shot. If a proposed view
requires a different event or an invented set, redesign the view.

Complete the selected Chat workflow: inspect source facts, design coverage,
validate the plan, and submit the selected model. The generated video with its
model-produced soundtrack is the deliverable. Generation completes this workflow;
do not attach post-generation tasks, restore the source audio, or schedule a
second Agent run. A storyboard alone is intermediate. Content preservation is
a generation target, not a verified guarantee.

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
  Save plans and any generation references under this project's namespace;
  account-wide generic filenames can collide across simultaneous projects.
- Prefer a continuous, reasonably stable shot with visible actions. For already
  cut footage, preserve its existing boundaries and plan coverage per continuous
  take. A moving camera may need more conservative angles; do not imply it is a
  locked-off take. Account for uncertain or unseen geometry when choosing shots.
- Default Wan3 Standard accepts 2–30 second outputs and up to 15 seconds of
  source video, with source seconds plus output seconds <=30 per generation.
  A 15-second source and 15-second output fit this workflow. When explicitly
  selected, H3 Max accepts 5–15 second outputs and up to 15 seconds of source.
  For a longer source, use the requested excerpt, or
  plan sections and their seams without compressing the performance. Keep
  original-global and section-local times explicit. Prepare format/size repairs
  deterministically; do not silently switch models to avoid segmentation.
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
precise motion clock. Inspect the final two seconds densely (about 4–8 fps)
when a handled prop or quick closing gesture is involved; a missed toss, catch
or bite changes the ending. Unconfirmed is not absent: never prohibit an action
merely because sparse samples did not show it. A 4 fps sheet is a starting point, not proof of subframe
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

For a quick handled-object action, inspect a decoded, timestamp-labelled dense
source sheet with `analyze_image` before paid generation. Extract with a known
source start time and sample cadence, keeping the actual selected-frame PTS in
a companion table; do not assign labels from an assumed first sample. Saving
frames without inspecting them is not measurement. Persist consequential states
(release/transfer, airborne/contact, catch/settle) as `{action, state, sourceTime,
evidence, uncertainty}` in `actionAnchors`. If the dense sheet is ambiguous,
inspect additional adjacent frames. An approximate action time from `analyze_video`
cannot replace this evidence. Do not write an exact opening state for an action
that has not been observed at that source time.

Reconcile analysis with the measured speech and action clocks before planning.
Use persisted word timings for phrase boundaries and source frames for actions;
video analysis may round times or put an action inside the wrong utterance.
Keep literal words, their interpretation, and visible facts distinct. A speaker
mentioning an action does not authorize enacting it; a spoken referent may be
offscreen, figurative, remembered, or hypothetical.

Record first-visible and last-visible times for a product or other narrative
reveal separately from physical possession. New framing must not expose a held
prop earlier than the source reveal. A wider view must stay within observed
appearance and set facts; do not invent an unseen outfit, body area, screen or
room merely to make a wider shot possible. Choose another camera view when its
visibility would change the information conveyed at that moment.

Persist a compact coverage plan through `write_file` before paid generation:

```json
{
  "source": { "mediaIndex": 1, "duration": 20.08, "fps": 30, "sourceOffset": 0, "hasAudio": true },
  "aCamera": "original lens position and the performer's established eyeline",
  "locked": ["identity", "wardrobe", "prop counts", "blocking", "action clock", "spoken content and speech clock"],
  "talkingWindows": [],
  "quietWindows": [],
  "actionAnchors": [],
  "contentLedger": [],
  "meaningBeats": [],
  "storyArc": "an interpretation supported by the recorded actions, not a new plot",
  "centralBeat": { "id": "", "viewerUnderstands": "", "visualChange": "" },
  "cameraMap": [],
  "sequenceOptions": [],
  "directorReview": { "status": "draft", "rejectedChoices": [], "revisions": [] },
  "beats": [],
  "shots": [],
  "generation": { "model": "wan-3.0", "resolution": "720p", "taskId": null }
}
```

Parse the saved plan with Node `JSON.parse` before submission and verify that
shot ranges form one contiguous source clock. In the same pre-submit check,
compare every consequential action claimed in a shot with its measured
`actionAnchors`: the shot containing release, contact or catch must contain its
source timestamp. Do not move an anchor to fit a nicer edit. Carry the same
compact numeric action-clock table into the submitted prompt, and check its
ranges against the plan again. A general "preserve source timing" sentence
cannot resolve a contradictory timed shot. Reference the complete persisted
ASR artifact rather than manually retyping long word arrays. The final submitted
prompt and plan must have the same reviewed shot ranges and compositions; revise both when
creative review changes the sequence.

Replace example measurements and model/resolution with the actual selected
source and user-selected route. Each shot records
`start`, `end`, `beat`, `storyFunction`, `shotSize`, `cameraPosition`, `lensFeel`,
`focus`, `movement`, `action`, `meaningBeatIds`, `cutReason`,
`sourceStateEvidence`, and `cameraOnlyDelta`. Record the contrast with the
preceding shot and any implied environment that needs output review.
Shot ranges start at zero, end at the measured source duration, and
cover the clock in order without gaps or overlaps. Preserve action-anchor
uncertainty and speech timing provenance in the plan.
Carry those anchors into each shot's opening state: an action begun before a cut
continues from its current pose and prop state, rather than restarting in the
new angle. At important prop/gesture cuts and the ending, the submitted shot
must name the observed body/hand/prop state; a generic "preserve the source"
line alone leaves H3 free to solve the framing by inventing performer movement.
Remove contradicted action claims from the shot and prompt; retaining
both conflicting instructions with a general "follow the source" caveat is
insufficient. Resolve uncertain state before paid submission or mark that part
of the plan unverified and inspect the source.

## Lock content before directing attention

Persist `contentLedger` alongside the measured anchors: source-clock ranges,
visible participants and relative positions, observed action/pose and hand
ownership, prop state changes, actual speech/captions, and evidence. Inspect
whole-clip decoded frames, then dense source frames at consequential transitions,
including changes of prop ownership, opening/closing and the ending. Reconcile
these with ASR before writing coverage. A video-understanding synopsis alone is
not enough to turn an uncertain state into a precise instruction.

Keep what is said separate from what is done. Saying an inbox was closed does
not establish that a laptop lid closed; describing a product's benefit does not
establish a physical demonstration. Likewise, an instructor explaining a motion
is not necessarily performing its completed result. Only observed visual states
enter the action clock. Do not simplify a recorded gesture into an easier but
different gesture to make the new view work.

For each shot, record `sourceStateEvidence` and `cameraOnlyDelta`: which source
frames establish its entry/exit state, and exactly which viewing variables change.
The performer's position, movement and object states are never part of that delta.
Validate every planned opening/closing, lift/lower, transfer, throw/catch, contact,
and demonstrated before/after against the ledger at its own source time. When
uncertain, inspect the source; do not fit an action to an attractive shot range.

Build the camera map within the observed scene. New views can strongly change
projection, height, foreground and scale, but must retain the same spatial
relationships and known backdrop. Do not extend an interior into an outdoor
location, relocate props, replace a wall/window or invent a beauty-shot setup.
Avoid a reverse view whose dominant unseen set cannot be supported; choose a
strong side or object-level composition inside the known geometry instead.
Grade/color, weather, lighting, branding and overlays are preserved unless the
user requested their change. Tight package views retain the actual package;
do not request enhanced labels, invented small print or a replacement pack.

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
  attention. Dialogue may continue over it in the source-following generated soundtrack;
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

## Direct a sequence, not a collection of portraits

The creative deliverable is a sequence of images that makes the recorded thought
or action easier to follow. Write its visual sentence before the shot list:
**attention → complication/question → evidence/interaction → consequence/payoff**.
Adapt this to the actual take; it is a progression of what the viewer notices,
not permission to invent events. A product testimonial can move from the human
problem to the recorded arrival of its solution, to the package, to the person's
conclusion. A demonstration can move from the whole relationship to the specific
mechanism and back to its observable result. A casual monologue can use the
speaker's actual objects and gestures as punctuation, with a reaction resolving
it. Never substitute unrelated illustrative B-roll for evidence.

Design the central turn first. Write exactly what becomes visually apparent at
its measured phrase/action, then the image that makes this apparent. Build the
lead-in and payoff around that image. If the same image would suit every phrase,
it does not yet express the turn. A comparison needs a matching perspective on
its observed before/after states; a correction needs the body/object relationship
that explains it, not just a flattering close-up of the teacher. Do not spend a
later reveal in the opening unless the later image adds new information.

Make a small `cameraMap` of distinct physical vantage points around the recorded
subject, not crop presets on the source axis. For each, name position, height,
view direction, visible landmarks, foreground and what it can reveal. Use the
known set and plausible adjacent space; record uncertainty about inferred geometry.
Choose source-compatible stations that produce visibly different projections:
a substantial three-quarter/side view, a low object-level view, a high spatial
view, or a reverse over a real foreground edge. The original camera is one
station, not the default for every shot. A change in lens alone is not a new angle.

Explore two brief sequences and choose the stronger source-grounded visual
sentence. At least one must use the fullest defensible contrast in viewpoint,
scale and depth. Do not downgrade it to similar frontal portraits just because
those are safer to describe. Record the rejected choices and resulting revisions
in `directorReview`; these are planning alternatives, not paid generations.

### Give each shot a visible job

Use an image description that a cinematographer could frame, in this order:
**[start–end] narrative job / camera station and height / frame boundaries and
foreground-background layers / focus and movement / source state in progress**.
`compositionDelta` explains the new information versus the previous shot.
Keep narrative interpretation in the plan. In the submitted shot, describe the
camera operation and the measured state already occurring, rather than giving
the actor a new performance instruction or a rewritten scene description.

Choose a shot grammar that fits the beat, rather than repeating medium → tighter
medium → medium. Useful coverage choices include:
- A low wide or high corner wide makes the person visibly smaller in readable
  space: use it to introduce stakes, give a pause or restore context.
- A tight three-quarter or side profile isolates an actual expression; crop
  deliberately and let shallow focus remove distracting space.
- An object-level insert puts the recorded hand/object interaction in the near
  plane and the speaker secondary or outside the frame. Move the camera to the
  held item; the performer does not push the item toward the lens for the shot.
- A reverse over an existing shoulder, tool or object edge builds depth and
  directs attention to the person or relation beyond it. Specify the real soft
  foreground shape and the sharp subject; do not materialize camera equipment.
- A viewpoint along the existing motion trajectory makes an action legible;
  carry its source release/transfer/contact states across the cut without replay.
- A matched relation shot before and after a correction lets the viewer see what
  changed; choose enough width to include the relevant body and object together.

These are compositional tools, not a mandatory order. Describe frame edges,
subject dominance, occlusion and depth explicitly; focal-length adjectives alone
are too weak. A detail insert must visibly replace the dominant person portrait,
and a spatial wide must actually reveal space. Full frame throughout; do not
replace depth with PIP, split screens or collage. Reporting grids are separate.

### Make the edit carry the thought

A long meaning beat can contain several visual sub-beats: anticipation, arrival,
contact, inspection and reaction. Use those observed micro-events to create
coverage within a sentence while its original speech continues uninterrupted.
Not every cut needs a new sentence, and speech does not require a visible face.
For an active 15-second take, explore roughly 7–10 useful shots as a first draft;
retain fewer only when a specific thought or reaction needs a sustained hold,
and retain more only when the source has readable micro-events. This is a rhythm
starting point, not a quota or authorization to manufacture action. Avoid spending
most of the film in three or four similar long presenter framings.

Alternate information scale deliberately: context, intimate expression, concrete
evidence, relation, reaction. Adjacent shots should differ visibly in scale,
projection or depth, not just yaw slightly. Give the central turn the strongest
relevant contrast. A short insert can punctuate a motion or word; a longer held
reaction lets its implication land. Cut on measured attention shifts and gesture
states, maintaining screen direction and the uninterrupted source clock.

Camera motion is available when it changes what we learn: a short tabletop slide
can reveal a hand meeting an object, a low rise can reveal the space around a
speaker, a reframing move can follow the source's product arrival, or a restrained
arc can add parallax to a recorded release/reaction. Specify start/end images and
time; lock the camera when a crisp cut or comparison is clearer. Do not default
every shot to a static portrait, or animate every shot with the same slow push.
Never require the performer to move to achieve the camera's new framing.

Before paid submission, mentally play the actual sequence with source sound:
- At the central phrase/action, does the visible image express its meaning?
- If captions were hidden, would the important physical relation remain clear?
- Are camera stations visibly different, with foreground/depth and real scale
  contrast, or is this mostly the original image with crops?
- Does every cut add evidence, change attention or reveal a reaction? Remove
  redundant portraits, then use the freed time for a source-grounded insert.
- Does the ending visually resolve the recorded thought or action?
- Does each entry preserve the pose, hand ownership and prop state already in
  progress? Resolve uncertain action state from frames before generation.

Revise the shot list and final prompt together. `directorReview.status: "ready"`
requires concrete image-level answers and actual corrections, not "all passed".
Structure checks do not establish creative quality. Keep the strongest observable
compositions when translating the plan into the submitted prompt; do not soften
an object insert into a presenter holding a product or a side view into "slightly
oblique". Use explicit numeric time ranges in every submitted shot. The animate prompt
format still applies: `Shot N (duration s): [start–end s] ...`; duration is
end minus start and all durations sum to the requested output. Keep both fields
when converting the plan, rather than leaving the model to infer clock ranges.

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

Build one complete prompt with a neutral coverage title and source marker.
Start with the finished-take authority: this exact source is the immutable event
and motion clock; edit only its coverage. Then give the compact measured action
clock and timed camera shot list. Do not open with a new genre scene, a story
synopsis to enact, a makeover, "product beauty" posing or a weather/emotion
transformation. The narrative purpose explains the cut, never changes content. Describe
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
> repeated actions, slow motion, freezes, or duplicated objects. Keep the source
> words and voice character, with speech synchronized to the recorded mouth
> actions. These are virtual viewpoints; do not add visible cameras,
> tripods, filming equipment, or crew. Follow these contiguous shot ranges:
> [measured shot list].

Use the user's language for the script and explanations. Do not copy an
article's actor, location, dialogue, props, or action timestamps into a new take.
Optional source-derived stills may anchor identity/set; they cannot substitute
for the source video or create first-frame semantics.

## Submit through the supported product route

Respect the user's selected model. When none is specified, use Wan3 Standard
(`wan-3.0`) at 720p for this workflow; do not inherit the general Wan 1080p default.
"Wan 3"/"Wan3" means `wan-3.0` Standard; use `wan-3.0-prime` only when Prime
was selected. Respect the user's chosen resolution. Explicit FAL H3 Max
(`fal-h3-max`) requests use its supported default 768p unless the user chose
another supported resolution. The distinct
`minimax-h3-max` Turbo route cannot perform this workflow. H3 and Wan both use
feature-reference generation in Makaron, not a guaranteed immutable-pixel edit.
Read current capabilities; never silently substitute models. An explicitly
requested comparison permits one candidate for each selected model per take,
not retries or an added Seedance pass.

- Call `generate_animation` yourself with the complete self-reviewed prompt:
  `model` and `video_resolution` for the selected capable route,
  `video_intent: "generate"`, `video_operation: "generate"`, integer `duration`
  matching the selected source clock, and `output_format: "mp4"`. H3 permits
  5–15s; Wan permits 2–30s output, with reference-video seconds plus output
  seconds <=30. A 15s source plus 15s output fits exactly: probe the actual
  submitted file and retain its source clock during any deterministic repair.
- Put only the selected timeline source's `<<<media_N>>>` in `story_prompt`.
  For a workspace reference outside Media Index, pass its actual HTTPS URL as
  `video_ref_url`, `video_ref_type: "feature"`, and describe its source authority.
  Timeline video selection comes from that marker: omit `media_refs` and do not
  duplicate it in `video_ref_url`. This tool's `media_refs` accepts external image
  URLs, not numeric timeline indices; follow its current parameter contract.
  Do not include other timeline videos merely because they are available.
- Preserve source aspect within supported ratios. All selected source videos
  together must fit 15 seconds. Use the requested resolution when supported;
  480p is an explicit budget draft. A selected model's native default resolution
  is a single candidate, not authorization for a second quality pass.
- Omit unsupported `keep_original_sound`. Use the source video's sound as
  generation context. If a separate voice/performance reference is needed for a
  speaking source, extract a same-clock WAV and pass its HTTPS URL in `audio_refs`,
  identifying it as `<<<audio_1>>>` in the prompt. This is generation input, not
  a replacement soundtrack for the output. Use one concise recorded-speech
  contract; repeating dialogue in each shot can cause duplicate voices.
- Omit `completion_actions`. Deliver the model's picture and sound directly;
  do not add a continuation, post-generation QA task, audio replacement, or
  source/model assembly step.
- Show the script and submit when this request explicitly authorizes generation
  or a trusted template launch does. Selection alone does not grant paid work;
  reuse existing direct-submit authorization. One initial generation per take
  is the default budget; a failed candidate does not authorize endless retries.
- Persist source, both sequence options and director review, final plan/prompt paths, selected model, generation task identity,
  and requested deliverable before the async boundary. Record the returned
  task ID and resume that task, never submit another merely because it is slow.
For an explicitly requested model comparison, keep one selected source, one
measured content ledger and one reviewed camera plan. Submit the same complete
creative `story_prompt` and same source/audio references once per requested model;
only model-specific resolution/capability arguments vary. Do not rewrite the
coverage for each model, otherwise it is not a matched comparison. Save the
shared prompt and each model's task/snapshot identities in the plan. A failed
candidate from one model does not cancel the other authorized candidate.

## Deliver the generated video

Record each returned task/snapshot ID and let the normal video task complete in
Makaron's timeline. A pending task is still generating: report its state and
resume that same task when checking progress. A slow task does not authorize
another paid generation. For a comparison, track each selected model separately;
one provider's failure does not cancel another model's submitted task.

The model output is the final asset for this workflow. Do not remux source audio,
replace the ending with source footage, re-export an assembled MP4, or gate
availability on a follow-up review. Once completed, provide the playable native
video. Report the selected model, requested duration/resolution and any actual
provider error without claiming unmeasured dimensions or verified fidelity.
A later user request to review or revise is a separate request, not an automatic
completion task. Keep the user's generation budget; do not retry unchanged
prompts or silently switch models after a failure.

## Source

Workflow inspiration: [fal multi-angle article](https://fal.ai/learn/tools/how-to-create-multi-angle-video-seedance-2-5).
Its current [API schema](https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api)
describes fal, not Makaron's available provider route. Recheck product capabilities
when the route changes.
