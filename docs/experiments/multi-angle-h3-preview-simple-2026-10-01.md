# Preview: four source-only, simple-request Skill tests

Tested code: `18091733`, branch `codex/multi-angle-video`.
Deployment: `dpl_3vDmJUeWzRtT99EgDeDaJ6FTKjd6`, target **Preview**, Ready.
URL: https://ai-image-editor-7zuutdq41-vegekyd-sys-projects.vercel.app
No production release, shared Preview environment update, or shared git-dev
alias reassignment. Preview and production use the same database; writes were
scoped to four new owned test projects and their media/runs.

## User-path inputs

Each CLI Chat selected `multi-angle-video`, attached only its original prepared
15s video, and sent the same ordinary request:

> 把这个视频做成更专业、有故事感的15秒多机位视频，保留原声，直接生成。

No prior analysis, storyboard, creative prompt, explicit model/resolution,
technical completion instructions, or QA hints were included in that request.
The Skill selected FAL H3 Max at 768p, wrote its own coverage alternatives and
director review, submitted its own complete prompt, and scheduled automatic QA.
No human rewrote the creative prompt or sent a follow-up Agent request. All four
initial runs and automatic completion runs finished. Database readbacks confirm
the initial execution origin is this exact Preview for all four.

| Take | Preview project | Initial run | Automatic completion |
| --- | --- | --- | --- |
| Courtyard | 7a1c765f-db5b-47cc-8789-d581ea97c6a4 | f869f6b0-3971-44f9-9bdd-8693ad914540 | 56617422-e3e7-5fe9-a1e4-8fc34319873f |
| Product | cb260d6d-8bf6-4e28-b30d-48ebf3d0961a | 4dfce83b-70ce-42bd-8a47-8c885df6d964 | 1623254d-2527-5bbe-a1dc-89f9b26772bb |
| Solo golf | c8b31dba-b2ee-4ce0-99c7-9f8c5b685a7c | e1d76feb-44d0-4451-a05b-cd0d0d2e9427 | c46b1c19-ce30-56b2-aa00-22b88124b0ff |
| Coaching | 8b94e663-5bd2-43ea-a4fa-253780d890a1 | ab014c04-9862-43a9-8340-920ea4ef81a2 | ef16d48e-b74a-526e-aa79-5859625ea10f |

Open projects under the Preview origin plus `/projects/<id>`. API receipts also
return canonical production project URLs; those URLs are not proof of where the
run executed. The `run-origin-proof.json` receipt resolves that distinction.

Cloud source video understanding worked: successful source `analyze_video`
charges appear on each initial run before generation. Product reused the current
upload batch's automatic video understanding, so it has no separate named Agent
`analyze_video` tool call. The other three also explicitly asked visual questions.
Courtyard independently inspected the apple ending and correctly included toss,
catch, bite and chewing, correcting the preceding round's mistaken source plan.
Successful analysis is interpretation, not proof of precise motion timing.

## Actual outputs and acceptance

Exactly one successful charged native task per take, all 15s H3 Max reference
generation:

- Courtyard: `fal-h3max-reference-01a0f5f2-4521-7f70-9a04-3c174566b8f7`.
- Product: `fal-h3max-reference-01a0f5ee-9916-77f1-b3c7-4b42164e80b0`.
- Solo: `fal-h3max-reference-01a0f5ef-caf7-7921-a84a-0045fe8fcad2`.
- Coaching: `fal-h3max-reference-01a0f5ee-82e2-7b63-8ec3-002891242917`.

The **batch remains creatively unaccepted**; workflow completion does not prove
that output exceeds the manually directed comparator.

| Take | Observed result | Automatic delivery |
| --- | --- | --- |
| Courtyard | Stronger distinct side/table and wider courtyard coverage. Paired dense 11–15s samples show an early toss/catch in the side shot and another toss in the following frontal shot; source has one toss. Native QA also flags omitted “Honestly though” and action timing. | Preserved native candidate; QA refused original-sound restoration/final acceptance. |
| Product | Explicit product emphasis, but mostly frontal coverage/push-in. Product advances toward camera earlier than source rather than camera producing the intended insert. | QA failed multi-angle/timing; published a labeled original-audio comparison plus preserved native. |
| Solo golf | Mostly source-like frontal views with scale change; no readable matching side before/after coverage. Native QA ASR flags “Don't be sad.”; treat ASR as an audio anomaly report, not proof of all soundtrack contents. | Preserved native candidate; QA refused original-sound restoration. |
| Coaching | No PIP observed this round; teacher coverage changes, but ending correction remains a wide two-person view and hierarchy is weak. Continuous fidelity remains unverified. | Published a 15s original-audio candidate with limited-camera-emphasis findings. |

Two failed candidates did not become original-audio finals. They still exist as
playable native results; do not claim four accepted original-sound films.
No extra paid generation or human QA-repair prompt was submitted.

## Presentation and real-media verification

Evidence root:
`/Users/tianyicai/Documents/Codex/2026-10-01/multi-angle-h3-preview-simple/`.
It contains exact requests, tested Skill/hash, submissions, full run/completion
events, successful task scripts, source/native files, final comparisons, probes,
frame sheets, usage, origins and storage/timeline publication receipts.
`submitted-scripts.md` shows all four successful task prompts unchanged.

Four local presentation grids were built and appended to the corresponding
Preview projects **after** automatic QA ended. Top-left source; top-right manual
H3 comparator; bottom-left preceding local Chat+Skill H3; bottom-right current
Preview simple-request Chat+Skill H3. They are reporting assets, not creative
edits to the Skill output. The generated picture is unchanged except trimming
the provider's extra tail; defects remain visible. Common original AAC sound is
stream-copied and packet-MD5 identical to the source; it does not certify mouths,
actions, or native sound. Grids are 15.000s, 360 frames at 24fps, fully decoded.
The two Chat original-audio exports also fully decode and have 360 frames/15s.

All four native videos fully decoded locally and reached the end in Chrome's
standalone CDN video players, with readyState 4 and no video-element error.
Native containers are 15.104s, courtyard 1344×768, others 768×1344. Preview home
opened normally. Browser was not logged into the CLI account, so authenticated
editor/player interaction is **not** certified by those standalone-player tests.
Authenticated CLI/API verified project media publication.

Stored grid HEAD responses from the verified same Supabase origin returned 200
and content lengths matching the local files. Grid CDN pages were opened in
Chrome; standalone playback evidence is retained separately.

Local CLI uploads initially timed out on CDN transport for three takes, before
Agent submission. Their existing empty projects were reused, with the same
request. A temporary CLI-only fetch shim routes CDN requests to its verified same
Supabase origin; Preview application/provider configuration is untouched. This
was technical upload recovery, not creative intervention. Larger report uploads
hit Vercel's request-body limit on the admin endpoint, then used the standard
signed-upload route. No new Agent run or paid task resulted from either repair.

Validation: clean candidate, full lint, local webpack build and Vercel build,
Ready deployment/Preview health, selected built-in Skill metadata, actual cloud
execution origins, all four final run statuses, media decode/probe, browser
playback, audio packet hashes, and publication byte lengths.

Observed account ledger for these four projects after all automatic runs:
four generations ×676 = **2,704 credits**, video analysis 16, image analysis 11,
total **2,731 credits**. The ledger snapshot and scoped rows are saved; this is
an observed test cost, not a general price quote.
