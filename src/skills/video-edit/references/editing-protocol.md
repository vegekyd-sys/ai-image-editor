# Video Editing Protocol

Use this reference after `skills/video-edit/SKILL.md`. It separates editing
intent from provider implementation so one CUI workflow can use deterministic,
composition, and generative tools without exposing backend modes to the user.

## 1. Change/Preserve Contract

Before tools, reduce the request to:

```json
{
  "base_video": "<<<media_1>>>",
  "change": ["replace the red car with the supplied blue car"],
  "preserve": ["duration", "camera", "performance", "background", "audio"],
  "range": { "start_sec": 0, "end_sec": 8.2 },
  "delivery": { "editable": false, "keep_original_sound": true }
}
```

Unspecified dimensions belong in `preserve`. If the user asks to change almost
everything while retaining shot grammar, return to `video-edit/SKILL.md` and
choose its `replication` profile.

## 2. Tool Decision Table

| Edit class | Primary path | Model judgment |
| --- | --- | --- |
| trim, remove, reorder, speed, crop, resize, transcode | FFmpeg | choose ranges only when language/visual meaning matters |
| dialogue-led cut | transcript then FFmpeg/Remotion | select semantic ranges; execute timecodes deterministically |
| captions, titles, overlays, picture-in-picture | Remotion | decide layout/taste; render timing deterministically |
| subject, object, outfit, material, background, weather, VFX replacement | reference-to-video | describe change/preserve constraints and inspect visual fidelity |
| one bad moment | locate frame/range, generate patch, deterministic replace | identify fault and judge continuity |
| forward/backward continuation | provider extend | describe only the new beat; do not treat as an edit |

Do not invoke generation for an exact operation FFmpeg can complete without
inventing pixels. Do not force FFmpeg to solve semantic pixel replacement.

## 3. Generative Source Editing

- Put the base video and every replacement reference in the same request.
- Define every reference by role before describing action. Map identity by role
  and appearance, not only by left/right position.
- State the invariant sentence explicitly: preserve original camera path,
  choreography, timing, framing, cuts, background, and sound except for the
  named replacement.
- Seedance source edits use reference-to-video semantics. Do not expose or set a
  Seedance `edit` mode merely because the user said “编辑”; the Skill owns the
  intent, while the video is a motion/camera/content reference. Seedance 2.5 may
  use provider-managed duration (`duration: -1`) for full-source repainting.
- Typed `edit` may remain an internal compatibility path for another provider
  only when its verified contract requires it. It is never a user-facing mode.
- Keep original audio only when the provider/runtime can do so reliably;
  otherwise restore the probed source audio deterministically after generation.

## 4. Locality and Continuity

For a local repair, record `replaceStart`, `replaceEnd`, and
`replacementDuration`. Give the model at least one identity/context anchor from
both sides when available. Trim or retime the patch to the exact replacement
range before assembly. Inspect the frame before the seam, the seam, and the frame
after it; never accept a patch from its middle frame alone.

## 5. Acceptance Gates

Always require:

- output is a decodable MP4/MOV with expected video/audio streams;
- duration is within one frame for deterministic edits, or within the agreed
  provider tolerance for generative edits;
- requested change is visible for the required range;
- preserved identity/background/action/camera/audio do not drift materially;
- first and last frames do not morph into a different subject;
- local-edit seams do not jump in pose, lighting, scale, or sound.

One provider success is evidence of completion, not evidence of acceptance.
