# FAL H3 model integration acceptance — 2026-09-05

## State

Isolated worktree `codex/h3max-reference`. Product code is not merged or production deployed. The application default remains `seedance-fast`; changing that default is the next acceptance decision.

- `minimax-h3-max`: visible name **fal H3 Turbo**, unchanged Turbo T2V / single-start-image I2V endpoint, 5/10/15 seconds, 480p/768p.
- `fal-h3-max`: visible name **FAL H3 Max**, native T2V with no inputs, otherwise reference-to-video including a single image, video and audio references. Integer 5–15 seconds, 480p/768p. Feature-reference generation supports source-video modifications; no native typed edit/extend or exact audio-preservation promise.
- User requested editing skill copy directly. Removed newly proposed aliases for old ambiguous prose and the compatibility prompt paragraph. Existing established selectors remain; no template-specific runtime routing was introduced.

## Live data changes

Added the Max tariffs and five reference-token pricing columns, leaving existing 65 tariff rows unchanged. The additive migration was applied to the shared database. Public official skill packages were revised and the eight home entries below switched to versioned ZIP URLs; original URLs remain available for rollback. No personal installed skill was overwritten.

- 结尾精灵: [updated ZIP](https://cdn.makaron.app/storage/v1/object/public/images/skills/ending-fairy-turbo/ending-fairy-turbo-v6-fal-turbo-20260905.zip); [original ZIP](https://cdn.makaron.app/storage/v1/object/public/images/skills/ending-fairy-turbo/ending-fairy-turbo-v6.zip).
- K-Pop 舞台, K-Pop 舞台 Turbo: [updated ZIP](https://cdn.makaron.app/storage/v1/object/public/images/marketplace/skills/kpop-stage-turbo-fal-turbo-20260905.zip); [original ZIP](https://cdn.makaron.app/storage/v1/object/public/images/marketplace/skills/kpop-stage-turbo.zip).
- 街拍狗仔: [updated ZIP](https://cdn.makaron.app/storage/v1/object/public/images/images/skills/street-paparazzi-turbo/street-paparazzi-turbo-v2-fal-turbo-20260905.zip); [original ZIP](https://cdn.makaron.app/storage/v1/object/public/images/images/skills/street-paparazzi-turbo/street-paparazzi-turbo-v2.zip).
- 纸牌魔术: [updated ZIP](https://cdn.makaron.app/storage/v1/object/public/images/skills/card-magic/card-magic-v3-h3-direct-fal-turbo-20260905.zip); [original ZIP](https://cdn.makaron.app/storage/v1/object/public/images/skills/card-magic/card-magic-v3-h3-direct.zip).
- 粉雕玩偶: [updated ZIP](https://cdn.makaron.app/storage/v1/object/public/images/skills/powder-doll-reveal/powder-doll-reveal-v12-fal-turbo-20260905.zip); [original ZIP](https://cdn.makaron.app/storage/v1/object/public/images/skills/powder-doll-reveal/powder-doll-reveal-v12.zip).
- 云屋幻梦: [updated ZIP](https://cdn.makaron.app/storage/v1/object/public/images/images/skills/push-open-cloud-house/push-open-cloud-house-v1-fal-turbo-20260905.zip); [original ZIP](https://cdn.makaron.app/storage/v1/object/public/images/images/skills/push-open-cloud-house/push-open-cloud-house-v1.zip).
- 棒球直播抓拍: [updated ZIP](https://cdn.makaron.app/storage/v1/object/public/images/skills/broadcast-candid/broadcast-candid-v24-h3-direct-fal-turbo-20260905.zip); [original ZIP](https://cdn.makaron.app/storage/v1/object/public/images/skills/broadcast-candid/broadcast-candid-v24-h3-direct.zip).

## Measured product path

Mac local Makaron CLI → local MCP → provider → returned URL. 5 seconds, 768p, one attempt per case; this timing includes source uploads and preflight. It differs from the earlier provider-direct benchmark that excluded uploads. Every output returned HTTP 206/video/mp4 and decoded fully with FFmpeg; actual media duration is 5.184 seconds, H.264/AAC, 1344×768, 24fps.

| Case | Time to URL | Final credits | Result |
|---|---:|---:|---|
| turbo-legacy | 15.15s | 40 | [video](https://v3b.fal.media/files/b/0aa930ee/iXfjKEUz6zZ2uVAkSWt1i_minimax-h3.mp4) |
| max-single | 15.58s | 80 | [video](https://v3b.fal.media/files/b/0aa930ef/jP8hcT7DSDheF25cdKZGD_minimax-h3.mp4) |
| max-multi | 18.44s | 80 | [video](https://v3b.fal.media/files/b/0aa930f1/QRlnY480w1tYpckytqwyL_minimax-h3.mp4) |
| max-video | 38.79s | 219 | [video](https://v3b.fal.media/files/b/0aa930f4/FyT_-ng-HHHc4Ot-pzdWF_minimax-h3.mp4) |
| max-mixed | 60.06s | 224 | [video](https://v3b.fal.media/files/b/0aa93111/D6Dt_np1KdJyifa6nnnKP_minimax-h3.mp4) |

All six MCP reservations (five cases plus native Max T2V) settled as completed. T2V and image reference cost 80 credits for these small images; Turbo costs 40 credits. Video-reference input tokens produce 219 credits, and mixed-reference tokens produce 224 credits. Final billing uses measured dimensions and reference durations before supplier submission.

## Agent and persistence acceptance

- Max image reference: project `0833d67b-0614-4e6e-be84-90dc3fec3324`, exact reference endpoint and `fal-h3-max`, 80 credits, persisted permanent CDN video. Browser opened the project and played to 0:05/0:05 with FAL H3 Max shown on the result card.
- Max video + audio reference: project `8ddc8825-c8d6-4a97-bf31-f58faa095ac6`, completed task `fal-h3max-reference-01a07118-1d28-70a3-ae99-562416760a39`.
- Updated Ending Fairy ZIP installed independently for acceptance: project `ef7657ef-a625-4316-925b-d818ac23397e`, completed task `fal-h3max-turbo-01a07114-c4c5-7a13-934a-85bf347559ef`. Agent read the updated skill and selected the unchanged Turbo route.
- An existing account copy of Ending Fairy was older than the official Turbo package and still selected Seedance. This baseline completed in 225 seconds after render creation; it is not a controlled model speed comparison. Marketplace installation currently skips existing installed copies. Updating the official ZIP does not update installed personal copies; installing the revised package is necessary. No model-routing workaround was added.

## Coverage and checks

Public audit: 106 active home entries, 102 ZIP-backed, 100 readable ZIP entries; two URLs returned 403 and four entries have no ZIP. Eight reachable entries refer to the existing Turbo model and use seven distinct packages. The audit does not claim complete coverage of inaccessible packages or personal installed copies.

149 relevant unit tests passed; TypeScript, lint (one pre-existing warning), complete webpack build passed. Isolated PGlite migration and billing lifecycle tests passed, with all old tariffs preserved. New tariff fields are editable through Admin and four UI locales are present.

Research sources: [Max API](https://fal.ai/models/minimax/h3-max/reference-to-video/api), [Max pricing](https://fal.ai/models/minimax/h3-max/reference-to-video), [Turbo API](https://fal.ai/models/minimax/h3-max-turbo/image-to-video/api).

## Review report

[ChatGPT Sites report](https://h3max-reference-field-report.tianyi595926.chatgpt.site). Owner-private; access has not been expanded.
