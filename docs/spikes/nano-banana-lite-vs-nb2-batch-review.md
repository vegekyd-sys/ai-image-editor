# Nano Banana 2 Lite vs Nano Banana 2 Batch Review

Date: 2026-07-02
Run: `test-results/nano-banana-lite-vs-nb2-v1`

## Setup

Goal: compare Nano Banana 2 Lite and current Nano Banana 2 under the same image edit prompts.

Method:

- 5 testcase images.
- 3 categories per image: `enhance`, `creative`, `wild`.
- Generate one shared `editPrompt` per image/category with `google/gemini-3.1-flash-image`.
- Run the exact same original image + exact same `editPrompt` through:
  - Nano Banana 2: `google/gemini-3.1-flash-image`
  - Nano Banana 2 Lite: `google/gemini-3.1-flash-lite-image`
- Provider: OpenRouter for both image edit models.

Artifacts:

- Report: `test-results/nano-banana-lite-vs-nb2-v1/report.html`
- Contact sheet: `test-results/nano-banana-lite-vs-nb2-v1/contact-sheet.jpg`
- Raw results: `test-results/nano-banana-lite-vs-nb2-v1/results.json`

## Quantitative Results

### OpenRouter image-to-image

| Model | Success | Avg edit time | Median edit time | Min | Max | Total cost | Avg cost/edit |
|---|---:|---:|---:|---:|---:|---:|---:|
| Nano Banana 2 | 15/15 | 12.66s | 12.52s | 9.12s | 15.89s | $1.0235 | $0.0682 |
| Nano Banana 2 Lite | 15/15 | 15.37s | 14.73s | 12.80s | 23.56s | $0.5156 | $0.0344 |

Per-category average edit time:

| Category | NB2 | Lite | Notes |
|---|---:|---:|---|
| enhance | 12.23s | 14.94s | Lite slower, similar success. |
| creative | 13.33s | 16.94s | Lite slower, one outlier at 23.56s. |
| wild | 12.43s | 14.22s | Lite closer, but still slower on average. |

Tips generation, for context:

| Category | Avg tips time | Tips cost |
|---|---:|---:|
| enhance | 4.74s | $0.0105 |
| creative | 14.78s | $0.0363 |
| wild | 16.02s | $0.0411 |

This matches the prior project memory: creative/wild latency is dominated by high-reasoning tips generation, not the downstream image model.

### Google direct Interactions API

Follow-up run: `test-results/nano-banana-google-direct-v1`

Same 15 original image + editPrompt pairs, rerun through Google direct Interactions REST API:

- Endpoint: `POST /v1beta/interactions`
- Header: `Api-Revision: 2026-05-20`
- Image input: inline base64 `{ type: "image", data, mime_type: "image/jpeg" }`
- Image output: `response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "1:1", image_size: "1K" }`
- NB2 config: `gemini-3.1-flash-image`, `thinking_level: "high"` (direct API rejects `minimal`; `low` was slower in smoke)
- Lite config: `gemini-3.1-flash-lite-image`, `thinking_level: "low"`

| Model | Success | Avg edit time | Median edit time | Min | Max |
|---|---:|---:|---:|---:|---:|
| Nano Banana 2 direct | 15/15 | 31.26s | 30.09s | 23.50s | 48.70s |
| Nano Banana 2 Lite direct | 13/15 | 11.20s | 10.07s | 8.74s | 15.05s |

Per-category direct average edit time:

| Category | NB2 direct | Lite direct | Lite success |
|---|---:|---:|---:|
| enhance | 32.35s | 10.42s | 4/5 |
| creative | 31.98s | 11.87s | 4/5 |
| wild | 29.45s | 11.31s | 5/5 |

Lite direct failures:

- `IMG_3425.HEIC / creative`: API status `completed` but returned no image.
- `child-stairs.jpg / enhance`: API status `incomplete`, returned no image.

Direct API conclusion: Lite really is much faster on Google direct Interactions, but it is less reliable than NB2 in this batch. The previous "Lite is slower" result appears to be an OpenRouter routing/provider behavior, not the underlying Google direct path.

## Visual Findings

### Enhance

Nano Banana 2 is more reliable as the default enhance model.

- Better at preserving original composition and subject identity.
- More photographic and moderate in tone mapping.
- Avoids heavy blur/recomposition in most cases.

Lite is usable but less conservative:

- It sometimes introduces stronger depth-of-field blur and more dramatic relighting.
- On the pool/drinks image, Lite turned the scene into a more heavily blurred hero-style image, while NB2 kept the original vacation snapshot structure.
- On the night group photo, Lite made the scene darker and flatter than NB2; NB2 produced a clearer cinematic night version.

Verdict: do not use Lite as default enhance if the goal is conservative professional enhancement.

### Creative

Creative is mixed.

Nano Banana 2:

- Tends to integrate added characters/objects more naturally into the existing composition.
- Keeps the scene geometry more stable.
- Better for edits where the added object should feel like a small believable story element.

Lite:

- Often places objects more boldly and visibly.
- Sometimes alters the background or camera geometry more than needed.
- On the sushi/food image, Lite inserted a large creature with stronger visual impact but also changed the room/background more aggressively.
- On the pool peacock image, both were usable; NB2 felt slightly more naturally staged, Lite was a little more literal and cropped to the edge.

