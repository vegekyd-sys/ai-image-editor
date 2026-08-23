/**
 * OpenAI Image 2 backend — Azure primary / OpenRouter backup / PiAPI override
 *
 * Azure: /images/edits + /images/generations (same OpenAI format, different auth)
 * PiAPI: /v1/images/edits + /v1/images/generations
 * OpenRouter: /v1/images (dedicated Image API)
 */
import type { ImageBackground, ModelBackend, GenerateImageRequest, TokenUsage } from './types';
import {
  OPENROUTER_IMAGE_API_URL,
  OPENROUTER_GPT_IMAGE_2_MODEL,
  buildOpenRouterImageRequest,
  readOpenRouterProviderCost,
  resolveOpenAIImageProviderOrder,
} from './openai-image-provider';
import { normalizeOpenAIImageOutput } from './openai-image-output';

// ── Provider selection ───────────────────────────────────────────
const PROVIDER_ORDER = resolveOpenAIImageProviderOrder();

// ── Azure constants ─────────────────────────────────────────────
const AZURE_EDITS_URL = process.env.AZURE_OPENAI_EDITS_URL || 'https://meo-ultron.openai.azure.com/openai/deployments/gpt-image-2/images/edits?api-version=2025-04-01-preview';
const AZURE_GENERATIONS_URL = process.env.AZURE_OPENAI_GENERATIONS_URL || 'https://meo-ultron.openai.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01';

// ── PiAPI constants ──────────────────────────────────────────────
const PIAPI_BASE = 'https://api.piapi.ai/v1';
const PIAPI_MODEL = 'gpt-image-2-preview';

// ── OpenRouter constants ─────────────────────────────────────────
const OPENROUTER_MODEL = OPENROUTER_GPT_IMAGE_2_MODEL;

// ── Shared helpers ───────────────────────────────────────────────

function aspectRatioToSize(ar?: string, isTxt2img = false): string {
  if (!ar) return 'auto';
  const [w, h] = ar.split(':').map(Number);
  if (!w || !h) return 'auto';
  const ratio = w / h;
  if (ratio > 1.5 && isTxt2img) return '1792x1024';
  if (ratio > 1.2) return '1536x1024';
  if (1 / ratio > 1.5 && isTxt2img) return '1024x1792';
  if (1 / ratio > 1.2) return '1024x1536';
  return '1024x1024';
}

async function imageToBlob(image: string): Promise<Blob> {
  if (image.startsWith('http')) {
    const res = await fetch(image);
    return new Blob([await res.arrayBuffer()], { type: res.headers.get('content-type') || 'image/jpeg' });
  }
  const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
  if (match) {
    const bytes = Buffer.from(match[2], 'base64');
    return new Blob([bytes], { type: match[1] });
  }
  const bytes = Buffer.from(image, 'base64');
  return new Blob([bytes], { type: 'image/jpeg' });
}

// ── PiAPI implementation ─────────────────────────────────────────

// ── Azure implementation ────────────────────────────────────────

