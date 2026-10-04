# Three-scenario live Agent acceptance — 2026-09-03

## Scope

Real natural-language `makaron chat` requests through the local App at port 3039,
using the owner's existing authentication, real Agent/providers, persisted
project artifacts and normal video billing. No preset tool arguments, fabricated
Agent answers, mocked provider results, or balance modifications.

The feature worktree is `codex/wan27-image`; the fixed runner serves committed
code. The initial version was `da90e4c9`. The H3 multi-image workflow guidance
fix is `53fba8bd`. No merge, Preview deployment or Production deployment.
Local App projects use the shared database and remain available to the owner.

## Requests and evidence

Input images in each case: the user-provided `20260902-210147.jpeg` portrait and
the earlier Wan stadium edit (`outputs/wan27-integration/live-1/edit.jpg`).
Prompts are ordinary user requests, without `video_intent`, tool names, or
replication-contract instructions.

| Scenario | Project | Run | Observed tool decision |
| --- | --- | --- | --- |
| Ordinary two-image video | `1fa645e2-17b0-40b3-9432-900f49a1ddb3` | `1d84d7f2-92d6-4ef4-bec7-70122e4d22f3` | Default `generate`, no contract, both images, Seedance Fast 720p, one successful video submission |
| Exact replication: source video + two images | `185d135a-f394-4785-83eb-de52c2989506` | `a6caddcf-5584-4c0e-8049-d6c83b41a4f4` | Explicit `replicate`, real source `media_3`, character `media_1`, environment `media_2`, Wan Prime 720p, one successful video submission |
| Explicit H3 Max with two image roles | `2ce4df02-d48a-4ea9-b76f-f528deb0f246` | `a7ffd741-8f72-4119-b5d1-352cb9f4c17b` | One `generate_image` with both roles, then `generate` using ONLY composed `media_3`, H3 Max 768p, one successful video submission |

### Ordinary generation

> 用这两张图里的女生做一个5秒的时尚短视频，从夜景造型自然过渡到棒球场看台造型，人物保持一致，动作自然，镜头轻轻推进，横屏16:9。你来安排镜头，直接生成一条成片，不用再次确认。

Task `task-unified-1788438501-s19kw5so`, snapshot
`17b0d7e1-1ee4-47a1-87fd-567bf4f45dac`. Observed MP4: H.264 + AAC,
1280x720, container duration 5.088s. Browser reached `ended=true`,
`currentTime=5.088`, `readyState=4`. Frame inspection shows the night portrait
followed by the stadium/jersey shot. Video ledger debit: 161 credits, one row
`4b1bafd7-6670-4807-8ba7-d140726dcd91`.

### H3 Max: first failure, then clean-project retest

> 用这两张图里的女生做一个5秒的棒球场看台时尚短视频，用 MiniMax H3 Max、768p。人物身份参考第一张，服装和场景参考第二张，她自然转头看向镜头，镜头缓慢推进。直接生成一条成片，不用再次确认。

The first attempt (`e573fc79-8948-42b8-8987-98aa7a7d2af7`, run
`0e4871ca-54ed-4486-9402-6d18494a04ce`) made no video submission: the Agent
stopped at H3 Max's single-image restriction and recommended switching models.
That is a workflow failure, not a successful test or a provider error.

After adding composable-reference preparation guidance to the self-contained
tool description and animate guide, the EXACT SAME prompt was submitted in a
fresh project. The Agent called `generate_image` with `media_index=2` and
`reference_media_indices=[1]`, producing `media_3`. It then submitted H3 Max
with only `media_3`; no model switch, dropped input role, or replication contract.

Task `fal-h3max-turbo-01a06741-1c4b-7a42-bb0c-631286f0ed8d`, snapshot
`55ea6608-f805-43ec-98d1-4c0e9595dd72`. Observed MP4: H.264 + AAC,
1344x768, container duration 5.184s. Browser reached `ended=true`,
`currentTime=5.184`, `readyState=4`. Frame inspection shows a seated stadium
portrait, natural head turn and camera push-in. Video debit: 40 credits, one row
`3ffba299-86c3-4977-9541-0ac86c731f00`.

### Replication

The source is the real completed ordinary-generation clip above, imported into
a fresh project alongside the two image references.

> 请复刻这条5秒视频：人物换成第一张图里的女生，保持第一张的脸、短发和黑色服装；环境统一换成第二张图的棒球场看台，不采用第二张的白色球衣。完整保留源视频的镜头顺序、每段时长、转头动作、推进镜头和闪光转场。请先看完整条源视频，再直接生成一条5秒、720p成片，不用再次确认。

