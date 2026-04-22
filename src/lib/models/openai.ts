/**
 * OpenAI gpt-5.4-image-2 backend — via OpenRouter (same endpoint as Gemini)
 */
import type { ModelBackend, GenerateImageRequest } from './types';
import { ensureJpeg } from '../gemini';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const OPENAI_MODEL = 'openai/gpt-5.4-image-2';

function toImageContent(image: string) {
  if (image.startsWith('http')) {
    return { type: 'image_url' as const, image_url: { url: image } };
  }
  const dataUrl = image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`;
  return { type: 'image_url' as const, image_url: { url: dataUrl } };
}

async function generateOpenAI(
  image: string | undefined,
  prompt: string,
  references?: { url: string; role: string }[],
): Promise<string | null> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('[openai] No OPENROUTER_API_KEY');
    return null;
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
    model: OPENAI_MODEL,
    stream: false,
    modalities: ['image', 'text'],
    temperature: 1.0,
    messages: [{ role: 'user', content: userContent }],
  };

  const bodyJson = JSON.stringify(body);
  console.log(`[openai] generating... bodySize=${(bodyJson.length / 1024).toFixed(0)}KB`);
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
    console.error(`[openai] ${res.status} (TTFB ${ttfb}ms): ${errText.slice(0, 300)}`);
    return null;
  }

  const data = await res.json();
  const totalMs = Date.now() - t0;
  console.log(`[openai] TTFB=${ttfb}ms total=${totalMs}ms (${(totalMs / 1000).toFixed(1)}s)`);

  const choice = data.choices?.[0]?.message;
  if (!choice) {
    console.error('[openai] No choice in response');
    return null;
  }

  if (choice.content && typeof choice.content === 'string') {
    console.log(`[openai] Text: ${choice.content.slice(0, 200)}`);
  }

  // Extract image — OpenRouter format
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
    // Check for safety refusal
    if (data.error?.message?.includes('safety')) {
      console.warn('[openai] Safety system rejected request');
    } else {
      console.warn('[openai] No image in response');
    }
    return null;
  }

  return ensureJpeg(imageUrl);
}

export const openaiBackend: ModelBackend = {
  id: 'openai',

  canHandle(_req: GenerateImageRequest): boolean {
    return !!process.env.OPENROUTER_API_KEY;
  },

  async generate(req: GenerateImageRequest): Promise<string | null> {
    if (req.references?.length) {
      const allRefs = [
        ...(req.image ? [{ url: req.image, role: 'Photo to edit (base image)' }] : []),
        ...req.references,
      ];
      return generateOpenAI(undefined, req.prompt, allRefs);
    }
    return generateOpenAI(req.image, req.prompt);
  },
};
