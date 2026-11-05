# GPT Image 2.6 release acceptance — 2026-11-05

Released business commit: `0df70536dfdbc41d9b4afd3d41dc8a6cd035e85e`.

- Production: https://www.makaron.app (`dpl_ESMHXQGQkMT3g7AtbjQdrJj3BWQf`).
- Preview: https://ai-image-editor-eyzi3om8m-vegekyd-sys-projects.vercel.app (`dpl_CJTCdBhCm3Yi8xtDLhVCLYajjHex`). Shared dev alias points to this release; Git dev was pushed. Both deployment source hashes match.
- npm: `makaron-cli@0.17.9`, `latest=0.17.9`. Inspected SHA1 `6f638069651a4d464ba347d213709bf3a3af4c8e`; fresh registry install compared all nine packaged files, chat help and live built-in directory. Local installed CLI was upgraded to this version and used for live regression and the promotional video.
- Production gate: TypeScript, 2,724 tests passed / one skipped, CLI smoke/upload, Skill sync, three controlled routing cases, production build, CRC32C/FFmpeg packaging checks. The initial release gate failed on stale 2.5 expectation, prompt size and missing creative-contract amendments; fixed before any production deployment.
- Production and Preview health: 12/12 healthy. Shared database, fal/EvoLink credentials and Remotion/media sandbox snapshot configuration match; no config or allowlist changes were needed.

## Real production regression

| Case | Result |
| --- | --- |
| Default PNG through new CLI chat | 1024×1024, actual `gpt-image-2.6-flare`, 8 image + 2 Agent credits |
| Default native GIF through new CLI chat | 960×960, eight distinct frames, 160ms/frame, loop=0; actual 2.6 Flare, 11 image + 2 Agent credits |
| Personal Codex subscription Agent → image tool | Actual Agent `gpt-6-luna:codex-subscription` at 0 Agent credits; real 2.6 Flare PNG separately charged 6 image credits; no API fallback observed |
| Preview CLI Sunburst | Real PNG, actual `gpt-image-2.6-sunburst`, 6 credits |
| Actual Editor | PNG/GIF display and reopen passed; GIF visibly animates; GIF Save bytes match the original; model choices adjacent with no SVG subtitle; desktop/mobile screenshots retained; no page errors |
| Public release copy | New 2026-11-05 entry visible in production IAB Changelog |

The IAB login redirect did not establish an authenticated test session. Actual authenticated Editor QA reused the existing Playwright workflow with a normal Supabase session for the existing CLI test identity; no auth bypass, new role, allowlist entry or production code/config was introduced. Only newly created dedicated regression projects were touched. An initial static-PNG Save assertion expected identical original bytes; legacy static Save intentionally encodes JPEG. The corrected check verifies dimensions; native GIF still requires and passes exact original bytes.

All paid requests were single submissions with known run IDs; pending tasks were queried in place. Existing private user projects and failed historical requests were not replayed. Real SVG generation remains provider-blocked/experimental and is absent from the picker subtitles and promotional claims. This release acceptance covers PNG/GIF and the subscription Agent→fal path, not a native Codex image endpoint or successful SVG generation.

Detailed production/Preview receipts, source hashes and live test evidence are in the adjacent JSON files. Full run logs, media originals and video work stay under `outputs/gpt26-release-20261105/`.

## Pixel review

Default mascot PNG has the correct Chinese headline and recognizable purple Pixel Wizard. The native GIF contact sheet shows eight distinct readable poses with consistent character identity. Subscription PNG renders the headline and five correct-colored spheres, but places them inside the cup rather than strictly outside it; this is a composition limitation, not a provider/transport failure. These samples are functional release checks, not a claim of perfect instruction following or a new quality benchmark.

## Promotional video delivered

Created through installed `makaron-cli@0.17.9` CLI `chat`, project https://www.makaron.app/projects/260de927-277e-4c43-bb28-0c1bdfded800.

- One native video submission: exact `seedance-2.5-eco`, 15s, reference-to-video; Eco normally generates 480p and upscales to 1080p. One GPT Image 2.6 mascot identity card prepared from the official reference sheet.
- Final: H.264 MP4, 1080×1920, 24fps, 15.072s including audio padding; original AAC stereo audio preserved byte-for-byte (demuxed ADTS SHA256 comparison).
- Story: Pixel Wizard pretends to be a static image, Spark makes him move, the hat flies off; Flare/Sunburst and the terminal appear before the stable Makaron closing frame.
- Native voice omitted the GIF phrase. A follow-up **CLI chat in the same project** used FFmpeg/libass + Noto CJK to burn three short feature captions, including “一句话变 GIF”. No new image/video/music/voice model call was made for the caption pass. Original video remains retained. Captions slightly approach the flying hat tip, but avoid the face and original product labels; final contact sheet inspected.
- Native first sentence is the intended “罚站” joke. The automated native-media review mistook this as an attempted “发呆”; no audio replacement was needed.
- Original creation chat: 447 credits (436 video, 6 identity image, 5 Agent); caption chat: 13 Agent credits, no generation charge. These two chats total 460 credits. Standalone video analysis is outside that two-chat subtotal. Known video supplier quote: $2.178 including Eco upscaling; this is the configured supplier quote, not an independent invoice total.
- Playback/download: http://127.0.0.1:3057 . Final local file: `outputs/gpt26-release-20261105/promo/makaron-image26-launch-15s-final.mp4`.

Video receipts: `promo-native-media.json`, `promo-final-media.json`, `promo-native-review.txt`, `promo-final-contact-sheet.png`, and the submission proof. Production authentication and generated-media originals remain separate from this public evidence directory.

Final IAB playback reached the end of 15.072s. Browser MP4 download matches the final file exactly; SHA256 `51a1dbd7cc025ee6bc9892f105cbc7953b12b6030589034a074767b7689e34b1`.
