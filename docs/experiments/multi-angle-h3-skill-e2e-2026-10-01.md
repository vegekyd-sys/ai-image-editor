# Four H3 Max tests through selected multi-angle Skill

Candidate branch: `codex/multi-angle-video`; local application on 127.0.0.1:3048.
No merge or production deployment. Existing owner account and paid test authority
were reused. Four native generations completed; no Seedance generation or paid
video retry was made in this round. This replaces the previous experiment's
manual storyboard review + direct video-create method with actual selected-Skill
Chat submissions. It does not certify all four generated performances.

## Test inputs and runs

All inputs are the existing prepared 15s continuous excerpts, without importing
the earlier human-reviewed prompts into the new projects. The same user request
selected `multi-angle-video`, requested H3 Max 768p and original sound, directly
authorized generation and automatic completion, and limited each take to one
paid native submission. Agent LLM used the account's automatic Codex Luna route.

| Take | Source/excerpt | Project | Initial Chat run |
| --- | --- | --- | --- |
| Courtyard | influencer_seo/2104983795854434684; prepared original 0–15s | 2687f3c2-c969-42b1-99c5-0eb8cadc829c | d5d22e4c-c25f-4c69-973f-453bc2ccf8c3 |
| Product | jasonugc/2105203608010756379; original 14.20–29.20s | af85e5f3-0a21-4200-bf62-3118fa0a2137 | b161a2cd-7434-41e8-b450-3c3ebc015401 |
| Solo golf | KraftyGolf_/2093005980002869343; 0–15s | e75d1c9a-ba90-4047-9194-7afe05d21e4d | 35ea629f-1b7c-46a9-a577-8531e8b5bcb4 |
| Coaching | arya_stark47/2079935187123650593; 30–45s | f97f9cb1-2581-4e61-81d6-0642589244a4 | 4440c0d1-37e6-4275-b603-a5ae18c984c3 |

Native tasks:

- Courtyard: `fal-h3max-reference-01a0f55b-a9ab-7532-884b-3bbb22670e82`.
- Product: `fal-h3max-reference-01a0f55c-9be5-7472-8c39-83524b619575`.
- Solo: `fal-h3max-reference-01a0f55c-84a9-7c93-9c72-6ca64a53c9ae`.
- Coaching: `fal-h3max-reference-01a0f55b-c165-7782-97ac-66093cc46fc6`.

All planning, source transcription/frame inspection, JSON checks, complete video
prompts and `generate_animation` submissions came from Makaron Chat with the
selected Skill. No human rewrote the submitted shots, and no direct `video
create` call was used. Product had a rejected reference-argument preflight,
then repaired its arguments before its single charged submission. No second
paid task resulted from that repair. Source `analyze_video` was attempted but
local Google geographical restrictions persisted; the agents used decoded
frames and ASR and recorded the limitation. This remains a local test environment
limitation; it is not a successful full-video source analysis.

## Automatic completion contract

The existing `completion_actions.policy=auto` was stored but only offered as a
next-step prompt. The candidate now consumes it through the authenticated Agent
Run API. A continuation is restricted to the owned project's completed snapshot
and its stored auto action; caller-supplied replacement prompt text is ignored.
Its deterministic UUID allows CLI, CUI and reconnects to reuse one durable child
run. An active different run returns 409 rather than appending/interfering.
Confirm-only actions remain manual. No schema migration was needed.

CLI `chat` waits and `responses get --wait` run the stored completion action and
return final outputs first, retaining native outputs and child usage. Project
media reconciliation now retains completion actions; previously it could end a
wait as soon as a provider URL became available and lose the continuation.
The Editor triggers the same API after completed auto-action videos and uses
existing background-run reconnection scoped to the correct project. The CLI
path was exercised live. Browser/iOS acceptance of this new UI effect remains
unverified; no production launch is claimed.

Automatic completion runs:

- Courtyard: `d60ad43e-ff7c-5500-a9ce-94437e316c9b`.
- Product: `d463b40e-80f7-5310-aaff-bdc63a85e4c2`.
- Solo: `f06d5a22-41f3-5e5a-a07f-d5e3a818e5d1`.
- Coaching: `44777927-5365-5645-a6c0-548ab8a632fe`.

Two simultaneous additional consumers per source were tested after completion;
all eight requests returned those same existing run IDs with `reused=true`,
without a new generation or another QA run. Receipts are saved locally.

## Observed outcome and QA correction

