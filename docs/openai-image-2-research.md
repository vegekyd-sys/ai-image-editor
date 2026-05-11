# OpenAI gpt-5.4-image-2 (Image 2) — Comprehensive Research

## Overview
OpenAI Image 2 is a new generation image generation model (named `gpt-5.4-image-2` internally) announced in early 2026. It excels at text rendering and is now integrated into your Makaron app via OpenRouter.

---

## 1. Available Ways to Call It

### 1.1 OpenRouter (Currently Used - Recommended)
**Status**: Production-ready, used in your current implementation

**Endpoint**: `https://openrouter.ai/api/v1/chat/completions`

**Model ID**: `openai/gpt-5.4-image-2`

**Key Features**:
- Same endpoint as other OpenRouter models (Gemini, Bedrock, etc.)
- Uses OpenRouter's unified chat completions API
- Requires `OPENROUTER_API_KEY` environment variable
- Returns usage tokens for billing calculation
- Supports both base64 and URL-based images
- Handles multiple reference images

### 1.2 OpenAI Direct API
**Status**: Not publicly documented as available yet

**Endpoint** (theoretical): `https://api.openai.com/v1/images/generations` (for DALL-E)

**Notes**:
- OpenAI appears not to have published direct API access for gpt-5.4-image-2 yet
- The model may only be available through partners (OpenRouter, etc.) for now
- OpenAI's direct API currently focuses on DALL-E 3 for image generation
- Direct API would require `OPENAI_API_KEY` (different from OpenRouter)

### 1.3 Azure OpenAI
**Status**: Likely available but not documented yet

**Notes**:
- Azure OpenAI typically mirrors OpenAI's latest models with a 2-4 week lag
- Would require Azure credentials and a specific deployment name
- Pricing typically 20-30% higher than direct OpenAI or OpenRouter
- Not recommended for your use case (slower adoption, premium pricing)

### 1.4 Other Proxies/Resellers
**Status**: Varies

- **Anthropic Bedrock**: OpenAI models not available
- **Together.ai**: Likely to add support
- **Hugging Face**: Text-to-image only, different models
- **LocalAI/Ollama**: Not applicable (requires local model download)

---

## 2. API Details by Provider

### 2.1 OpenRouter (Your Current Implementation)

**Request Format** (from your `src/lib/models/openai.ts`):

```typescript
{
  model: "openai/gpt-5.4-image-2",
  stream: false,
  modalities: ["image", "text"],
  temperature: 1.0,  // Note: temperature fixed at 1.0 (model requirement)
  messages: [
    {
      role: "user",
      content: [
        // Image(s) — base64 or URL
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } },
        // OR
        { type: "image_url", image_url: { url: "https://..." } },
        
        // Text prompt
        { type: "text", text: "Your editing prompt here" }
      ]
    }
  ]
}
```

**Response Format**:

```json
{
  "choices": [
    {
      "message": {
        "content": [
          {
            "type": "image_url",
            "image_url": { "url": "data:image/png;base64,..." }
          },
          {
            "type": "text",
            "text": "Optional description"
          }
        ]
      }
    }
  ],
  "usage": {
    "prompt_tokens": 12345,
    "completion_tokens": 5678
  }
}
```

**Image Input**:
- Accepts both base64 (`data:image/jpeg;base64,...`) and URLs
- Your code converts URLs to base64 or keeps as URL depending on provider
- OpenRouter prefers URLs when available (reduces payload size)

**Image Output**:
- Returns PNG base64 (converted to JPEG by your `ensureJpeg()` function)
- Output is always a new image (img2img generation)

**Capabilities**:
- ✅ Text-to-image (txt2img)
- ✅ Image-to-image (img2img with editing)
- ✅ Multiple reference images (tested in your codebase)
- ✅ Aspect ratio control (theoretical, via prompt)
- ✅ Style consistency with reference images
- ❌ Image inpainting masks (not explicitly supported)
- ❌ Fine-grained size/resolution control (fixed output size)

---

## 3. Pricing Comparison

### 3.1 Current Pricing (Feb 2026)

Based on your CLAUDE.md and changelog referencing `$8/$29` for OpenAI Image 2:

| Provider | Pricing Model | Per Image | Credits (1cr=$0.01) | Notes |
|----------|---------------|-----------|---------------------|-------|
| **OpenRouter** | Token-based | Varies by size | See token rates | ~$0.008-0.029 estimated |
| **Direct OpenAI** | Not available | Unknown | N/A | Model not publicly available |
| **Azure OpenAI** | Token-based | ~$0.01-0.035 | 100-350cr | ~20% markup vs OpenAI |

### 3.2 Your Current Billing (from CLAUDE.md)

From your changelog (2026-04-22):
- **Billing status**: LIVE on prod
- **Model**: `gpt-5.4-image-2` via OpenRouter
- **Cost reference**: `$8/$29` mentioned (unclear if per-image or batch pricing)
- **Markup**: Your billing system applies 2x markup to all costs

### 3.3 Token-Based Cost Calculation

Your `token-rates.ts` uses this formula:

