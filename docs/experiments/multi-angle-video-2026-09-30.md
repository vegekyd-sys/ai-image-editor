# Multi-angle product skill: real model comparison

Tested 2026-09-30 on branch `codex/multi-angle-video` using Makaron CLI,
the user's authorized account, and the candidate local API. No deployment.

## Protocol

- Source: https://x.com/influencer_seo/status/2104983795854434684/video/1
- The supplied video is already a stacked original/AI comparison. Only the top
  original shot was used: first 15.000 seconds, 1280×720, 24 fps, original audio.
- The product skill analyzed that prepared source, persisted source ASR and
  action anchors, and produced a contiguous six-shot coverage plan. Both models
  received the identical prepared source and 993-character story prompt.
- Source-frame anchors are approximate (about ±0.25 seconds), not framewise
  motion ground truth. Regional video-understanding access failed; actual frames
  and FFmpeg probing were used instead.
- Completed outputs were downloaded, fully decoded, sampled at 2 fps, checked
  for hard-cut candidates, and separately transcribed once. ASR boundaries are
  speech-timing evidence, not proof of lip synchronization or untouched audio.
- Native outputs were imported into the user's project. H3 also has a local
  15.000-second presentation copy trimming only its trailing 0.104 seconds,
  retaining generated sound (audio re-encoded). The original remains intact.
- A muted three-panel comparison covers the common first 14.708333 seconds,
  without freezing, stretching, or padding the shorter Seedance result.

## Observed results

| Model | Native output | Cut candidates (seconds) | Speech QA | Material failures |
| --- | --- | --- | --- | --- |
| Seedance 2.5, Evolink reference-to-video | 1280×720; video 14.708333s, audio/container 14.720s | 4.208, 5.875, 8.542, 12.167 | Same recognized dialogue; utterance start/end differences 0.01–0.02s | Visible invented camera in shoulder view; missing source tail; planned six-shot timing not followed |
| FAL H3 Max, video reference | 1344×768; video 15.083333s, audio/container 15.104s | 2.417, 5.083, 7.375, 9.042, 11.042 | Same recognized dialogue; second utterance about 1.0–1.1s early | Invented background window; redirected eyeline; performance/cut timing drift |

Both are generated, playable candidates. Neither passed the skill's complete
source-clock/scene-preservation acceptance. No original-audio swap was used to
hide drift. Seedance is the more promising default for preserving speech timing
in this sample; this single case does not establish universal model superiority.

## Runtime defect and correction

The first Seedance request used explicit duration 15, which the provider rejected
as an editing-style reference request requiring `duration=-1` and adaptive ratio.
The corrected second request still failed because MCP billing changed `-1` to
five seconds, which then caused a 16:9 ratio. Both failures were fully refunded.

The fix preserves the source-following provider sentinel while quoting measured
source seconds. A regression first reproduced the incorrect five-second quote,
then verified a 15-second quote and the actual provider request body containing
`duration=-1`, `aspect_ratio=adaptive`. Existing smart defaults remain unchanged.
The third Seedance submission completed successfully after this correction.

Validation: 7 Seedance integration tests, 18 related pricing/billing tests,
targeted ESLint, startup-manifest contract, reference-workflow contract, and
`git diff --check` passed. Earlier skill selector checks covered four locales
and desktop/mobile layouts.

The skill now explicitly prohibits materializing virtual camera positions as
visible cameras, tripods, filming equipment, or crew. That prompt correction has
not received a new paid generation; the reported outputs precede it.

## Receipts

- Planning run: `e91608db-2120-4535-bf79-cdbf4b908f60`.
- H3 task: `fal-h3max-reference-01a0f2c1-90d3-7403-94e1-0812d08218d4`.
- Successful Seedance task: `task-unified-1790780032-30ru1zin`.
- Native audio QA runs: H3 `eeceffcf-4580-44f1-be09-3117b215a5d9`,
  Seedance `5b0d683c-2be3-4e51-960f-d324e382bb81`.
- Charged: H3 672 credits, successful Seedance 975 credits; net 1,647 credits.
  Failed charges 975 and 325 were each refunded in the usage ledger.
