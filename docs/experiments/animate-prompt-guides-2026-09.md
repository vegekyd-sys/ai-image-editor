# Animate prompt guide review (2026-09-03)

## Final release scope

After the comparison, the shared prompt rewrite was withdrawn. The final change
preserves the existing `animate.md` wording and adds only the conditional
`video-mature-themes` read entry plus the supplied built-in Skill. The prompt
policy test changes were reverted and the experimental guide test was removed.
The implementation and comparison notes below describe the earlier experiment;
they are not claims about the final release's shared prompt behavior.

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
The initial implementation involved no paid generation, database update,
provider change, or deployment. The separately authorized CLI comparison below
records the subsequent live test, including its failures.

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

## Live CLI comparison and local subscription check (2026-09-03)

The user requested ordinary conversational prompts, 15 seconds, 480p, and then
explicitly selected SeeDance 2.0 Fast to limit cost. No adult content was tested.
Local Next runs from the fixed runner at commit `7626bec0`; Production was not
redeployed. Both successful submissions used the same Grok 4.6 Agent and the
same Chinese brief: a rainy cafe, a clerk handing coffee to a customer, two
specified spoken lines, rain and cup sounds, no subtitles or background music.

| Arm | Project | Agent run | Provider task | Outcome |
| --- | --- | --- | --- | --- |
| Production | `593acbb8-d1f1-4c09-8c1e-d0b2a03f6d27` | `a964a5c7-b57b-46a1-b737-6b47dc303211` | `task-unified-1788412346-g864ltio` | Failed; provider reported possible copyrighted or trademarked content. |
| Modified local | `1d35eb3d-4cb6-44bb-b0fd-920456768116` | `707d3278-3fdd-4356-a6ed-7734bbedda06` | `task-unified-1788412350-8lqapyog` | Failed with the same provider message. |

Each event log contains one `read_file('prompts/animate.md')` and one
`generate_animation` call with `model=seedance-fast`, `video_resolution=480p`,
`duration=15`, and `aspect_ratio=16:9`. Neither loaded the conditional guide,
generated an intermediate image, or retried the paid render. Both scripts have
four shots totaling 15 seconds. The modified script adds a shared scene setup,
explicitly carries the same cup between shots, and describes walking to and
sitting at the table. These are script observations, not proven image/audio
quality gains: neither arm returned a playable video. The provider message does
not establish that the brief actually infringes anything; the trigger is unknown.

An earlier Terra/standard-model pair never reached video-provider submission:
tool calls filled an unrelated `replication_contract` with placeholder media
indices despite having no source media, and failed media-reference validation.
This happened with both guides and is separate from the Fast provider rejection.
No submission-layer correction was implemented as part of this prompt test.

The local server initially lacked all four `GROK_SUBSCRIPTION_*` relay/owner/
allowlist settings. The same account reported `grokAvailable=false` locally
and `true` in Production, with 78% remaining. After explicit user approval, only
the existing Preview Grok settings were copied into the gitignored local env;
unrelated settings and all remote environments were preserved. A server restart
was necessary because the shared env symlink did not reload in the running
process. Local usage then returned available with 78% remaining. CLI run
`714c47a7-9f4e-4d25-b3a7-35f7e5713ace` completed with
`GROK_SUBSCRIPTION_OK`; runtime logs confirmed `provider=grok-subscription`
rather than OpenRouter fallback. No credentials are included in this report.

### Continued acceptance after user requested completion

All test inputs were text-only, with no uploaded reference image. Supplier
copyright/trademark messages describe the generated output; no rejected output
was returned, so the exact triggering feature remains unknown. The user asked
to continue until actual media could be reviewed.

The second paired casual brief was two ordinary adult friends watering mint
on a home balcony. Both arms used Grok personal subscription Agent, SeeDance
Fast, 480p, 15s, 16:9. Production run
`3c1fe98e-2239-4875-907e-4b6a0e9c97ca` was rejected; an explicitly rewritten
unbranded-scene retry `dddb9711-842f-41ce-a5cb-25ace2c2ae1f` was also rejected.
The retry has additional conversation context and is not a clean paired sample.

