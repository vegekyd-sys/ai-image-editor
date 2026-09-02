# Direct Reference Replication

Use this route for a single short clip that fits one provider call and whose
whole-clip motion, camera, timing, choreography, or background should control the
result. This is the P0 proven by the CUI experiment; it is still supervised
generation, not deterministic pixel replacement.

## Input Contract

```json
{
  "reference_video": "<<<media_1>>>",
  "replacements": [
    { "media": "<<<media_2>>>", "role": "fighter A" },
    { "media": "<<<media_3>>>", "role": "fighter B" },
    { "media": "<<<media_4>>>", "role": "dojo background" }
  ],
  "preserve": [
    "shot order and duration",
    "camera path and framing",
    "choreography and contact timing",
    "transition and beat structure"
  ],
  "replace": ["fighter identities", "environment"],
  "audio_policy": "preserve-source-structure"
}
```

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

## Prompt Contract

The script must begin with role mapping, then an invariant, then timed action:

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
7. Put music/ambience/SFX structure in the prompt only when native audio should
   be regenerated. If exact source sound must survive, restore it after the
   visual result instead of trusting synthesis.

For Seedance, submit the clip and replacement references through
reference-to-video. Do not set `video_operation: "edit"`. Seedance 2.5 may use
`duration: -1` so provider-managed output follows the full reference duration;
Seedance 2.0 uses a supported explicit duration matching the source as closely
as possible.

## QA and Correction

Run the shared similarity gates. For a first P0 comparison, prioritize:

1. all replacement roles remain correct and stable;
2. shot count/order and action sequence match;
3. camera/framing and contact/impact timing match;
4. requested background policy is honored;
5. output duration, audio policy, and decodability pass.

The correction prompt must name one or two measured failures. If one attempt
preserves characters but misses camera, and another preserves camera but misses
background, report that tradeoff; do not average it into a false success claim.
