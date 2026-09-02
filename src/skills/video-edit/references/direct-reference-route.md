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
for a separate replication mode, schema, or runtime prompt compiler. Include:

- the complete source video Media Index and measured duration;
- each source performer identified by appearance/costume **plus** an opening or
  distinctive action, mapped to one replacement identity Media Index;
- source and replacement environment anchors when scenery changes;
- timed actions, style direction, requested sound, and case-specific exclusions.

Unless the user explicitly asks for silence, leave model-native audio enabled
and describe sound naturally in `story_prompt`. Never identify a performer only
as "left fighter" or "right fighter" because screen direction may change.

Write the prompt in this order:

1. Define the reference video as motion/camera/timing/choreography authority.
2. Define each replacement image by stable identity and role. Do not map only by
   left/right position because screen direction may reverse.
3. State what must disappear from the source and what must remain structurally
   identical.
4. Describe action in source order with boundary/impact timing. Do not invent a
   new story, extra shot, slow-motion beat, camera path, costume, or character.
5. Require identity stability from first visible frame through the last; no
   morphing, blending, duplication, role swap, or transition back to source.
6. State background policy explicitly: preserve the reference environment, or
   replace it with the supplied environment while keeping reference geometry and
   camera relation.
7. Put the requested music, ambience, dialogue, or sound effects directly in the
   prompt. Set `generate_audio: false` only when the user explicitly asks for a
   silent result; do not add an automatic audio post-processing workflow.

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