async function generateAzure(
  image: string | undefined,
  prompt: string,
  references?: { url: string; role: string }[],
  aspectRatio?: string,
  background?: ImageBackground,
): Promise<{ image: string | null; usage?: TokenUsage }> {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[openai/azure] No AZURE_OPENAI_API_KEY');
    return { image: null };
  }

  const headers: Record<string, string> = { 'api-key': apiKey };
  const hasImage = !!(image || references?.length);
  const size = aspectRatioToSize(aspectRatio, !hasImage);
  const t0 = Date.now();

  let res: Response;

  if (hasImage) {
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('quality', 'low');
    form.append('size', size);
    form.append('moderation', 'low');
    if (background) form.append('background', background);
    if (background === 'transparent') form.append('output_format', 'png');

    if (references?.length) {
      for (const ref of references) {
        const blob = await imageToBlob(ref.url);
        form.append('image[]', blob, 'ref.png');
      }
    } else if (image) {
      const blob = await imageToBlob(image);
      form.append('image[]', blob, 'input.png');
    }

    console.log(`[openai/azure] edits size=${size} images=${references?.length || 1}`);
    res = await fetch(AZURE_EDITS_URL, { method: 'POST', headers, body: form });
  } else {
    const body = {
      prompt,
      quality: 'low',
      size,
      moderation: 'low',
      ...(background ? { background } : {}),
      ...(background === 'transparent' ? { output_format: 'png' } : {}),
    };
    console.log(`[openai/azure] generations size=${size}`);
    res = await fetch(AZURE_GENERATIONS_URL, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const totalMs = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[openai/azure] ${res.status} (${totalMs}ms): ${errText.slice(0, 300)}`);
    return { image: null };
  }

  const data = await res.json();

  if (data.error) {
    const code = data.error.code || data.error.type || 'unknown';
    const msg = data.error.message || '';
    console.error(`[openai/azure] Error in body: ${code} - ${msg.slice(0, 200)} (${totalMs}ms)`);
    return { image: null };
  }

  console.log(`[openai/azure] total=${(totalMs / 1000).toFixed(1)}s`);

  const imgData = data.data?.[0];
  if (!imgData) {
    console.warn('[openai/azure] No image in response');
    return { image: null };
  }

  let resultDataUrl: string;
  if (imgData.b64_json) {
    resultDataUrl = `data:image/png;base64,${imgData.b64_json}`;
  } else if (imgData.url) {
    const imgRes = await fetch(imgData.url);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    resultDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  } else {
    console.warn('[openai/azure] No b64_json or url in response');
    return { image: null };
  }

  const normalized = await normalizeOpenAIImageOutput(resultDataUrl, background);
  if (!normalized && background === 'transparent') {
    console.warn('[openai/azure] Provider response did not contain real PNG/WebP transparency');
  }
  return { image: normalized };
}

// ── PiAPI implementation ────────────────────────────────────────

async function generatePiAPI(
  image: string | undefined,
  prompt: string,
  references?: { url: string; role: string }[],
  aspectRatio?: string,
  background?: ImageBackground,
): Promise<{ image: string | null; usage?: TokenUsage }> {
  const apiKey = process.env.PIAPI_API_KEY;
  if (!apiKey) {
    console.warn('[openai/piapi] No PIAPI_API_KEY');
    return { image: null };
  }

  const headers = { 'Authorization': `Bearer ${apiKey}` };
  const hasImage = !!(image || references?.length);
  const size = aspectRatioToSize(aspectRatio, !hasImage);
  const t0 = Date.now();

  let res: Response;

  if (hasImage) {
    // img2img: /v1/images/edits (multipart form)
    const form = new FormData();
    form.append('model', PIAPI_MODEL);
    form.append('prompt', prompt);
    form.append('quality', 'low');
    form.append('size', size);
    if (background) form.append('background', background);
    if (background === 'transparent') form.append('output_format', 'png');

    if (references?.length) {
      for (const ref of references) {
        const blob = await imageToBlob(ref.url);
        form.append('image[]', blob, 'ref.png');
      }
    } else if (image) {
      const blob = await imageToBlob(image);
      form.append('image[]', blob, 'input.png');
    }

    const bodySize = references?.length || 0;
    console.log(`[openai/piapi] edits size=${size} images=${bodySize || 1}`);
    res = await fetch(`${PIAPI_BASE}/images/edits`, { method: 'POST', headers, body: form });
  } else {
    // txt2img: /v1/images/generations (JSON)
    const body = {
      model: PIAPI_MODEL,
      prompt,
      quality: 'low',
      size,
      moderation: 'low',
      ...(background ? { background } : {}),
      ...(background === 'transparent' ? { output_format: 'png' } : {}),
    };
    console.log(`[openai/piapi] generations size=${size}`);
    res = await fetch(`${PIAPI_BASE}/images/generations`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const totalMs = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[openai/piapi] ${res.status} (${totalMs}ms): ${errText.slice(0, 300)}`);
    return { image: null };
  }

  const data = await res.json();
  console.log(`[openai/piapi] total=${(totalMs / 1000).toFixed(1)}s`);

  // PiAPI charges fixed $0.10/image — log tokens for debugging but don't return usage
  // (no usage → agent falls back to per-action billing via credit_pricing.edit_image_openai)
  if (data.usage) {
    const inT = data.usage.input_tokens ?? data.usage.prompt_tokens ?? 0;
    const outT = data.usage.output_tokens ?? data.usage.completion_tokens ?? 0;
    console.log(`[openai/piapi] tokens: in=${inT} out=${outT} (billed per-action, not per-token)`);
  }

  const imgData = data.data?.[0];
  if (!imgData) {
    console.warn('[openai/piapi] No image in response');
    return { image: null };
  }

  let resultDataUrl: string;
  if (imgData.b64_json) {
    resultDataUrl = `data:image/png;base64,${imgData.b64_json}`;
  } else if (imgData.url) {
    const imgRes = await fetch(imgData.url);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    resultDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  } else {
    console.warn('[openai/piapi] No b64_json or url in response');
    return { image: null };
  }

  const normalized = await normalizeOpenAIImageOutput(resultDataUrl, background);
  if (!normalized && background === 'transparent') {
    console.warn('[openai/piapi] Provider response did not contain real PNG/WebP transparency');
  }
  return { image: normalized };
}

