# Retake: native editing model comparison, 2026-10-23

## Decision

Add explicit `grok`, `google-omni` and `minimax-h3` Retake routes alongside Seedance, FAL H3 Max, Kling and Wan Standard/Prime. Grok and Omni have completed real product-path edits; native MiniMax is integrated but its account rejected generation with HTTP 402. Keep Kling 4 as the default. This batch provides no universal quality/cost/speed winner and does not justify a blanket switch to Grok.

For the tested short edits, Omni preserved book color and corrected lettering better than Grok. Grok was cheaper and faster, but left the spelling error untouched, failed the requested skateboard camera and changed an unrelated ribbon color. Omni also failed the product's intended target. Neither is a dependable replacement for inspecting the actual output.

This extends [the Wan/H3 verification](wan3-retake-h3-billing-2026-10-23.md). Code is in an independent candidate worktree/PR; production application code and npm remain on their existing releases. The additive shared database model constraint is applied and registered as migration `20261022182633`.

## Supported routes

| Model | Route | Retake limits and controls |
|---|---|---|
| Grok | Native xAI video edit | Source >=1s, selected interval <=8.5s to leave room under the provider's 8.7s container limit; <=720p; source video only, no extra image references |
| Google Omni | Native `gemini-omni-1.1-flash` editing | Source >=3s; selected interval <=10s; cropped context at least 3s |
| Native MiniMax H3 | Video-reference generation followed by assembly | Source >=2s; context/output minimum 4s; account currently rejects with insufficient balance |
| Wan Standard / Prime | Video-reference generation followed by assembly | Added and evaluated separately in the Wan report; Prime quality not independently tested |

All three newly added routes reject exact final/middle/corrected-boundary controls before charging. They do not claim the existing H3 endpoint-lock contract. Original audio remains default. Native editing and reference-guided rebuilding are different capabilities.

