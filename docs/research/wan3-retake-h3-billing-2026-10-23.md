# Wan3 Retake and H3 Max 1080p billing verification

## Outcome

H3 Max 1080p production pricing now includes reference-video processing, using the same existing conservative duration coefficient as 768p. Wan3 Standard and Prime are added to the explicit Retake model contract. Keep Kling 4 as the default: four real Standard cases do not meet the gate for a default change. Prime is wired through the existing provider adapter but has not been independently evaluated in this batch.

## H3 1080p history and current tariff

1080p was already integrated and released on 2026-09-08 (`03f6c969`), including real adapter and authenticated product calls. See [the historical acceptance](../h3max-1080p-acceptance-2026-09-08.md). The zero input-video coefficient came from two actual fal billing events at that time, not a missing adapter.

The [current fal reference endpoint](https://fal.ai/models/minimax/h3-max/reference-to-video) charges $0.16/output second at 1080p plus reference input over one shared 4,096-token allowance, at $0.02/1,000 tokens. Video tokens at 1080p equal 768p; images depend on aspect ratio, videos on aspect ratio/frame count and requested output duration. Do not describe a fixed seconds coefficient as exact fal token accounting.

Production `video:fal-h3-max:1080p:generate` changed only `input_tokens_per_video_second` from 0 to 7459.2, retaining output/image/audio/markup/operator fields. This is the existing conservative 30fps duration-based quote, not a claim of exact per-request provider settlement. For five input/output seconds with no other references it quotes $1.464; the current documented exact 24fps 16:9 example is $1.3632. Other frame counts/aspect ratios can differ. Historical reservations and charges were not rewritten. Migration `20261022180428` is applied and registered in the shared DB; operator backup is retained with ignored evidence.

A new real request `01a164cb-b57b-7f50-9827-fb887df517d0` completed through the 1080p reference adapter: output 1920x1080, 24fps, video 5.166667s / container 5.184s, FAL inference 12.03s. The current FAL key cannot read billing events (403), so no exact supplier charge is claimed for this request. Estimated supplier cost is approximately $1.49; output completion alone does not prove final supplier billing.

## Wan Retake contract

Wan is reference-guided generation of the cropped context, followed by the existing durable patch save and full-video assembly. It is not a native edit or endpoint-lock API. Original audio remains the default. Exact final/middle/corrected-boundary controls fail before paid submission rather than silently changing the model. Standard/Prime use their distinct existing provider task namespaces and status clients. Minimum source reference is 1s; minimum integer output is 2s. Selection remains 0.1–15s in a source up to 120s. Combined reference/output stays within Wan's 30s maximum.

The shared DB constraint retains all historical models and adds both Wan IDs. The provider output downloader explicitly recognizes the fixed MuleRouter asset hostname only for Wan-owned tasks, matching the existing FAL/Evo managed-provider mechanism. Arbitrary subdomains and user-selected sources retain socket DNS checks. Real local downloads had initially been blocked by fake-IP DNS; the same paid tasks resumed without re-generation after the fix.

## Reused historical cases

Each Standard case is a single paid request through candidate Makaron CLI -> authenticated MCP -> Retake -> MuleRouter -> permanent patch -> complete assembly. Historical H3 outputs are retained as references. Source/intent is matched, but output clocks and native controls differ; this is not a byte-identical prompt benchmark.

| Case | Source selection | New job | Result | App credits / supplier estimate |
|---|---|---|---|---|
| Book blue to red | 2–4s | `7b4d18f8-23cd-421c-b4e9-f95670f9c20b` | Red throughout inspected selection, motion close to source; pass for this case | 24 / $0.12 |
| Fight new angles | 3.5–7.5s | `07064065-93ac-44f0-bea8-2c9013d32ad9` | Camera change insufficient; action phases differ from source; fail | 48 / $0.24 |
| Skate underside camera | 18–21s | `2ce55c0a-cada-46d5-aeb1-f2a9144cc048` | Underside shot achieved, but late framing does not match Spark foreground endpoint; partial/fail for seamless editing | 36 / $0.18 |
| Vertical product star ring | 0.5–3.5s | `21a6a79f-8aab-4bcc-bb4c-4c42c189eefe` | Visible blue orbit, fade out and retained product/text; pass for this case | 36 / $0.18 |

All four completed reservations total 144 credits; supplier estimate totals $0.72. MuleRouter status receipts do not return a settled dollar charge, so these are tariff estimates. Together with the H3 probe, estimated supplier spend is approximately $2.21, below the initial $5 budget. No new source videos or keyframes generated. The first book request failed before insertion due to the old DB model constraint and never submitted to a provider; a separate receipt records the actual accepted request.

All complete outputs decode without error and preserve source video track duration, dimensions, fps, frame counts and exact compressed AAC hashes: book 124 frames, fight 241, skate 721, product 600. Local contact sheets and continuous browser playback supplement AV model review. AV analysis incorrectly treated the book returning blue at/after 4s as failure; that footage is outside the selection and must be preserved. Its claims about fight footage after 7.5s and skate joins were also checked against exact selected-boundary frames instead of accepted as ground truth.

Ignored evidence: `artifacts/wan3-retake/` contains submitted intents, immutable job/provider receipts, pricing backup/readback, historical job references, media probes/hashes, complete videos, contact sheets and AV reviews. `index.html` is the local three-way comparison page, served on `http://127.0.0.1:8810/`. No credentials are included in tracked evidence.
