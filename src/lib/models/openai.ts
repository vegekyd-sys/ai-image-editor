/**
 * OpenAI Image 2 backend — dual provider: PiAPI (default) / OpenRouter (fallback)
 *
 * PiAPI: /v1/images/edits (img2img) + /v1/images/generations (txt2img)
 * OpenRouter: /v1/chat/completions (unified)
 */
import type { ModelBackend, GenerateImageRequest, TokenUsage } from './types';
import { ensureJpeg } from '../gemini';

// ── Provider selection ───────────────────────────────────────────
const PROVIDER = (process.env.OPENAI_IMAGE_PROVIDER || (process.env.PIAPI_API_KEY ? 'piapi' : 'openrouter')) as 'piapi' | 'openrouter';

// ── PiAPI constants ──────────────────────────────────────────────
const PIAPI_BASE = 'https://api.piapi.ai/v1';
const PIAPI_MODEL = 'gpt-image-2-preview';

// ── OpenRouter constants ─────────────────────────────────────────
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'openai/gpt-5.4-image-2';

// ── Shared helpers ───────────────────────────────────────────────

function aspectRatioToSize(ar?: string): string {
  if (!ar) return 'auto';
  const [w, h] = ar.split(':').map(Number);
  if (!w || !h) return 'auto';
  if (w / h > 1.2) return '1536x1024';
  if (h / w > 1.2) return '1024x1536';
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

async function generatePiAPI(
  image: string | undefined,
  prompt: string,
  references?: { url: string; role: string }[],
  aspectRatio?: string,
): Promise<{ image: string | null; usage?: TokenUsage }> {
  const apiKey = process.env.PIAPI_API_KEY;
  if (!apiKey) {
    console.warn('[openai/piapi] No PIAPI_API_KEY');
    return { image: null };
  }

  const headers = { 'Authorization': `Bearer ${apiKey}` };
  const size = aspectRatioToSize(aspectRatio);
  const hasImage = !!(image || references?.length);
  const t0 = Date.now();

  let res: Response;

  if (hasImage) {
    // img2img: /v1/images/edits (multipart form)
    const form = new FormData();
    form.append('model', PIAPI_MODEL);
    form.append('prompt', prompt);
    form.append('quality', 'low');
    form.append('size', size);

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
    const body = { model: PIAPI_MODEL, prompt, quality: 'low', size, moderation: 'low' };
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

  const jpeg = await ensureJpeg(resultDataUrl);
  return { image: jpeg };
}

// ── OpenRouter implementation (preserved) ────────────────────────

function toImageContent(image: string) {
  if (image.startsWith('http')) {
    return { type: 'image_url' as const, image_url: { url: image } };
  }
  const dataUrl = image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`;
  return { type: 'image_url' as const, image_url: { url: dataUrl } };
}

async function generateOpenRouter(
  image: string | undefined,
  prompt: string,
  references?: { url: string; role: string }[],
): Promise<{ image: string | null; usage?: TokenUsage }> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('[openai/openrouter] No OPENROUTER_API_KEY');
    return { image: null };
  }

  const userContent: Array<Record<string, unknown>> = [];

  if (references?.length) {
    for (const ref of references) {
      userContent.push(toImageContent(ref.url));
      userContent.push({ type: 'text', text: `[Reference: ${ref.role}]` });
    }
  } else if (image) {
    userContent.push(toImageContent(image));
  }
  userContent.push({ type: 'text', text: prompt });

  const body: Record<string, unknown> = {
    model: OPENROUTER_MODEL,
    stream: false,
    modalities: ['image', 'text'],
    temperature: 1.0,
    messages: [{ role: 'user', content: userContent }],
  };

  const bodyJson = JSON.stringify(body);
  console.log(`[openai/openrouter] generating... bodySize=${(bodyJson.length / 1024).toFixed(0)}KB`);
  const t0 = Date.now();

  const res = await fetch(OPENROUTER_BASE, {
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
  } : undefined;
  if (usage) console.log(`[openai/openrouter] usage: in=${usage.inputTokens} out=${usage.outputTokens}`);

  const choice = data.choices?.[0]?.message;
  if (!choice) {
    console.error('[openai/openrouter] No choice in response');
    return { image: null, usage };
  }

  if (choice.content && typeof choice.content === 'string') {
    console.log(`[openai/openrouter] Text: ${choice.content.slice(0, 200)}`);
  }

  let imageUrl: string | undefined;
  if (choice.images && Array.isArray(choice.images)) {
    for (const img of choice.images) {
      imageUrl = img.image_url?.url || img.url;
      if (imageUrl) break;
    }
  }
  if (!imageUrl && Array.isArray(choice.content)) {
    for (const part of choice.content) {
      if (part.type === 'image_url') {
        imageUrl = part.image_url?.url || part.url;
        if (imageUrl) break;
      }
    }
  }

  if (!imageUrl) {
    if (data.error?.message?.includes('safety')) {
      console.warn('[openai/openrouter] Safety system rejected request');
    } else {
      console.warn('[openai/openrouter] No image in response');
    }
    return { image: null, usage };
  }

  const jpeg = await ensureJpeg(imageUrl);
  return { image: jpeg, usage };
}

// ── Backend export ───────────────────────────────────────────────

export const openaiBackend: ModelBackend = {
  id: 'openai',

  canHandle(_req: GenerateImageRequest): boolean {
    if (PROVIDER === 'piapi') return !!process.env.PIAPI_API_KEY;
    return !!process.env.OPENROUTER_API_KEY;
  },

  async generate(req: GenerateImageRequest): Promise<{ image: string | null; usage?: TokenUsage }> {
    const refs = req.references?.length
      ? [
          ...(req.image ? [{ url: req.image, role: 'Photo to edit (base image)' }] : []),
          ...req.references,
        ]
      : undefined;

    if (PROVIDER === 'piapi') {
      return generatePiAPI(refs ? undefined : req.image, req.prompt, refs, req.aspectRatio);
    }
    return generateOpenRouter(refs ? undefined : req.image, req.prompt, refs);
  },
};