- **Courtyard:** useful keyboard detail, wider patio context, apple insert and
  return to the speaker. Native second utterance starts around 7.76s versus
  source 9.37s and ends around 10.00s versus 12.05s: fails original sound clock.
  The first plan/QA wrongly treated the ending bite as unconfirmed/absent. Dense
  source ending inspection corrected that judgement: source also lifts the
  apple to the mouth. The missing/retimed toss/other action details remain a
  separate concern; uncertain contact cannot be declared newly invented.
- **Product:** visible scale change and package insert, but the model creates
  a two-hand product presentation/closed-mouth pose, with native overlapping,
  garbled and repeated speech. Few matching stills cannot establish continuous
  mouth timing. Initial QA remuxed original sound on that weak evidence; the
  updated Skill and follow-up QA explicitly reclassify it as an unverified
  comparison. Small label text is not certified from these references.
- **Solo:** clearer side coverage and hands/shaft detail than the preceding
  H3 test. Swing phase/caption fidelity remains unaccepted. Source and native
  ASR reported no valid dialogue. An independent video analyzer hallucinated an
  instructional voiceover from visible captions; do not treat that report as
  proof of newly added speech. Ending dense checks did not establish missing
  final swing motion; preserve the timing uncertainty.
- **Coaching:** relationship/coach coverage and a final chest/ground detail
  support the lesson. The 'away from the ball' phrase still lands on a wide
  rather than the planned spatial detail. Dense ending comparison confirms a
  specific action mismatch: source coach bends holding the club, while native
  close coverage introduces hands supported on the mat. Native transcript order
  is broadly preserved; continuous lip synchronization remains unverified.

The H3 default, autonomous submission/continuation and earlier cinematography
rules were in place before all four paid tests. Source ending/state measurement,
project-scoped paths and stricter audio/QA evidence rules were improved after
these tests. Their QA/export behavior was checked by four selected-Skill Chat
follow-ups using the existing native results; **no paid generation tested the
last source-planning/shot-state refinements**. The follow-ups requested an
original-sound comparison even when fidelity fails, and did not modify the
creative video prompt or generate new picture/audio.

Final comparison export runs:

- Courtyard: `53ac9986-11e6-4596-adbe-ecce0fcb65ed`.
- Product: `14803f3c-532d-4893-aff9-052dba07943b`.
- Solo: `69b2c2a7-f082-4a3c-b034-778eb9a78707`.
- Coaching: `b45179d7-c342-4091-8aa3-5f85d0feec1d`.

## Deliverables and verification

Evidence root:
`/Users/tianyicai/Documents/Codex/2026-10-01/multi-angle-h3-skill-e2e/`.
Each folder contains exact requests, submissions, run events, initial unmodified
plan/prompt evidence, native video, Chat-produced 15s original-sound comparison,
QA evidence, probes, frame sheets and a four-panel report.

Native files are 15.104s H.264/AAC, 24fps; courtyard is 1344×768 and the other
three 768×1344. Chat comparisons use the generated picture, trim provider tail
to 15s and restore source sound. AAC was re-encoded; they are not bit-identical
soundtrack copies. No source picture hybrid, freeze or speed alteration was
used. Native versus final decoded-picture SSIM logs are saved.

Four-panel reports are assembled locally only for presentation. Top-left source,
bottom-left previous H3 with human intervention, bottom-right current Chat+Skill
H3. Courtyard top-right is the supplied professional example; other top-right
panels show the agent's actual timed plan, explicitly labeled as intent rather
than achieved output. Every grid is 15s/360 frames at 24fps; courtyard 960×632,
other grids 960×1800. All share their respective original AAC by stream copy,
verified by packet MD5. The product source panel retains its existing one-frame
tail quantization; generated picture is not padded to hide missing output.

All final files were downloaded/decoded/probed, grid previews inspected, grids
uploaded to permanent storage and appended to their own project timelines.
All four permanent URLs returned successful HEAD responses; their content lengths
matched the local decoded files, with publication snapshot receipts retained.
Shared sound does not validate native dialogue or repair visible lip/action drift.

Charges: 3 speaking-source H3 passes ×676 + music-only H3 pass 672 = **2,700
credits**. Four independent native analyze_video checks add 4, total **2,704**.
Agent/ASR and the comparison re-QA/export runs recorded zero subscription credits.
No extra paid generation was used for grids, continuation recovery or QA correction.

Validation: Skill frontmatter and startup manifest, video-reference contract,
TypeScript, UI i18n guard, 19 targeted artifact-action tests, CLI smoke plus live
CLI completion/duplicate-consumer checks, and full final media decoding. Creative
and source-performance quality remains partially failed; the Skill is still a
candidate, not an accepted or deployed product launch.