The Agent read the replication protocol, analyzed the complete source, then
used `run_code`/FFprobe to inspect duration, frame rate and audio before paid
submission. Its contract uses measured `source_duration_seconds=5.088` and
references the actual project video. Model: `wan-3.0-prime`, resolution: 720p,
output duration: 5s. No local video validation failures or repeated submission.

Task `mr-wan30-prime-37c4a334-8612-416e-bb94-13efa89ea645`, snapshot
`3a9972f1-c705-4295-9bcc-7105110e7afa`. Video debit: 140 credits, ledger row
`d9c25bf6-b9d9-4438-8f7d-aef43590fbe7`.

The provider reported completion at `2026-09-03T12:38:06.544167Z`, but the
returned `mule-router-assets.muleusercontent.com` MP4 failed HTTPS certificate
validation (`SELF_SIGNED_CERT_IN_CHAIN`). Its observed certificate issuer was
Cloudflare Gateway; both normal Node fetch and Node with the existing system
CA store rejected it. No trust settings, proxy rules, or TLS checks were changed.
The App logged `Video snapshot persist error`, retained a temporary provider URL,
and showed an unplayable video with an inaccurate "link expired" message.
This is a delivery failure, not an Agent parameter-validation failure. The Wan
output is NOT accepted just because the task says `completed`.

A separately billed Seedance Fast replication retest was submitted in the same
project, run `db881ba9-c717-4ef5-9698-f6466334bd53`. The natural-language
follow-up explicitly keeps the original uploaded source and replacements,
selects Seedance Fast, and excludes the unplayable Wan output as a source.
It submitted exactly once, using `video_intent=replicate`, the measured 5.088s
contract, and source `media_3` plus replacement images `media_1` / `media_2`.
Task `task-unified-1788439637-0v43lymq`, snapshot
`a80c3664-96a4-426d-9146-c91052a8c288`. The video is now persisted on Makaron
CDN and the browser has loaded it (`readyState=4`, 1280x720, 5.088s). A real
play-button click advanced the CDN video to 0.191s with `paused=false`; the page
selection changed before an end-state observation, so no `ended=true` claim is
made for this clip. Local FFprobe and FFmpeg decode succeeded (H.264 + AAC,
121 video frames). All three scenario artifacts passed the local decode gate.
Video debit: 161 credits, ledger row `05454f1d-dd30-4517-88fb-45440a2d1d85`.
This is an additional paid result, not a recovered or repaired Wan task.

The follow-up Agent finished its tool work, but a transient network reset caused
`Failed to persist Agent context snapshot` after submission; the durable Run
remained `running` at the next observation. The UI also replayed some text and
showed `Thinking...` after the video appeared. This is a separate lifecycle/UI
issue, not four repeated provider submissions. Do not call the full UX clean.

### Historical network evidence (checked at the owner's request)

The task `01a0580a-4585-70e2-8077-364cfa3160cc` recorded the same hostname,
Gateway certificate and error on 2026-08-31 evening. The historical diagnosis
identified MonoProxy's upstream Cloudflare Gateway policy. Tailscale SSH
attempts failed; the successful historical download used the existing deployed
Makaron server-side video proxy, then verified Standard and Pro MP4 files with
FFprobe. It did not repair the Mac's direct network route.

This turn only inspected that record and current read-only network facts:
MonoProxy is still listening on port 8118, while system HTTP/HTTPS/SOCKS proxy
flags are currently off. Current routing should not be assumed identical to
August 31 without checking the tunnel/upstream configuration. No network or
Gateway policy was changed, and the historical relay workaround was not run.

## Boundaries and follow-ups

- These are live workflow/submission and media-delivery tests. Exact face
  identity and frame-exact structural fidelity require separate acceptance;
  a successfully decoded video does not prove either.
- The replication run encountered an upstream Agent HTTP 520 before its tool
  work; the existing runtime recovered. This was not a video provider retry.
  Its user-facing narration also unexpectedly switched to English; recorded
  here as a separate language-following issue.
- Existing Gemini multi-reference billing gap: `models/gemini.ts` receives only
  an image string from `generateImageWithReferences`, losing usage. The H3
  preparation image succeeded via Gemini/OpenRouter but produced no image
  debit in this test. The video debit did succeed. Do not describe the 40
  credits as a verified all-in workflow price. No retroactive charge was made.
- Regression: 15 targeted intent tests and 1,534 full tests passed. TypeScript,
  lint, i18n, startup and video-reference-workflow checks passed.
- Local evidence: `outputs/video-intent-qa/audit.json`, frame contact sheets,
  browser screenshots, and `media-proof.json` with three decoded CDN artifacts.
  Read-only audit/decode helpers are local ignored QA scripts; they do not
  submit jobs or change project data.