Modified run `e2653e70-31bf-4249-a269-71eeecbfcbe2` completed:

- Project: `00f343ec-f28b-4863-bb2d-5c42c2158b3e`.
- Task: `task-unified-1788412796-q685jofk`.
- Snapshot: `47729c8f-fa8c-4664-9714-dc3108f041ec`.
- CLI first observed completion after approximately 136s of provider rendering.
- Original downloaded MP4: 864x496, H.264, 24fps, AAC audio, 15.104s container
  duration, 3,841,961 bytes; full FFmpeg decode succeeded.
- Frame inspection shows watering, smelling leaves, putting the can on the
  balcony ledge and a closing smile. The prop remains consistent; the model
  changes the scripted final placement from floor to ledge.
- Local Whisper transcribed both intended lines, with a homophone recognition
  error for mint. Separate audiovisual review through OpenRouter Gemini Flash
  confirmed the woman says `这盆薄荷长得真快。` and the man says
  `晚上泡杯茶吧。`, with water and birds, no subtitles/narration/visible logos.
- Important failure: audiovisual review detected soft piano/string background
  music despite the explicit no-music request. This is not full intent
  compliance. Do not edit the audio to conceal this in the comparison.

The built-in remote video analysis path failed with Google
`FAILED_PRECONDITION: User location is not supported for the API use` through
both the connector and local MCP route. This is a separate QA-tool failure,
not a failure of the completed video. Local FFmpeg/Whisper and one separate
OpenRouter audiovisual analysis were used without changing application routes.
The latter reported $0.0026685. Its video-input format follows the
[OpenRouter video-input documentation](https://openrouter.ai/docs/guides/overview/multimodal/videos).

Raw run/event evidence, original media, contact sheets and review JSON are in
the gitignored `.artifacts/animate-ab-2026-09-03/` directory. No provider code,
global prompt, deployment, or content-filter toggle was changed by this test.

### Completed paired cat sample

To obtain a complete playable pair, the same everyday-language text-only brief
was submitted to both guides: an ordinary orange cat sunbathing by a window,
waking at birdsong, stretching, and tapping a wooden ball. No image was used.
Both used the same personal Grok Agent and `seedance-fast / 480p / 15s / 16:9`.

| Arm | Project | Run | Task | Observed render wait |
| --- | --- | --- | --- | --- |
| Production | `35bd56c2-94d9-48d2-b427-3b621ef77b0a` | `63c11714-3d4a-40e1-80c7-4e37590c357a` | `task-unified-1788413320-9v9cj8zb` | ~181s |
| Modified | `2c64bae9-b047-4560-a7d6-9531cc9f93a6` | `4fb4fde8-1a64-47e7-86ed-cbd491aeb464` | `task-unified-1788413360-8wtyyrzq` | ~200s |

Both traces show the correct `prompts/animate.md` read and one video submission,
with no extra image generation or conditional mature guide. Both original
MP4s fully decode and contain 864x496 H.264 at 24fps plus AAC audio, with
15.104s container duration. Files are `production-cat.mp4` (4,115,171 bytes)
and `modified-cat.mp4` (4,011,643 bytes) in the artifact directory.

Observed comparison:

- Production writes four shots (4+3+4+4 seconds); the result cuts between wider
  and closer views, with the cat moving from lying to standing and sitting.
- Modified writes one continuous take; the result holds the same view and
  follows the wake/stretch/ball action in one spatially continuous sequence.
- Both show the intended cat/ball action and no visible subtitles, brands or
  watermarks. Independent audiovisual review finds birdsong and wooden-ball
  sounds, no dialogue/narration or background music, and no abrupt ending.
- The modified cat's open mouth has some artificial-looking interior detail;
  the static background and tail also limit naturalism. The baseline has a
  noticeable shot transition from lying to standing. These are different
  tradeoffs, not evidence that the new guide universally improves video quality.

Three completed originals are available for review: the two cat clips and the
modified balcony dialogue clip. The balcony clip's unwanted music remains an
explicit failed requirement. All rejected attempts are retained in the report;
there is no clean claim that prompt changes caused better moderation outcomes.
No more video tasks remain running from this comparison.
