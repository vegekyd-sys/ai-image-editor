# Multi-angle Skill: three new 15-second source tests

Candidate worktree: `codex/multi-angle-video`. No merge or deployment. Tests used
Makaron CLI with the authorized owner account, the local candidate application
on port 3048 (including adaptive Seedance billing), and production standalone
video analysis. Native generation has completed for all six tasks. These are
reviewable test artifacts, not six accepted reshoots.

## Sources and preparation

| Group | Public source | Selected original clock | Meaning source |
| --- | --- | --- | --- |
| Product | https://x.com/jasonugc/status/2105203608010756379 | 14.20–29.20s audio, last half of ISANA testimonial | Actual speech: tried recommendations, unresolved problem, cleanser reveal, benefit, personal outcome |
| Solo lesson | https://x.com/KraftyGolf_/status/2093005980002869343 | 0–15s | Source captions plus demonstration; soundtrack is music, no presenter dialogue |
| Coaching | https://x.com/arya_stark47/status/2079935187123650593 | 30–45s | Actual coach dialogue and demonstration, learner listening |

Prepared references are 720×1280 at 24 fps, with 15s AAC audio. The product source
picture ends at 14.958333s (359 frames), within one frame of its 15s soundtrack;
this is recorded source-tail quantization, not a missing model ending. Both
other references have 360 picture frames. Final comparison timing uses the
15s sound clock. Failed/unselected downloads and already edited candidates are
kept only in local research files; no model tests were charged for them.

Source analyze_video was attempted by each selected Skill run. The local route
returned a geographic API restriction. The Skill used decoded frames and ASR,
recorded the limitation, and did not fabricate words. Standalone production
analysis of each exact prepared reference succeeded and informed human review.
This local analysis routing limitation remains outside this Skill-only change.

## Skill plans, review, and paid requests

Planning runs:
- Product: `a5fb1417-d4a0-4af6-a77d-89621b8a3919`, project `719ca5b4-faba-4007-afb5-ed50c1965451`.
- Solo: `8f291e7c-c2ac-4cf7-9d78-ad9b78a34fcc`, project `361f7e44-2f9c-4e57-85f2-4acf57478743`.
- Coaching: `9be1ada1-6139-47db-8e59-916f990ce956`, project `c11c5eb4-5534-4b34-9bec-95addbaece7c`.

Each used selected `multi-angle-video`, analysis, transcription where attempted,
frame evidence, and a persisted plan. Planning was explicitly separate from
paid submission. Human review corrected the product fragment interpretation,
merged redundant face portraits and a 0.35s bridge into seven purposeful shots,
and strengthened the solo correction detail and matched-profile comparison.
Coaching retained the Skill's six-shot plan. Final reviewed plans were parsed
and checked for contiguous 0–15s coverage. The product Agent's manually typed
word array had a missing bracket; its raw output was preserved and repaired.
Solo plan files were recovered from the run's streamed Node code; no regeneration
was used to recover missing local files.

Both models in each group received the same prepared source, same reviewed
prompt, and original WAV as feature audio reference. Seedance: generate,
duration -1, auto aspect, 720p. FAL H3 Max: generate, 15s, 9:16, 768p. Voice
reference is not an immutable audio/timing layer. No paid retries this round.

| Group | Seedance task | FAL H3 Max task |
| --- | --- | --- |
| Product | `task-unified-1790793685-njqj2650` | `fal-h3max-reference-01a0f3a0-37e0-7032-be38-1ceb459de422` |
| Solo | `task-unified-1790794326-7sjdcjfb` | `fal-h3max-reference-01a0f3a8-f543-78f2-b8da-0fea78837870` |
| Coaching | `task-unified-1790794167-o18tq5qc` | `fal-h3max-reference-01a0f3a6-802b-75b0-bd4f-a799156c5ca0` |

Native probes: all three Seedance pictures are 720×1280, 361 frames,
15.041667s, audio/container 15.072s. All H3 pictures are 768×1344, 362 frames,
15.083333s, audio/container 15.104s. This round needs no source closing hybrid.
It does not establish that audio references caused the changed duration.

## Actual QA

All six native audio tracks were checked with ASR before comparison remuxing.
Moving video/audio was also reviewed through independent analyze_video calls;
manual decoded source/native frames remain authority when reports disagree.
An initial product H3 ASR attempt used an Agent-mistyped URL and returned 404;
it was repeated using the uploaded native asset's Media Index, successfully.
This was a failed read, not another paid generation.

- **Product / Seedance:** Has a face close-up and package detail, but converts
  the performance into a closed-mouth beauty pose around 4–7s while speech
  continues. The solution reveal is late; an originally held tube becomes a
  different presentation pose. ASR shortens the opening to “Match everything”
  and moves “Then” to 4.20s from the source 5.28s; later benefits return near
  source timing. Fails performance and semantic acceptance.