// ── OpenRouter implementation (preserved) ────────────────────────

async function generateOpenRouter(
  image: string | undefined,
  prompt: string,
  references?: { url: string; role: string }[],
  aspectRatio?: string,
  background?: ImageBackground,
): Promise<{ image: string | null; usage?: TokenUsage }> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('[openai/openrouter] No OPENROUTER_API_KEY');
    return { image: null };
  }

  const body = buildOpenRouterImageRequest({ image, prompt, references, aspectRatio, background });

  const bodyJson = JSON.stringify(body);
  console.log(`[openai/openrouter] generating... bodySize=${(bodyJson.length / 1024).toFixed(0)}KB`);
  const t0 = Date.now();

  const res = await fetch(OPENROUTER_IMAGE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: bodyJson,
  });
  const ttfb = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[openai/openrouter] ${res.status} (TTFB ${ttfb}ms): ${errText.slice(0, 300)}`);
    return { image: null };
  }

  const data = await res.json();
  const totalMs = Date.now() - t0;
  console.log(`[openai/openrouter] TTFB=${ttfb}ms total=${totalMs}ms (${(totalMs / 1000).toFixed(1)}s)`);

  const usage: TokenUsage | undefined = data.usage ? {
    inputTokens: data.usage.prompt_tokens ?? 0,
    outputTokens: data.usage.completion_tokens ?? 0,
    modelId: OPENROUTER_MODEL,
    providerCostUsd: readOpenRouterProviderCost(data.usage),
  } : undefined;
  if (usage) console.log(`[openai/openrouter] usage: in=${usage.inputTokens} out=${usage.outputTokens}`);

  const imageData = data.data?.[0];
  const b64Json = imageData?.b64_json;
  if (!b64Json) {
    if (data.error?.message?.includes('safety')) {
      console.warn('[openai/openrouter] Safety system rejected request');
    } else {
      console.warn('[openai/openrouter] No image in response');
    }
    return { image: null, usage };
  }

  const mediaType = imageData.media_type || 'image/png';
  const normalized = await normalizeOpenAIImageOutput(`data:${mediaType};base64,${b64Json}`, background);
  if (!normalized && background === 'transparent') {
    console.warn('[openai/openrouter] Provider response did not contain real PNG/WebP transparency');
  }
  return { image: normalized, usage };
}

// ── Backend export ───────────────────────────────────────────────

export const openaiBackend: ModelBackend = {
  id: 'openai',

  canHandle(_req: GenerateImageRequest): boolean {
    return PROVIDER_ORDER.some(provider => {
      if (provider === 'azure') return Boolean(process.env.AZURE_OPENAI_API_KEY?.trim());
      if (provider === 'piapi') return Boolean(process.env.PIAPI_API_KEY?.trim());
      return Boolean(process.env.OPENROUTER_API_KEY?.trim());
    });
  },

  async generate(req: GenerateImageRequest): Promise<{ image: string | null; usage?: TokenUsage }> {
    const refs = req.references?.length
      ? [
          ...(req.image ? [{ url: req.image, role: 'Photo to edit (base image)' }] : []),
          ...req.references,
        ]
      : undefined;

    let lastResult: { image: string | null; usage?: TokenUsage } = { image: null };
    for (const provider of PROVIDER_ORDER) {
      if (provider === 'azure') {
        lastResult = await generateAzure(
          refs ? undefined : req.image,
          req.prompt,
          refs,
          req.aspectRatio,
          req.background,
        );
      } else if (provider === 'piapi') {
        lastResult = await generatePiAPI(
          refs ? undefined : req.image,
          req.prompt,
          refs,
          req.aspectRatio,
          req.background,
        );
      } else {
        lastResult = await generateOpenRouter(
          refs ? undefined : req.image,
          req.prompt,
          refs,
          req.aspectRatio,
          req.background,
        );
      }
      if (lastResult.image) return lastResult;
      if (provider === 'azure' && PROVIDER_ORDER.includes('openrouter')) {
        console.warn('[openai] Azure returned no image; retrying with OpenRouter backup');
      }
    }
    return lastResult;
  },
};
