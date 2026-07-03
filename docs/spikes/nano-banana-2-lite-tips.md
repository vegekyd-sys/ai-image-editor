# Nano Banana 2 Lite Tips Spike

Date: 2026-07-02
Worktree: `/Users/tianyicai/ai-image-editor-nano-banana-lite-tips-spike`
Branch: `codex/nano-banana-lite-tips-spike`

## Conclusion

Nano Banana 2 Lite is real and available as `gemini-3.1-flash-lite-image`.

For Makaron, it is a strong candidate for fast Tips preview images and rapid exploratory edits. It is not automatically the best engine for textual Tips generation, because Tips text needs structured JSON, category reasoning, and stable prompt discipline; the image model matters most once a tip needs a preview thumbnail or committed edit.

Recommended path:

1. Add it as a fast image model variant behind env/config first.
2. Use it for Tips preview/image generation A/B, especially 1K thumbnails.
3. Keep Nano Banana 2 / Pro / Qwen fallbacks for multi-reference, identity-sensitive, 2K/4K, and complex local edits.
4. Do not flip all Tips text generation to this model without a batch score run.

## Availability

### Google direct API

Current local `GOOGLE_API_KEY` can see the model:

- Metadata endpoint: `200 OK`
- Model name: `models/gemini-3.1-flash-lite-image`
- Display name: `Nano Banana 2 Lite`
- Supported methods: `generateContent`, `countTokens`, `batchGenerateContent`

Actual image generation also worked via REST Interactions API:

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/interactions`
- Header: `Api-Revision: 2026-05-20`
- Model: `gemini-3.1-flash-lite-image`
- `response_format.type`: `image`
- `response_format.mime_type`: `image/jpeg`
- `response_format.image_size`: `1K`
- Observed latency: `6587ms`
- Output: 1K JPEG
- Usage: `2297` total tokens, including `1120` image tokens and `725` thought tokens

Important implementation notes:

- The installed `@google/genai` version is `1.40.0`.
- Current Interactions API requires JS SDK `>=2.3.0` for the new schema.
- Using the old SDK `ai.interactions.create()` hits the legacy schema error.
- REST with `Api-Revision: 2026-05-20` works without upgrading the SDK.
- `image/png` was rejected; this model path accepted `image/jpeg`.
- `thinking_level: minimal` was rejected on REST Interactions; `low` worked.

### OpenRouter

OpenRouter lists and serves the model directly:

- Model: `google/gemini-3.1-flash-lite-image`
- Resolved runtime model: `google/gemini-3.1-flash-lite-image-20260630`
- Context length: `65536`
- Pricing from API listing: prompt `0.00000025`, completion `0.0000015`

Actual OpenRouter image generation worked through the existing chat completions style:

- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions`
- `modalities: ["image", "text"]`
- `reasoning.effort: "low"`
- `image_config.aspect_ratio: "1:1"`
- Observed latency: `1931ms`
- Output: `data:image/jpeg;base64,...`
- Reported cost: `$0.0347605`

## Official Notes

Google docs describe Nano Banana 2 Lite as the fastest and cheapest Gemini image model, optimized for speed and cost, but not optimized for multiple reference inputs or multi-turn sequential editing.

Relevant constraints:

- Output is 1K only for Lite.
- 2K and 4K are unsupported on Lite.
- It supports image generation and image editing.
- It supports text and image inputs, image and text outputs.
- It supports 14 aspect ratios.
- SynthID/C2PA watermarking is always on.

## Makaron Integration Implications

Current code already centralizes Gemini image generation in `src/lib/gemini.ts`:

- `IMAGE_MODEL` controls the model id.
- `AI_PROVIDER=google|openrouter` selects direct Google SDK or OpenRouter.
- `TIPS_PROVIDER=bedrock|openrouter|google` controls textual Tips generation.

But the direct Google path currently uses `models.generateContent()` and `imageConfig`. That is not enough for the newest Interactions response format. For Google direct Nano Banana 2 Lite, add a dedicated Interactions REST path or upgrade `@google/genai` and migrate to the new Interactions schema.

OpenRouter is the fastest low-friction spike because the existing chat/completions path already matches the successful smoke shape. For production direct Google, the more robust option is a small `generateImageViaGoogleInteractions()` helper that returns the same `data:image/jpeg;base64,...` shape as the existing code.

## Test Artifacts

Local smoke outputs:

- `/tmp/nano-banana-lite-google-rest.jpg`
- `/tmp/nano-banana-lite-openrouter.jpg`

Re-run helper:

```bash
node docs/spikes/nano-banana-2-lite-smoke.mjs --provider both --generate
```

The helper reads `.env.local` from the current worktree if present, then falls back to `/Users/tianyicai/ai-image-editor/.env.local`.