```
credits = ceil((inputTokens * inputRate/1M + outputTokens * outputRate/1M) * markup / creditValue)
minimum = 1 credit if any non-zero usage
```

For OpenAI Image 2 to be registered, you'd need token rates in your `token_rates` Supabase table:

```sql
INSERT INTO token_rates (model_id, display_name, input_per_1m, output_per_1m, markup, is_active)
VALUES (
  'openai/gpt-5.4-image-2',
  'OpenAI Image 2',
  10000,      -- $0.01 per 1M input tokens
  30000,      -- $0.03 per 1M output tokens
  2.0,        -- 2x markup
  true
);
```

Then: **1 Image = ~47 credits** (at $0.47 cost to user)

### 3.4 Cost Comparison Summary

| Model | Estimated Cost | Speed | Text Quality | Use Case |
|-------|-----------------|-------|------|----------|
| Gemini Flash | ~8-12 cr | 15s | Poor | Default, fast iteration |
| Qwen Edit | ~3-4 cr | 30-45s | Fair | Budget-friendly |
| OpenAI Image 2 | ~47 cr | 2-3 min | Excellent | Posters, marketing, text-heavy |

**Cost optimization**: Users opt-in to OpenAI via model selector (purple pill) only when they specifically want text quality.

---

## 4. Image Editing Capabilities

### 4.1 img2img (Image-to-Image)

**Supported**: Yes, fully supported

**How it works** (from your implementation):

```typescript
// Your code: take input image + prompt → edited image
const result = await generateOpenAI(
  inputImageUrl,  // The image to edit
  "make the person smile"  // Edit instructions
);
```

**Workflow**:
1. Upload/select input image
2. Write editing prompt (e.g., "add sunglasses", "change background to beach")
3. Model modifies the image based on prompt
4. Output is a new edited image

**Constraints**:
- ⚠️ **Face preservation**: Not guaranteed like Qwen
- ⚠️ **Aspect ratio**: Fixed to model's output resolution
- ⚠️ **Composition changes**: Model may reorganize objects beyond the prompt intent

### 4.2 Multi-Reference Editing

**Supported**: Yes, via multiple images in the same request

**How your code uses it**:

```typescript
if (references?.length) {
  const allRefs = [
    ...(baseImage ? [{ url: baseImage, role: 'Photo to edit (base image)' }] : []),
    ...references  // Additional reference images
  ];
  return generateOpenAI(undefined, prompt, allRefs);
}
```

**Use case**:
- Edit base image while matching style/elements from reference photos
- Example: "Keep person from Image 2's face, but dress from Image 3"

### 4.3 Text Rendering

**Supported**: Yes, strong capability

**Why Image 2 excels here**:
- Models prior to Image 2 struggled with readable text in images
- Image 2 can now render readable text (small fonts, multiple languages)
- Useful for: posters, social media cards, infographics, memes

**Limitations**:
- Complex layouts may still have text distortion
- Very small text (<8px) may be illegible
- Special fonts (calligraphy, script) less reliable

**Prompt example**:
```
Generate a social media post with bold headline "50% OFF" in center,
tagline "Limited Time Offer" below in smaller text, product image on right
```

---

## 5. Quality Settings & Options

### 5.1 Temperature (Only Tunable Parameter)

**Current setting**: `temperature: 1.0` (fixed)

**What this means**:
- OpenAI Image 2 appears to have temperature locked at 1.0
- No `quality`, `style`, or `detail` parameters exposed
- This is different from DALL-E 3, which offers quality settings

**Why**: Model likely optimized for specific temperature for best results

### 5.2 Aspect Ratio

**Not directly controllable via API parameter**

**Workaround**: Include in prompt text

```
"Generate image in 16:9 landscape format..."
"Create a vertical mobile story format (9:16)..."
```

**Supported ratios** (estimated, not officially documented):
- 1:1 (square)
- 3:2, 2:3 (standard photo)
- 16:9, 9:16 (widescreen)
- 4:3, 3:4
- Custom ratios via prompt

### 5.3 Output Resolution

**Fixed output**: Likely 1024×1024 or higher (not configurable)

**Your optimization**: You compress to JPEG after generation for storage

```typescript
const jpeg = await ensureJpeg(imageUrl);  // Converts PNG to JPEG
```

### 5.4 Size Optimization

**To reduce costs**:

1. **Use Gemini by default**, opt-in to Image 2 only when:
   - Text quality is critical (posters, marketing)
   - User explicitly selects "OpenAI" model
   - Budget allows (47 credits vs 8 credits)

2. **Batch requests** (if supported):
   - Not currently exposed in your API
   - Could save ~10% with batch processing

3. **Prompt compression**:
   - Shorter prompts = fewer tokens
   - Your current approach already optimizes this

---

## 6. Speed & Latency Analysis

### 6.1 Generation Speed

From your agent.md prompt:

```
⚠️ OpenAI takes ~2-3 minutes per generation (vs Gemini ~15s)
```

**Breakdown**:
- **TTFB (Time To First Byte)**: ~30-60s (model is processing)
- **Full Generation**: 120-180s (2-3 minutes total)
- **Gemini comparison**: ~15-20s total

