/**
 * ComfyUI SDXL text-to-image — shared by Pony and WAI backends.
 * Ported from ai-image-editor-black/src/lib/comfyui-qwen.ts (SDXL section).
 */
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// ComfyUI API helpers (with configurable baseUrl)
// ---------------------------------------------------------------------------

async function uploadImage(buf: Buffer, filename: string, baseUrl: string): Promise<string> {
  const formData = new FormData();
  formData.append('image', new Blob([new Uint8Array(buf)], { type: 'image/png' }), filename);
  formData.append('overwrite', 'true');

  const res = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`ComfyUI upload failed: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.name;
}

async function submitWorkflow(workflow: Record<string, unknown>, baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`ComfyUI submit failed: ${res.status} ${err.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.prompt_id;
}

interface ComfyOutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

class OomError extends Error {
  constructor(message: string) { super(message); this.name = 'OomError'; }
}

async function pollJob(promptId: string, baseUrl: string, maxWait = 300_000): Promise<ComfyOutputImage> {
  const interval = 1_000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await fetch(`${baseUrl}/history/${promptId}`);
    const hist = await res.json();
    if (promptId in hist) {
      const entry = hist[promptId];
      const status = entry.status?.status_str;
      if (status === 'error') {
        const msgs = JSON.stringify(entry.status?.messages || '');
        if (msgs.includes('OutOfMemory') || msgs.includes('out of memory')) {
          throw new OomError(`ComfyUI OOM: ${msgs.slice(0, 300)}`);
        }
        throw new Error(`ComfyUI job failed: ${msgs.slice(0, 300)}`);
      }
      const outputs = entry.outputs || {};
      for (const nodeId of Object.keys(outputs)) {
        const images = outputs[nodeId]?.images;
        if (images?.length) return images[0];
      }
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`ComfyUI job timeout (${maxWait / 1000}s)`);
}

async function freeVram(baseUrl: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: false, free_memory: true }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.warn(`[comfyui-sdxl] /free failed:`, e instanceof Error ? e.message : e);
  }
}

async function submitAndPoll(workflow: Record<string, unknown>, baseUrl: string): Promise<ComfyOutputImage> {
  const run = async () => {
    const promptId = await submitWorkflow(workflow, baseUrl);
    return pollJob(promptId, baseUrl);
  };
  try {
    return await run();
  } catch (e) {
    if (e instanceof OomError) {
      console.warn(`[comfyui-sdxl] OOM detected, freeing VRAM and retrying...`);
      await freeVram(baseUrl);
      return await run();
    }
    throw e;
  }
}

async function downloadImage(img: ComfyOutputImage, baseUrl: string): Promise<string> {
  const params = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || '',
    type: img.type || 'output',
  });
  const res = await fetch(`${baseUrl}/view?${params}`);
  if (!res.ok) throw new Error(`ComfyUI download failed: ${res.status}`);
  const rawBuf = Buffer.from(await res.arrayBuffer());
  const jpegBuf = await sharp(rawBuf).jpeg({ quality: 92 }).toBuffer();
  return `data:image/jpeg;base64,${jpegBuf.toString('base64')}`;
}

// ---------------------------------------------------------------------------
// SDXL Workflow builder
// ---------------------------------------------------------------------------

function buildSdxlWorkflow(
  ckptName: string,
  positivePrompt: string,
  negativePrompt: string,
  opts: { seed?: number; width?: number; height?: number; steps?: number; cfg?: number; clipSkip?: number; loader?: 'checkpoint' | 'diffusers' } = {},
): Record<string, unknown> {
  const { seed, width = 832, height = 1216, steps = 30, cfg = 6.5, clipSkip = -2, loader = 'checkpoint' } = opts;
  const actualSeed = seed ?? Math.floor(Math.random() * 999999);

  const loaderNode: Record<string, unknown> = loader === 'diffusers'
    ? { class_type: 'DiffusersLoader', inputs: { model_path: ckptName } }
    : { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckptName } };

  return {
    '1': loaderNode,
    '2': { class_type: 'CLIPSetLastLayer', inputs: { clip: ['1', 1], stop_at_clip_layer: clipSkip } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: positivePrompt } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: negativePrompt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'KSampler', inputs: {
      model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0],
      seed: actualSeed, steps, cfg, sampler_name: 'euler_ancestral', scheduler: 'normal', denoise: 1.0,
    }},
    '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'api_sdxl' } },
  };
}

// ---------------------------------------------------------------------------
// Pony text-to-image
// ---------------------------------------------------------------------------

