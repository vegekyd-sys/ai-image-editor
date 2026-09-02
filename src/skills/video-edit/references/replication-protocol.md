# Replication Profile

Use this profile when the reference video is the structural authority and the
user wants its content replaced. The goal is observable shot-grammar fidelity,
not pixel identity or a vague "similar feeling".

## Required References

1. `skills/video-edit/references/shot-blueprint.md`
2. `skills/video-edit/references/direct-reference-route.md`
3. `skills/video-edit/references/similarity-qa.md`
4. `skills/video-ffmpeg-lab/SKILL.md` for deterministic inspection and files
5. Shared Studio production and Remotion contracts only for structured/editable
   execution

## Protocol

1. **Resolve scope and rights.** Identify one exact reference, replacement role
   map, preserve/change layers, delivery duration/aspect/resolution, captions,
   and requested sound. Probe the exact file. Get permission before sending
   private references to third-party models; otherwise stay local.
2. **Understand the complete clip.** Extract deterministic file truth, candidate
   boundaries, frames, audio envelope, and beat candidates. Transcribe only when
   speech timing matters. Use a multimodal model to label composition,
   choreography, camera, text/style, and uncertain boundaries. If
   `analyze_video` fails or lacks opening/action/impact/ending evidence, call
   raw-video `preview_frame` once with 4-6 representative timestamps. If both
   routes fail to reveal the temporal evidence, stop before paid generation. Do
   not confuse a prose summary with measured evidence.
3. **Lock Video DNA.** Write a Shot Blueprint with source ranges, confidence,
   evidence, preserve/replace fields, and acceptance priorities. A short
   continuous clip may use a compact Blueprint; multi-shot, low-confidence, or
   editable work uses the full schema and Studio artifacts.
4. **Choose one execution route.** Use direct reference replication for one
   provider-sized clip when whole-clip motion/camera/choreography should transfer
   in one call. Otherwise choose A = deterministic re-edit of supplied
   replacements, B = per-shot generation, or C = hybrid; prefer A, then C, then
   B. Kling Motion Control is only for supported single-person continuous action,
   not a general multi-person or multi-shot route.
5. **Gate generation.** For structured work, prove one representative 4-5
   second shot before a batch. For a direct short clip, one complete attempt is
   the representative proof. Allow one evidence-driven correction; more paid
   work needs approval.
6. **Generate or map content.** For direct structural replication, pass the
   measured identity/object/environment mappings in
   `generate_animation.replication_contract`; put timed shots/actions and
   natural sound direction in `story_prompt`. Runtime deterministically expands
   the fragile invariant wording. This is an internal tool contract under the
   same Skill, not a second product workflow. Seedance uses reference-to-video,
   never typed edit.
7. **Assemble only when needed.** A direct reference result may remain one
   provider output after QA. Structured routes put pixels into one editable
   Remotion composition; the Blueprint stays the master clock. Do not add a
   separate audio post-production path unless the user explicitly requests one.
8. **Measure and repair.** Compare boundaries/order/durations, framing, camera
   and subject motion, transitions, captions, beat alignment, color/style, role
   identity, and final decodability. Repair the smallest failing layer; never
   regenerate working layers by default.

Do not promise perfect replication. Models may drift on exact trajectories,
occluded identity, fine contact physics, typography, and stochastic pixels; the
QA report must expose those residuals rather than average them into success.
