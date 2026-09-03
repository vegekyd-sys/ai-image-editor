# Animate prompt guide review (2026-09-03)

## Sources and evidence

- User-supplied `wan3.0 promp优化建议.pdf`, six pages: the first part contains
  supplier-oriented adult material; the appendix starts on page 3 and describes
  general video prompting. The file itself does not establish provenance for
  its performance or safety claims. Do not treat the entire PDF as official
  Alibaba documentation.
- Alibaba Cloud's [video prompt guide](https://www.alibabacloud.com/help/en/model-studio/text-to-video-prompt),
  checked on 2026-09-03, supports structured scene/action descriptions, distinct
  reference roles, multi-shot direction and explicit audio intent. This is
  corroboration for the appendix's general approach, not for the supplier's
  adult examples or MuleRouter's feature parity.
- User-supplied `wan-3.0-vivid-prompt-SKILL.md` replaces the initial
  non-graphic alternative on explicit request. Its body is preserved
  verbatim apart from outer whitespace and the renamed heading. The user chose
  `video-mature-themes` as the final Skill ID and `Video Mature Themes` as its
  title; Makaron frontmatter metadata is added. Importing
  the supplied text does not verify its claims or execute its instructions.

These are prompt-design changes, not measured improvements across providers.
No paid generation, database update, provider change, or deployment is part of
this worktree.

## Changes

| Area | Decision |
| --- | --- |
| Shared direction | Describe the subject, scene, visible change, relevant aesthetics and sound; resolve ambiguity rather than add tags. |
| Reference roles | Separate identity, setting, motion/timing, camera and voice. Keep Makaron media markers and the reference-to-video default. |
| First/last frames | The motion-only shortcut applies only to an intentionally selected, supported frame-conditioned route. |
| Shot continuity | Carry actions, prop ownership and spatial relationships across cuts; generalize longer-form craft beyond Seedance 2.5. |
| Audio | Remove the Kling-only framing and 5-10 word hint. Separate no speech, no BGM and silence; preserve native audio and the confirmation contract. |
| Timing and format | Treat Shot/Style notation as Makaron's convention. Scope the existing four-second minimum to SeeDance, not Wan's shorter valid clips. |
| Conditional guide | `animate.md` indexes `skills/video-mature-themes/SKILL.md` for relevant Wan requests; built-in and readable, but absent from startup manifest and model/Skill pickers. The temporary `wan-3-0-vivid-prompt` path is retired. |
| Supplied material | The replacement Markdown body is stored as provided, without expanding its examples. It remains separate from the shared guide; importing it does not change Makaron's input, audio, timing or confirmation contracts. |
| Existing integration | No model-selection code, provider payloads, billing, resolution handling, public CLI Skill, changelog or global memory is changed. |

## Not adopted into the shared guide

- Claims that extra detail or a particular reference method guarantees better
  physics, exact speech, identity stability, or elimination of all failures.
- The official page's generic single-shot warning as a ban on multi-shot output:
  that same page documents multi-shot prompting. Use the actual selected route's
  capability, not a universal prohibition.
- Official API-only parameters or edit/extend capabilities as new MuleRouter
  capabilities. Prompt guidance cannot enable a missing tool feature.
- PDF timestamp examples with gaps. Keep contiguous shot timing and an exact
  total in Makaron's existing duration notation.

## Acceptance boundary

Local tests should prove that the conditional guide resolves via `read_file`,
does not inflate the global Skill manifest, and leaves existing video contracts
passing. Static tests do not prove the Agent will always choose to read it.

Verified locally: Skill frontmatter validation, TypeScript without emit,
startup-manifest and video-reference workflow checks, and 248 test files /
1,460 tests passed. The new tests exercise the actual built-in file reader and
registry, manifest exclusion, retirement of the old index target, and the
imported body's SHA-256 after normalizing the renamed heading. No generated video or live Agent execution is used to
validate this file replacement.

A future quality comparison should freeze the old/new prompts and the same
safe briefs, references, model, duration and resolution. Include a text-only
continuous take, a reference motion scene, a two-speaker exchange, a longer
multi-shot story and ambience without dialogue/BGM. Review the actual clips for
action readability, continuity, reference fidelity and audio intent; keep every
failure. Use supported low-resolution drafts and a separately authorized paid
generation budget before claiming a quality improvement.