The limits follow the [xAI editing contract](https://docs.x.ai/developers/model-capabilities/video/editing) and [Google Omni documentation](https://ai.google.dev/gemini-api/docs/omni), plus Makaron's stricter assembly bounds. Grok's native output is capped at 720p even if the complete assembled source canvas is 1080p or portrait 1080x1920; retaining the canvas is not proof of native 1080p detail in the edited region. Google upload editing is region dependent: local execution returned a definitive location rejection; the US Preview environment completed all five cases.

## Matched cases and visual findings

All native comparisons use the same source URL, source selection, English prompt and original-audio mode. Model-specific minimum context lengths differ. Grok and Omni are tested through authenticated Makaron CLI/MCP to durable full-video output. Kling/Eco have new matched fight/skate baselines; other prior H3/Wan/lettering results remain historical references, not a strict identical-prompt ranking. No new source footage or generated keyframes were used.

| Case | Grok | Google Omni | Fresh Kling / Eco baseline |
|---|---|---|---|
| Blue book to red, 2–4s | Partial: red at 2.12/3s but blue returns by 3.85s inside the selection | Core change passes: red remains through 3.85s; substantially closer source motion | Not rerun in this batch |
| Fight, new side shots, 3.5–7.5s | Fails new camera coverage; choreography/closing crouch drift | Fails distinct new camera coverage; closer closing pose | Both also fail the distinct requested side-shot coverage |
| Skateboard underside camera, 18–21s | Fails underside view; changes pink ribbon to green | Requested underside view achieved; restores Spark foreground near 20.85s | Both achieve underside views and return to Spark foreground; phase timing still requires judgment |
| Foreground toy blue star ring, 0.5–3.5s | Ring follows foreground toy, but misses star-glint detail and scheduled fade-out | Fails target: ring follows package illustration rather than the foreground toy; late fade too | Not rerun in this batch |
| Retate to Retake, 6.5–10.75s | Fails: Retate remains at 7.5, 8.5, 9.5 and 10.2s | Correct Retake spelling at those times; partial overall because text persists at 10.7s after source title is absent, then disappears at the join | Earlier Kling lettering attempt failed; earlier Eco corrected it, with different prompt/context |

The table separates the central edit from full preservation/endpoint acceptance. It is not a statistical benchmark: one sample per request/model, a deliberately difficult small set, no blinded scoring. Static AV reviewers overestimated product target accuracy and lettering endpoint fidelity. Exact source-aligned frames and browser playback take precedence over those generated reviews. Do not convert the table into a five-case aggregate win rate.

## Time and cost

Times are CLI submission through complete assembled video, including preparation, polling and delivery. They are wall-clock observations, not provider inference timings or production SLAs.

| Model | Clean observed samples | Full delivery | Supplier quote for the same 18–21s skate selection |
|---|---|---|---|
| Grok | Five cases; original book run excluded after downloader repair, replaced by one clean hosted repeat | 56–92s, median 73s | $0.24 |
| Omni | Four clean hosted cases; lettering excluded after response-transport recovery | 75–96s, median 89s | $0.329 |
| Kling 4 | Fight and skate | 127–136s | $0.564 |
| Seedance Eco | Fight and skate | 217–222s | $0.701 (minimum 4s context + upscale) |

Same hosted environment book comparison: Grok 56.224s versus Omni 74.691s. Other Grok timings used the local candidate server while Omni used the hosted candidate, so the wider speed comparison is directional and includes environment differences.

Fifteen generated outputs: six Grok (one downloader-recovery case plus clean book repeat), five Omni, two Kling, two Eco. Completed app reservations total 1,235 credits; summed supplier **quote estimates** are $6.153386. No pending reservations remain. This is below this turn's $10 media comparison cap and excludes the prior Wan/H3 batch (~$2.21) and Agent/routing analysis. Actual per-job vendor invoices were not available, and Google token billing is not claimed to equal these duration-based quotes.

The user authorized app credit top-ups; 1,000 + 500 credits were granted in this turn. Four definitive pre-generation rejections (one Google region, one missing local MiniMax key, two hosted MiniMax insufficient balance) were reconciled and 402 reserved credits refunded. There was no MiniMax generation and no supplier-wallet top-up or financial purchase.

## Reliability changes exposed by real calls

- Persist synchronous Omni completion URL before assembly, then resume from the saved URL. One real lettering response was lost to an HTTP/2 client framing error; the same durable job resumed without another generation.
- Fetch protected Google file output through its authenticated media path rather than treating the interaction ID as an independently queryable video job.
- Allow only the fixed `vidgen.x.ai` output host for Grok-owned jobs under the existing managed-provider download mechanism. User sources and arbitrary subdomains keep DNS checks.
- Explicit Google/MiniMax 4xx submission rejections (except HTTP 408) are typed as not accepted, allowing native billing refund. Missing MiniMax credentials fail before a fetch. Timeouts/5xx remain uncertain so transport failures do not encourage duplicate paid submission.
- Per-model duration/source/reference constraints fail before provider submission; unsupported native endpoint controls do not silently fall back to a different model.

Tests cover synchronous resume without resubmission, fixed output-host scoping, unsupported controls, and definitive rejection versus ambiguous transport outcomes. New routes retain existing root-task idempotency and full-video delivery.

## Evidence and review

Ignored `artifacts/retake-model-benchmark/` holds original intents, provider/root receipts, scoped DB readbacks, immutable downloaded MP4s, contact sheets, probes, compressed AAC hashes, refund audit, timing/quote ledger and model reviews. `index.html`, served locally on port 8811, compares source/Grok/Omni plus the available Kling or Eco baseline and includes full playback/download links.

Ten primary native outputs preserve the exact original compressed AAC hashes, video dimensions, fps, duration and frame counts (book 124, fight 241, skate/lettering 721, product 600); all decode fully. The original videos and prior candidates remain available.

[Omni lettering output](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/5c00154e-d1d5-4fc1-ac8f-54aab8472f4b/videos/retake-743a65df-389e-4cfa-8b98-82da7a32b0ba-final-8265e4796d6f.mp4) · [Grok lettering output](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/5c00154e-d1d5-4fc1-ac8f-54aab8472f4b/videos/retake-48cd140b-7db0-4428-b04a-78305225fe67-final-d2c15351c217.mp4)

Validation before candidate publication: 2,658 unit/component tests passed (one skipped), TypeScript passed, MiniMax rejection-specific tests passed, CLI smoke passed, Skill synchronization passed, and the controlled live routing preflight passed 3/3 with zero media operations. CLI 0.17.7 is prepared as a candidate and has not been published to npm.