function getPonyUrl(): string | null {
  const url = process.env.COMFYUI_PONY_URL?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

export function isPonyAvailable(): boolean {
  return !!getPonyUrl();
}

/** Detect if prompt is already in danbooru tag format */
export function isDanbooruTagFormat(prompt: string): boolean {
  const commaCount = (prompt.match(/,/g) || []).length;
  if (commaCount < 3) return false;
  const parts = prompt.split(',').map(s => s.trim()).filter(Boolean);
  const avgLen = parts.reduce((sum, p) => sum + p.length, 0) / parts.length;
  if (avgLen > 25) return false;
  const danbooruPatterns = /\b(1girl|1boy|solo|score_|rating_|source_|looking_at_viewer|upper_body|full_body|cowboy_shot|from_below|from_above|masterpiece|best_quality|absurdres|highres)\b/i;
  return danbooruPatterns.test(prompt);
}

/** Translate natural language prompt to danbooru tags via Grok-3 */
export async function translateForPony(prompt: string): Promise<string> {
  if (isDanbooruTagFormat(prompt)) {
    console.log('[pony] Prompt already in tag format, skipping translation');
    return prompt;
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    console.log('[pony] No OPENROUTER_API_KEY, skipping translation');
    return prompt;
  }

  // Load prompt template
  let ponyTranslatePrompt: string;
  try {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    ponyTranslatePrompt = readFileSync(join(process.cwd(), 'src', 'lib', 'prompts', 'pony_translate.md'), 'utf-8');
  } catch {
    console.warn('[pony] Could not load pony_translate.md, skipping translation');
    return prompt;
  }

  console.log('[pony] Translating prompt to danbooru tags...');
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'x-ai/grok-3',
        messages: [
          { role: 'system', content: ponyTranslatePrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`Translate failed: ${resp.status}`);
    const json = await resp.json();
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty result');
    console.log(`[pony] Translated: ${text.slice(0, 120)}...`);
    return text;
  } catch (e) {
    console.error('[pony] Translation failed, using original:', e instanceof Error ? e.message : e);
    return prompt;
  }
}

// Eye fix tags (verified effective in A/B testing — prevents asymmetrical/ugly eyes)
const PONY_EYE_FIX_POSITIVE = 'beautiful detailed eyes, perfect symmetrical eyes, detailed pupils';
const PONY_EYE_FIX_NEGATIVE = 'bad eyes, asymmetrical eyes, mismatched pupils, extra pupils, ugly eyes, cross-eyed, uneven eyes';

/** Generate text-to-image with Pony SDXL via ComfyUI */
export async function generateTextToImageWithPony(
  prompt: string,
  negativePrompt = `score_4, score_3, score_2, score_1, lowres, worst quality, low quality, bad anatomy, bad hands, deformed, ${PONY_EYE_FIX_NEGATIVE}`,
): Promise<string | null> {
  const ponyUrl = getPonyUrl();
  if (!ponyUrl) return null;

  const t0 = Date.now();
  const hasScoreTags = prompt.toLowerCase().includes('score_');
  const hasEyeFix = prompt.toLowerCase().includes('detailed eyes');
  const basePrompt = hasScoreTags ? prompt : `score_9, score_8_up, score_7_up, ${prompt}`;
  const finalPrompt = hasEyeFix ? basePrompt : `${basePrompt}, ${PONY_EYE_FIX_POSITIVE}`;
  const ckpt = process.env.COMFYUI_PONY_MODEL || 'fucktasticAnimePony_v22';

  console.log(`[pony] Starting text-to-image (${ckpt}), prompt: ${finalPrompt.slice(0, 120)}...`);
  try {
    const workflow = buildSdxlWorkflow(ckpt, finalPrompt, negativePrompt, { steps: 25, cfg: 7, clipSkip: -2, loader: 'diffusers' });
    const outputImg = await submitAndPoll(workflow, ponyUrl);
    const result = await downloadImage(outputImg, ponyUrl);
    console.log(`[pony] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return result;
  } catch (e) {
    console.error(`[pony] Error after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// WAI text-to-image
// ---------------------------------------------------------------------------

function getWaiUrl(): string | null {
  const url = process.env.COMFYUI_WAI_URL?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

export function isWaiAvailable(): boolean {
  return !!getWaiUrl();
}

/** Translate natural language prompt to WAI-compatible tags via Grok-3 */
export async function translateForWai(prompt: string): Promise<string> {
  if (isDanbooruTagFormat(prompt)) {
    console.log('[wai] Prompt already in tag format, skipping translation');
    return prompt;
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    console.log('[wai] No OPENROUTER_API_KEY, skipping translation');
    return prompt;
  }

  let waiTranslatePrompt: string;
  try {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    waiTranslatePrompt = readFileSync(join(process.cwd(), 'src', 'lib', 'prompts', 'wai_translate.md'), 'utf-8');
  } catch {
    console.warn('[wai] Could not load wai_translate.md, skipping translation');
    return prompt;
  }

  console.log('[wai] Translating prompt to WAI tags...');
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'x-ai/grok-3',
        messages: [
          { role: 'system', content: waiTranslatePrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`Translate failed: ${resp.status}`);
    const json = await resp.json();
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty result');
    console.log(`[wai] Translated: ${text.slice(0, 120)}...`);
    return text;
  } catch (e) {
    console.error('[wai] Translation failed, using original:', e instanceof Error ? e.message : e);
    return prompt;
  }
}

/** Generate text-to-image with WAI-Illustrious-SDXL via ComfyUI */
export async function generateTextToImageWithWai(
  prompt: string,
  negativePrompt = 'lowres, worst quality, low quality, normal quality, bad quality, sketch, censor',
): Promise<string | null> {
  const waiUrl = getWaiUrl();
  if (!waiUrl) return null;

  const t0 = Date.now();
  const ckpt = process.env.COMFYUI_WAI_CHECKPOINT || 'waiIllustriousSDXL_v160.safetensors';

  console.log(`[wai] Starting text-to-image (${ckpt}), prompt: ${prompt.slice(0, 120)}...`);
  try {
    const workflow = buildSdxlWorkflow(ckpt, prompt, negativePrompt, { steps: 30, cfg: 6.5, clipSkip: -2 });
    const outputImg = await submitAndPoll(workflow, waiUrl);
    const result = await downloadImage(outputImg, waiUrl);
    console.log(`[wai] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return result;
  } catch (e) {
    console.error(`[wai] Error after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, e instanceof Error ? e.message : e);
    return null;
  }
}