- Local evidence directory:
  `/Users/tianyicai/Documents/Codex/2026-09-30/multi-angle-video-test/`.
  Contains submitted source/prompt/plan, native videos, ffprobe/ASR QA, CLI
  receipts, decoded contact sheets, and `comparison-muted.mp4`.

Workflow inspiration: https://fal.ai/learn/tools/how-to-create-multi-angle-video-seedance-2-5

## Round 2: narrative and scale revision

The user rejected the first round's weak shot language. The reference's lower
AI panel was isolated for comparison: its first 15 seconds contain faces,
object inserts, computer viewpoint, courtyard scale, and a low action angle.
This exposed a planning problem, not evidence that either model cannot direct
such coverage. The first plan overused adjacent medium views and discouraged
motivated tight details and elevated/lower viewpoints.

The revised skill finds an observed micro-story before angles, assigns a purpose
to every shot, requires useful contrasts in scale/viewpoint/foreground, allows
source dialogue over detail inserts, and independently checks creative quality
and source fidelity. It permits restrained inferred geometry while preserving
confirmed landmarks. A long source checklist now follows a concise shot list,
instead of dominating the prompt. None of this test actor's objects or timings
are embedded as instructions in the reusable skill.

The actual product Agent planned ten shots around the source's small emotional
arc: inbox frustration, a drinking pause, attention returning to the courtyard,
then the apple gesture and reaction. Director review shortened the executable
prompt to 1,644 characters and corrected two source-state errors: the apple is
already held at 10.69s, and denser source frames support the real apple-to-mouth,
bite, and subsequent reaction instead of prohibiting that recorded ending.
Both models received this identical revised prompt and the unchanged 15s source.

Observed improvements in both decoded contact sheets: a wider opening, tight
face coverage, keyboard detail from above, foreground computer composition,
low/table-level cup coverage, wider spatial relief, low apple-motion coverage,
and a close ending. The visible camera from Seedance round 1 was absent in these
round-2 samples. The result is substantially more varied than the first round's
medium-view coverage. Shot-count detection includes false positives around fast
apple motion; it is not the creative acceptance criterion.

| Native output | Stream duration | Single-ASR comparison |
| --- | --- | --- |
| Seedance 2.5, 1280×720 | picture 14.708333s; audio/container 14.720s | Same recognized dialogue; first utterance start/end −0.01s, second +0.01s |
| FAL H3 Max, 1344×768 | picture 15.083333s; audio/container 15.104s | First start/end +0.13/−0.03s; second −0.10/−0.22s; one `open`/`opened` ASR difference, not confirmed as a spoken-word change |

H3's speech drift improved materially from round 1. Neither native result proves
framewise performance fidelity; ASR agreement is not lip/gesture synchronization.
The Seedance native still truncates the source tail. These are separate remaining
issues from the demonstrated narrative/scale improvement.

### Finished 15-second candidates

- `narrative-v2-seedance-final-15s.mp4`: 1280×720, 24fps, 360 frames;
  video, audio, and container exactly 15.000s. Uses native Seedance for
  0–12.875s and the prepared source's actual 12.875–15s closing shot, cropped
  480×270 at (332,96) and scaled to 1280×720. This deliberately replaces the
  entire close ending, retaining the real recorded bite/reaction. It is a hybrid
  edit, not a native 15s model output. Earlier generated motion remains subject
  to fidelity review. No source ending was stretched/frozen or synthesized.
- The Seedance final uses the prepared source AAC stream unchanged; audio packet
  MD5 matches the source (`858557c9b36f702abaf07a5d9eefc83a`).
- A preliminary hybrid used the higher-resolution X source directly, with a
  one-frame timing difference. The recommended final uses the same prepared
  source clock and constant 24fps instead; the preliminary is retained as evidence.
- `narrative-v2-h3-15s.mp4`: trims the H3 native trailing picture/audio to
  15.000s; retains generated sound with AAC re-encoding. Its source-timing
  differences remain visible/recorded, not hidden by an original-audio swap.
