# Direct Reference Replication

Use this route for a single short clip that fits one provider call and whose
whole-clip motion, camera, timing, choreography, or background should control the
result. This is the P0 proven by the CUI experiment; it is still supervised
generation, not deterministic pixel replacement.

## Input Checklist

Identify the reference video, each replacement image and its role, what should
stay structurally the same, and what should change. Keep this in the Agent's
working notes and final prompt; do not create another runtime object for it.

If the original video itself must remain visible underneath the change, route
to `video-edit`. If the user wants only mood/style inspiration, route to
`reference-video-studio`.

## Compact Blueprint

Before submission, record at minimum:

- source duration/aspect/FPS and audio presence;
- shot count/order and boundary times, including uncertainty;
- for each shot: framing, camera path, subject action/choreography, screen
  direction, transition, caption range, and beat/impact time;
- replacement role map and explicit preserved layers;
- top three acceptance priorities.

Use the full schema when the candidate boundary detector finds multiple shots,
confidence is low, captions/audio carry meaning, or the user requests an
editable result.

## One-Prompt Protocol

After understanding the complete clip, call `generate_animation` once with one
complete, natural `story_prompt`. The Skill is the implementation: do not look
for a separate replication mode, schema, or runtime prompt compiler. Do not
optimize this prompt for brevity: keep every measured fact that helps the model
reproduce the source. Write the following prompt spine in this order and adapt
it to the actual clip rather than pasting generic filler.

### 1. Source Authority

Name the complete reference-video Media Index and measured duration. State that
it is the sole temporal performance, edit, composition, and camera authority
from the first visible frame through the final held state. Require the same:

- shot count/order, cut points, shot durations, and transitions;
- camera path, lens perspective, framing changes, horizon, subject scale, and
  screen direction;
- performer/object spacing, floor contact, depth, and travel direction;
- action/choreography, body and object trajectories, gestures, contacts,
  impacts, reactions, pauses, motion blur, and outcome.

Replacement media controls only the layers the user asked to replace. It must
not rewrite the reference action, timing, camera, editing, or result.

### 2. Role and Object Mapping

For every replaced person or object, identify the source role by stable visible
evidence plus an opening or distinctive action. Then bind it to one replacement
Media Index and describe the traits that must stay stable. A person replacement
normally includes face, hair, body, clothing, colors, and accessories from the
supplied image unless the user narrows the change. An object replacement must
retain the supplied shape, material, color, and distinctive details throughout
its complete state progression.

Never map a role only as "left/right/front/back": subjects cross, turn, overlap,
fall, and reverse screen direction. Track them through identity plus action.

### 3. Identity, Causality, and Continuity Lock

Require replacement identities and objects to remain stable during profiles,
rear views, fast motion, overlap, partial occlusion, contact, falls, smoke, and
motion blur. Preserve who initiates and receives each action, who interacts with
each object, who wins or loses, every travel direction, and the exact final
poses/object state.

Explicitly prohibit morphing, blending, duplication, costume drift, role swap,
transition back to the source subject, and reference-sheet/contact-sheet leakage.

### 4. Environment Policy

Say explicitly whether the source environment stays or is replaced. If it is
replaced, remove conflicting source architecture, decoration, signage, props,
lighting motifs, and scenery while preserving camera geometry, subject spacing,
floor contact, depth, lens perspective, and lighting continuity. If it stays,
name the visible background anchors that must survive every shot.

### 5. Timed Shot Reconstruction

Describe every shot in source order with measured or best-evidence duration.
Include its opening pose/state, preparation, anticipation, action, impact,
recoil, recovery, crossing, transition, and ending hold. Name important boundary
and impact times. Preserve the original camera-to-subject relationship after
replacement. Do not beautify, simplify, reinterpret, extend, shorten, or turn
the clip into a merely similar new scene.

### 6. Sound and Style

Unless the user explicitly asks for silence, leave model-native audio enabled
and describe requested music, ambience, dialogue, voice, and effects naturally
in `story_prompt`, tied to visible beats where relevant. Do not add automatic
audio post-processing. Describe style without allowing it to override timing,
identity, physical coherence, or the source outcome.

### 7. Hard Exclusions and Final Priority

End with clip-specific exclusions plus all relevant invariants: no new or
omitted shots/actions/impacts/reactions/pauses; no different opening or ending;
no invented camera angle, lens, zoom, pan, tilt, dolly, orbit, or handheld
motion; no slow motion, speed ramp, freeze, montage, or time remapping unless it
exists in the source; and no invented props, people, text, logos, effects, or
story events.

Finish by telling the model this is a structural repaint of the supplied video,
not a newly staged scene inspired by it. Exact temporal fidelity has higher
priority than novelty or visual embellishment.

## Complete-Understanding Gate

Do not submit a paid replication when complete-video understanding failed. If
`analyze_video` errors or does not expose opening actions, crossings, impacts,
and the final state, call raw-video `preview_frame` once with 4-6 representative
`timestamps` and inspect the returned contact sheet. If neither source provides
those temporal facts, stop before `generate_animation` and report the blocker.

For Seedance, submit the clip and replacement references through
reference-to-video. Do not set `video_operation: "edit"`. Seedance 2.5 may use
`duration: -1` so provider-managed output follows the full reference duration;
Seedance 2.0 uses a supported explicit duration matching the source as closely
as possible.

## Deterministic Provider-Input Repair

Before the first paid submission, inspect known reference dimensions. If a
Seedance image is below the provider minimum, resize/pad the supplied pixels
with `run_code({ runtime: "node", media_refs: [...] })`, save each result with
`saveOutput`, then publish those workspace image outputs once with
`write_file({ fromWorkspaceOutputs: true, mediaType: "image", limit: N,
publish: true })`. Use the newly returned Media Index items in the final script.

This is transport preparation, not creative regeneration. Never call
`generate_image` merely to increase dimensions, convert format, or add padding;
that changes identity and adds avoidable cost. Preserve aspect ratio and all
source pixels. A robust Node return shape is:

```js
const saved = await saveOutput(out, workspacePath, 'image/png');
outputs.push({ ...saved, path: out, contentType: 'image/png', description });
return { type: 'files', outputs };
```

If deterministic preparation cannot produce a new public URL, stop before any
video submission and report the input blocker. Do not fall back to image
generation.

## QA and Correction

Run the shared similarity gates. For a first P0 comparison, prioritize:

1. all replacement roles remain correct and stable;
2. shot count/order and action sequence match;
3. camera/framing and contact/impact timing match;
4. requested background policy is honored;
5. output duration, requested audio presence/sync, and decodability pass.

The correction prompt must name one or two measured failures. If one attempt
preserves characters but misses camera, and another preserves camera but misses
background, report that tradeoff; do not average it into a false success claim.
