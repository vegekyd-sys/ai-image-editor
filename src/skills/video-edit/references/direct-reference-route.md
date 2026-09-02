# Direct Reference Replication

Use this route for a single short clip that fits one provider call and whose
whole-clip motion, camera, timing, choreography, or background should control the
result. This is the P0 proven by the CUI experiment; it is still supervised
generation, not deterministic pixel replacement.

When no model is selected explicitly by the user or app, use Wan 3.0 Prime at
its native default resolution for this route. Keep explicit provider,
resolution, latency, and cost requests authoritative; ordinary non-replication
video generation keeps its own default.

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

## Prompt Contract

After understanding the complete clip, call `generate_animation` once with both
an evidence-based `story_prompt` and `replication_contract`. This contract is an
internal deterministic tool input, not a second Skill, user mode, editor, or
state machine. The Agent supplies measured semantics; runtime owns the repeated
source-authority, identity, continuity, structure, and exclusion wording.

Populate:

- complete source video Media Index and measured duration;
- every replaced performer, identified by stable source appearance/costume plus
  an opening or distinctive action, mapped to one replacement Media Index and
  its exact identity, face, hair, body, clothing, colors, footwear, and
  accessories;
- every replaced object, identified by source state/action/handler, mapped to
  one replacement Media Index and its exact shape, material, color,
  construction, surface details, and distinctive features;
- replacement environment only when scenery changes; omission means preserve
  the visible source environment;
- requested style and clip-specific exclusions when they matter.

A whole-person replacement includes the supplied clothing unless the user
explicitly narrows it. Never infer that an occupation or story role requires
preserving the source uniform. Never map a role only as left/right/front/back;
subjects cross, turn, overlap, fall, and reverse screen direction.

Keep `story_prompt` focused on measured content the compiler cannot infer:

1. first line title;
2. every shot or continuous action phase in source order, with measured or
   best-evidence timing, framing/camera, opening state, preparation,
   anticipation, action, impact, recoil, recovery, crossing, transition, and
   ending hold;
3. requested music, ambience, dialogue, voice, and effects tied to visible
   beats; unless the user explicitly asks for silence, leave model-native audio
   enabled;
4. case-specific style or exceptions.

Do not paste generic source/identity/structure locks into `story_prompt`; the
compiler adds them deterministically. Immediately before submission, compare
the contract with `story_prompt`: no sentence may preserve or reintroduce a
source face, hair, body, garment, color, accessory, environment, or object
property controlled by replacement media. A conflict is a paid-submit blocker;
rewrite the free-form direction or correct the contract first. Do not add an
automatic audio post-processing workflow or infer exact source-track reuse.

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