- `narrative-v2-comparison-muted.mp4`: synchronized 15s panels of the reference,
  final Seedance hybrid, and H3 second version. It is muted so shared sound cannot
  imply that either native soundtrack is identical to the source.
- Both native candidates and finished edits were persisted in the user's project.
  Final full playback/taste acceptance and framewise fidelity remain distinct
  from this documented creative improvement. No production deployment occurred.

Validation: full FFmpeg decode of native outputs, finished clips and comparison;
duration/frame/audio-stream checks; source audio packet hash; source/output frame
sampling and one ASR per native; 31 related integration/startup/i18n tests;
skill validation, UI i18n guard, startup/reference contracts and diff checks.

Receipts: planning `6a40d185-ead8-4c4b-9f90-35d8515c9eb8`, prompt review
`f85960e9-16f9-4d3a-a111-4240aded1f6f`, Seedance
`task-unified-1790781921-6h9riyzn`, H3
`fal-h3max-reference-01a0f2ec-1f19-73e3-ad7f-9aabb9d3f005`.
Cloud file recovery/persistence and Seedance ASR:
`7aab09ac-10a1-451d-b8a8-84c6bb8da647`; H3 ASR:
`18c48333-f8ef-48c0-9961-1a81e25d52d9`. Recovery fetched the completed file;
no new generation was submitted for the CDN download problem.
Round-2 charges: Seedance 975, H3 672; 1,647 credits this round, 3,294 total
across both successful rounds. Planning, persistence, and ASR Agent runs used
the subscription path with zero additional charged credits.

## Speech meaning correction (2026-10-01)

The user clarified that the goal is correcting the reusable product skill.
Round 2's visual variety did not sufficiently express what the speaker was
saying. Speech windows alone constrain synchronization; they do not direct
attention, shot size, or the timing of a rhetorical turn.

Production CLI `analyze --video` now completed for the same prepared original
take (reported model `gemini-3.8-flash`). Its combined audio/visual report
identified frustration, a pause, a rhetorical reversal, and the surroundings
as relief. Some estimated action times contradict the previously decoded
source: for example, it grouped the apple throw into the spoken courtyard line.
Treat that report as interpretive evidence, reconcile phrase times with the
persisted source ASR, and retain measured frames as action-clock authority.
This success does not establish the cause of the earlier regional API failure.

The revised skill analyzes dialogue and visible performance before angles,
persists phrase-level `meaningBeats`, links shots to them, and requires a reason
for the framing/hold at that specific thought. It separates literal speech,
interpretation, and visible events; mentioning an action cannot create one.
It favors a meaningful change of visual emphasis at a measured thought boundary
without cutting to every noun or imposing a fixed close/detail/wide recipe.
Generation prompts carry each important phrase's visual purpose. Final QA
compares actual cuts with the spoken turn/payoff and rejects disconnected
coverage even when shot variety and synchronization are otherwise good.

None of this source's dialogue, props, or timestamps are hardcoded in the skill.
Local structural validation and the manifest loading contract passed; these do
not establish acceptance of a newly generated video. No new paid video pass
was submitted for this correction.

Behavioral planning run `9cdc1628-9b2c-4717-a54d-869924148eb5` loaded the
candidate skill and existing ASR through the real product Agent. It kept the
rhetorical turn on the face and assigned the following courtyard phrase a
spatial reveal. Review run `2427bd22-1b60-40ff-97e1-b7db96789e2e` corrected
conflicting pickup/throw instructions. Developer review then clarified the
opening and ending framing of its moving reveal shot: starting the action
coverage earlier must not make the surroundings the visual emphasis too soon.
The skill now explicitly preserves semantic emphasis when repairing continuity,
including framing changes within a shot. Both Agent runs completed, charged
zero credits on the subscription route, and submitted no video generation.

Reviewed local plan: `semantic-v3-plan-reviewed.json` in the evidence directory.
Clock coverage and shot-to-meaning references were checked. Skill validation,
startup contract, three startup tests, and diff checks passed. This establishes
the revised planning workflow, not generated-video or model-execution acceptance.