- **Product / H3:** Creates a package insert, but mainly retains medium/face
  framing and moves the tube toward the lens instead of relying only on camera
  perspective. Small package text has rendering variation. Native ASR and a
  separate audio-focused analysis both find overlapping/garbled speech and a
  repeated benefit in roughly 7–12s. The word “blackheads” in ASR is not a
  verified new efficacy statement: independent listening calls that fragment
  unclear. Reject the native sound rather than assert exact words from noise.
- **Solo / Seedance:** Clear new side view and torso/shaft detail, but the close
  correction extends through the intended full stance comparison. Retains
  source white captions despite the test prompt asking removal, and adds a
  dotted instructional line not requested. New angles do not prove unchanged
  technique; final motion timing needs stricter verification. ASR reports no
  valid speech; this is consistent with music-only source, not missing dialogue.
- **Solo / H3:** Useful correction close-up and cleaned overlays; most of the
  rest remains source-like frontal full-body coverage. It does not fulfill the
  requested profile-before/profile-after contrast. ASR finds a short “I'm
  jealous” fragment; visual/audio analysis identifies music and no speaking
  presenter, so do not call that added presenter dialogue based only on ASR.
- **Coaching / Seedance:** New overhead setup, coach close-up, low ground view,
  and two-shot. Dialogue broadly preserves phrase times (opening .41s versus
  .42s source; ending 14.87s versus 14.84s), but includes an extra/retimed “OK”
  in the opening ASR and misses intended close emphasis on the final chest
  instruction. Exact lips/gesture synchronization is not certified by ASR.
- **Coaching / H3:** Stronger relationship coverage and near-coach/torso views.
  Phrase times are broadly close (opening .40s; ending 14.88s), and the
  referenced demonstration is visible. Review still flags jumpy posture/club
  continuity and apparent shaft bend. New viewpoint geometry and full source
  performance fidelity remain unaccepted. Most promising storytelling of this
  group is not equivalent to an accepted frame-exact reshoot.

Automated reviews sometimes mislabeled camera-close versus performer-close,
called generated footage “real footage”, or claimed a held tube persisted at
the end when decoded frames showed otherwise. They are evidence aids, not the
acceptance verdict. Common original audio in the grids does not prove native
sound, lip sync, or gesture-clock success.

## Delivered artifacts and verification

Local evidence root:
`/Users/tianyicai/Documents/Codex/2026-10-01/multi-angle-three-groups/`.
Each group includes original/prepared source, raw plan, reviewed prompt, task
receipts, native outputs, probes, dense frame sheets, native ASR, independent
reviews, and `four-panel-15s-source-audio.mp4`.

Grid layout: top left source, top right timed **plan** (clearly not an achieved
output), bottom left Seedance, bottom right H3. No unrelated previous result
was used. All grids are 960×1800, 24fps, 360 frames, exactly 15.000s, H.264/AAC,
fully decoded successfully. Each grid stream-copies its prepared source AAC;
audio packet MD5 matches its corresponding source. Native picture is retained
and only excess provider tail is trimmed. No generated picture hybrid or
speed adjustment. Original product panel has the noted one-frame tail tolerance.

Uploaded to permanent storage, CDN HEAD returned 200 with matching byte length
and video/mp4, and appended to the corresponding project timeline. Exact
receipts and CDN checks are saved beside each final. Local file preview tabs
were requested; inline local video embeds provide the user-facing playback.

Ledger: Seedance 3×975 + H3 3×676 = **4,953 credits** for six videos.
Ten successful standalone source/review analyses add 10, total **4,963 credits**.
Agent/ASR runs in this round recorded zero credits via Codex subscription.
No additional paid video generations were needed for assembly or read recovery.

## Skill changes from these tests

The candidate Skill now distinguishes performer speech, voiceover, music/lyrics,
source captions, and silence before deriving a speech clock; requires parsing
persisted JSON and aligning revised plan/prompt shot ranges; treats clipped
opening fragments cautiously; avoids redundant portraits and tiny bridge shots;
keeps a product insert as a camera move rather than new presenter acting;
prohibits unrequested instructional overlays; and rejects overlapping/repeated
native testimonial speech before original-audio presentation.

Validation: contiguous reviewed plans, full artifact decode/duration/audio
identity, CDN/timeline checks, Skill frontmatter validator, Agent startup
contract, and git whitespace checks. These guardrails were written after the
six native tests; they are not a claim that another paid post-update run passed.
Full creative + source-performance acceptance still fails for the batch.