Verdict: Lite can be useful for fast ideation or when stronger visible change is desired, but NB2 is safer for production-quality creative tips.

### Wild

Wild is where Lite is most competitive, but still not an obvious default.

Nano Banana 2:

- Stronger integration and richer cinematic effects in several cases.
- On the child/dragon image, NB2 produced a more complete dragon with stronger scene interaction.
- On the night roof-tile swarm, NB2 added dramatic motion but also introduced unwanted text/artifact at the top edge.

Lite:

- Often makes the surreal element larger and more graphic.
- Sometimes executes the core idea more literally, but with less natural blending.
- On the night roof-tile swarm, Lite produced a stronger overhead swirl composition than NB2, without the same visible text artifact.
- On the sushi sea-urchin creature, Lite's creature was visually stronger but less integrated than NB2.

Verdict: Lite is worth testing as an optional wild/ideation path. It is not clearly better overall, but it sometimes produces bolder wild concepts at half the cost.

## Recommendation

Do not switch Makaron Tips previews wholesale to Nano Banana 2 Lite yet, but the recommendation changes after direct testing:

- OpenRouter Lite: cheap but not faster than NB2 in this batch.
- Google direct Lite: much faster than NB2 direct, but had 2/15 no-image failures.

Best current routing hypothesis:

1. Keep Nano Banana 2 as the default Gemini image edit path.
2. Add Google direct Lite as an opt-in fast/cheap variant for:
   - wild ideation,
   - cheap preview thumbnails,
   - low-risk non-face images,
   - internal batch exploration.
3. Avoid Lite as default for:
   - enhance,
   - people/face-preservation images,
   - composition-sensitive edits,
   - production commits where quality matters more than cost.
4. If wiring Lite into product, add automatic fallback: when direct Lite returns no image, retry NB2/OpenRouter/Qwen depending on route.
5. For production UX, treat Lite direct as a preview accelerator, not the final commit default yet.

## OpenRouter Lite Concurrency Test

Follow-up runs:

- `test-results/openrouter-lite-concurrency-v2`
- `test-results/openrouter-lite-concurrency-v2-high`

This test reused the same 15 original image + editPrompt pairs from the first batch. It did not regenerate tips, did not run NB2, and did not score outputs. It only measured OpenRouter Lite image-edit requests at different concurrency levels.

Important timing note:

- `TTFB` is when OpenRouter starts responding.
- `total` is when the full response body is read and the output image is saved.
- Product UX should use `total`, not `TTFB`.

| Concurrency | Success | Wall time | Avg total | P50 total | P90 total | Avg TTFB | Max total |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 15/15 | 218.76s | 14.58s | 13.62s | 19.26s | 2.69s | 19.61s |
| 2 | 15/15 | 102.96s | 13.54s | 12.97s | 16.92s | 2.52s | 20.06s |
| 4 | 15/15 | 60.12s | 14.48s | 13.47s | 19.14s | 2.92s | 19.67s |
| 6 | 15/15 | 41.91s | 14.41s | 14.01s | 19.22s | 3.17s | 19.23s |
| 8 | 15/15 | 42.21s | 16.16s | 15.82s | 19.22s | 3.26s | 23.25s |

Concurrency finding:

- OpenRouter Lite did not fail under 1, 2, 4, 6, or 8 concurrent requests.
- Moderate concurrency improves wall time a lot without hurting per-image latency much.
- Concurrency 8 begins to show a worse tail (`max 23.25s`) without much wall-time gain over concurrency 6.
- Good practical cap for product previews is probably 4-6 concurrent Lite image edits per project/session.

Critical correction:

Earlier quick single-image numbers around 2-4 seconds were mostly TTFB/headers timing or pure text-to-image timing. For real image-edit previews, the full image-ready time is more like 13-16 seconds on OpenRouter Lite with these prompts. The model starts responding quickly, but the full base64 image body takes longer.

## Updated Product Conclusion

Can Lite replace Tips preview generation?

Answer: yes for preview acceleration experiments, but not as a final universal replacement yet.

Recommended product shape:

1. Use OpenRouter Lite for **preview images**, especially when the preview can arrive asynchronously and be replaced/fallbacked.
2. Cap preview concurrency around `4-6`; do not let one project fire 15-20 Lite edits at once.
3. Keep existing NB2/Qwen routes for final commit or quality-critical paths until side-by-side scoring confirms Lite quality is acceptable.
4. Keep Tips text generation unchanged; Lite is about image preview/edit execution, not replacing the text-tip model.
5. Add fallback on no-image / API error / timeout.

Quality caveat:

Lite has enough speed and stability for previews, but visual quality is still mixed: it can be bolder and cheaper, while NB2 tends to preserve composition and integrate details more naturally. So the safest immediate rollout is `Lite preview -> user selects -> final commit can still use the stronger model`.

## Follow-Up Tests

Next useful tests:

1. Run a focused `wild`-only direct Lite batch on non-face images.
2. Test retry policy: direct Lite once, then fallback to NB2 only on no-image/incomplete.
3. Compare direct Lite at smaller input image sizes, because Lite direct counted the input image as 1120 image tokens while NB2 direct counted 258 on the same source in the smoke test.
4. Consider upgrading `@google/genai` to `>=2.3.0`; current repo has `1.40.0`, so product integration currently needs REST for Interactions.