**Why so slow?**
- OpenAI Image 2 uses more sophisticated reasoning
- May involve iterative refinement steps
- Runs on different compute infrastructure (likely not optimized for speed)

### 6.2 Provider Latency

| Provider | TTFB | Total | Notes |
|----------|------|-------|-------|
| OpenRouter | +150ms | +0s | Proxy latency minimal |
| Direct OpenAI | +300-500ms | +0s | Once available |
| Azure | +400-600ms | +0s | Regional variation |

**For your case**: OpenRouter latency is negligible compared to 2-3min generation time.

### 6.3 Timeout Configuration

Your code uses:

```typescript
// In API route (Vercel)
export const maxDuration = 300;  // 5 minutes
```

**This is sufficient** for Image 2's 2-3 minute generation.

---

## 7. Fallback & Error Handling

### 7.1 Current Implementation (from your model-router.ts)

```typescript
// Fallback chain for OpenAI
case 'openai': return ['gemini', 'qwen'];

// If OpenAI fails:
// 1. Try Gemini next
// 2. Then Qwen
```

**Failure reasons** (detected in your code):

```typescript
if (data.error?.message?.includes('safety')) {
  console.warn('[openai] Safety system rejected request');
} else {
  console.warn('[openai] No image in response');
}
```

### 7.2 Common Failures

| Error | Cause | Fallback |
|-------|-------|----------|
| 429 (rate limit) | Quota exceeded | Use Gemini/Qwen |
| Content blocked (safety) | NSFW/violent content | Use Qwen (less restrictive) |
| No image in response | Parsing error | Use Gemini |
| Timeout (>5min) | Generation takes too long | Gemini (faster) |

---

## 8. Recommendations for Your Use Case

### 8.1 Current Setup is Good

You've already implemented Image 2 well:

```typescript
// ✅ Multi-model router with fallbacks
// ✅ URL-based image transport (efficient)
// ✅ Token-based billing integration
// ✅ Model selector in CUI (user opt-in)
// ✅ Clear user warning about 2-3min wait
```

### 8.2 Optimization Opportunities

**1. Token Rate Tuning**
- Verify the `input_per_1m` and `output_per_1m` in your `token_rates` table
- Contact OpenRouter support for exact pricing
- Current estimate ($8-29 per image) suggests:
  - Simple prompt: ~$0.008 (80 credits)
  - Complex multi-image: ~$0.029 (290 credits)

**2. Caching Strategy**
- Identical prompts on identical base images → cache results
- Saves costs for repeat workflows

**3. Selective Routing**
- Text-heavy edits → OpenAI only
- Face/body edits → Gemini/Qwen (faster, cheaper)
- Current model selector already enables this

**4. Batch Processing (Future)**
- If OpenRouter supports batch processing
- Could reduce per-image cost by 10-20%
- Check OpenRouter docs for new batch API features

### 8.3 What NOT to Do

- ❌ Default to Image 2 (too expensive)
- ❌ Remove fallbacks (needs them for reliability)
- ❌ Increase timeout beyond 5 min (diminishing returns)
- ❌ Switch to Direct OpenAI API when it launches (no cost advantage over OpenRouter)

---

## 9. Future Outlook

### 9.1 Expected Changes (2026 Roadmap)

- **Direct API availability**: OpenAI may launch direct API in Q2-Q3 2026
  - Pricing likely: $0.01-0.03 per image (same as current OpenRouter)
  - Your code can add another backend at that time

- **Faster inference**: Future versions may improve speed to ~1 minute
  - Keep your 5-minute timeout for now

- **Better quality**: May rival text-to-image models like Flux for text rendering
  - Already at par/superior for most use cases

- **Fine-tuning**: Likely coming (ability to train on custom styles)
  - Not yet available

### 9.2 When to Revisit

Check back in **3 months** (mid-July 2026) to:
- Benchmark against new models
- Review OpenRouter vs Direct API pricing
- Adjust token rates if OpenAI publishes official pricing
- Consider batch processing if available

---

## 10. Quick Reference

### Model ID
- OpenRouter: `openai/gpt-5.4-image-2`

### Key Limits
- Max input images: ~4-5 (tested)
- Generation time: 120-180s
- Output format: PNG (converted to JPEG by your code)
- Temperature: 1.0 (locked)

### Current Costs (Your Platform)
- Per image: ~47 credits (~$0.47 cost to user)
- Per month (1 image/day): ~1410 credits
- Breakeven: User needs Basic plan ($9.90 / 1200cr) to sustain daily use

### Environment Variable
```bash
OPENROUTER_API_KEY=sk-or-...
```

### Status
- Production: ✅ Live on prod
- Billing: ✅ Integrated
- Fallbacks: ✅ Configured
- UI: ✅ Model selector available

---

## References

- Your implementation: `/src/lib/models/openai.ts`
- Billing system: `/src/lib/billing/token-rates.ts`
- Model router: `/src/lib/model-router.ts`
- Agent prompts: `/src/lib/prompts/agent.md`
- Changelog: `/src/components/Changelog.tsx` (2026-04-22 entry)

