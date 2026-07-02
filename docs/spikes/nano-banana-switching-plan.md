# Nano Banana Lite Switching Plan

Date: 2026-07-02

## What We Tested

Model under evaluation: `google/gemini-3.1-flash-lite-image` / `gemini-3.1-flash-lite-image`.

Key runs:

- Text-to-image mascot prompt: `test-results/nano-banana-lite-text-to-image-mascot`
- Mascot reference image generation: `test-results/nano-banana-lite-mascot-reference`
- Single creative image edit: `test-results/single-creative-speed`
- OpenRouter concurrency: `test-results/openrouter-lite-concurrency-v2` and `test-results/openrouter-lite-concurrency-v2-high`
- OpenRouter stream test: `test-results/openrouter-lite-stream-test`
- Google direct batch rerun: `test-results/nano-banana-google-direct-v1`

## Timing Reality

There are three different timing concepts. Do not mix them:

1. **Text-to-image total time**
   - OpenRouter Lite mascot text-to-image: `2.06s`
   - This is fast, but it does not represent image editing.

2. **OpenRouter image-edit TTFB**
   - Concurrency runs: average TTFB around `2.5-3.3s`.
   - Stream test: first SSE chunk at `5.16s`.
   - This means the server is responding, not that the image is visible.

3. **OpenRouter image-edit full image-ready time**
   - Concurrency 1: avg `14.58s`, P90 `19.26s`.
   - Concurrency 2: avg `13.54s`, P90 `16.92s`.
   - Concurrency 4: avg `14.48s`, P90 `19.14s`.
   - Concurrency 6: avg `14.41s`, P90 `19.22s`.
   - Concurrency 8: avg `16.16s`, P90 `19.22s`.

## Streaming Finding

OpenRouter `stream: true` works, but it does not stream progressive image pixels.

For one creative image edit:

- Headers / first SSE: `5.16s`
- First reasoning chunks: about `5.16s+`
- First `images[0].image_url.url` data URL: `11.23s`
- Full stream done / usage received: `15.37s`

Implication:

- A product can show "working / reasoning / generating" quickly.
- The image itself appears as a complete base64 data URL in one chunk around `11s` in this test.
- There is no partial image preview before the data URL arrives.

## Concurrency Finding

OpenRouter Lite held up well under concurrency:

| Concurrency | Success | Wall time | Avg total | P90 total |
|---:|---:|---:|---:|---:|
| 1 | 15/15 | 218.76s | 14.58s | 19.26s |
| 2 | 15/15 | 102.96s | 13.54s | 16.92s |
| 4 | 15/15 | 60.12s | 14.48s | 19.14s |
| 6 | 15/15 | 41.91s | 14.41s | 19.22s |
| 8 | 15/15 | 42.21s | 16.16s | 19.22s |

Best practical cap: `4-6` concurrent preview edits per project/session.

Concurrency 8 did not fail, but it had worse tail latency and almost no wall-time win over concurrency 6.

## Quality Finding

Lite is good enough to explore as a preview model, but it should not replace the strongest final model yet.

Observed pattern:

- Lite can be bold and visually obvious.
- NB2 tends to be more conservative and better integrated.
- For `enhance`, NB2/Qwen-style conservative routing remains safer.
- For `creative` and `wild`, Lite is viable for preview generation.
- For people/identity-sensitive commits, Lite needs fallback or final regeneration with a stronger model.

## Recommendation

Switch proposal:

1. **Do not replace Tips text generation.**
   - Keep current Tips text model and prompt templates.
   - Lite only replaces preview image execution, not tip ideation.

2. **Use OpenRouter Lite for preview images behind a feature flag.**
   - Suggested env: `TIPS_PREVIEW_IMAGE_MODEL=google/gemini-3.1-flash-lite-image`.
   - Suggested switch: `TIPS_PREVIEW_PROVIDER=openrouter-lite`.

3. **Keep final commit model unchanged at first.**
   - Preview can be cheap/fast Lite.
   - When user commits a tip, use existing route: NB2/Qwen/model-router, or compare whether Lite output is already acceptable.

4. **Cap preview concurrency at 4-6.**
   - Start with 4 for safer production rollout.
   - 6 is acceptable for internal/batch preview.

5. **Use stream mode for better perceived progress, not partial image display.**
   - First SSE/processing is useful for UI state.
   - Show `generating` quickly.
   - When the image data URL chunk arrives, update the preview immediately without waiting for final usage.

6. **Fallback conditions.**
   - No image returned.
   - HTTP/API error.
   - Timeout, e.g. `25s`.
   - Optional: if output is selected for final commit and route/category is `enhance` or people-sensitive, regenerate with stronger model.

## Rollout Shape

Phase 1: Internal flag

- Add Lite preview provider and model env.
- Use only for manual dev/preview testing.
- Log TTFB, first image chunk, total, success, cost.

Phase 2: Small production preview trial

- Apply to `creative` and `wild` previews first.
- Keep `enhance` on current route.
- Concurrency cap `4`.
- Fallback to current preview model if timeout/no image.

Phase 3: Decide final commit behavior

- Compare user-selected Lite previews against final regenerated output.
- If selected preview quality is good enough, consider letting users commit the Lite preview directly for creative/wild.
- Keep final stronger route for enhance and identity-sensitive edits.

## Decision

Nano Banana 2 Lite should be introduced as a **Tips preview accelerator**, not as a full Nano Banana 2 replacement.

It is worth switching preview generation experiments to Lite because:

- It is much cheaper.
- It has stable success under concurrency.
- TTFB is fast enough to improve perceived responsiveness.
- Full image-ready time is acceptable for async previews.

It should not fully replace the current model stack yet because:

- Full image-ready time is still usually `13-16s`, not `2-4s`.
- Quality is mixed by category.
- Google direct Lite had no-image failures in batch.
- Final commit quality and identity preservation need stronger evidence.

