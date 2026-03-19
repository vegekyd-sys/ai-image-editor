/**
 * ComfyUI Qwen Edit AIO — image editing via self-hosted ComfyUI on vast.ai.
 * Uses QwenImageIntegratedKSampler node for 4-step fast inference.
 *
 * Activated by COMFYUI_QWEN_URL env var. If not set, all exports are no-ops.
 */
import sharp from 'sharp';

const getComfyUrl = () => {
  const url = process.env.COMFYUI_QWEN_URL?.trim();
  if (!url) return null;
  return url.replace(/\/+$/, '');
};

const CHECKPOINT = () => process.env.COMFYUI_CHECKPOINT || 'Qwen-Rapid-AIO-NSFW-v23.safetensors';

/** Whether Qwen ComfyUI is configured and available */
export function isQwenAvailable(): boolean {
  return !!getComfyUrl();
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

async function resolveImageToBuffer(image: string): Promise<Buffer> {
  let raw: Buffer;
  if (image.startsWith('http')) {
    const res = await fetch(image);
    raw = Buffer.from(await res.arrayBuffer());
  } else {
    const match = image.match(/^data:image\/\w+;base64,(.+)$/);
    raw = match ? Buffer.from(match[1], 'base64') : Buffer.from(image, 'base64');
  }
  return sharp(raw)
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// ComfyUI API helpers
// ---------------------------------------------------------------------------

async function uploadImage(buf: Buffer, filename: string): Promise<string> {
  const url = getComfyUrl()!;
  const formData = new FormData();
  formData.append('image', new Blob([new Uint8Array(buf)], { type: 'image/png' }), filename);
  formData.append('overwrite', 'true');

  const res = await fetch(`${url}/upload/image`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`ComfyUI upload failed: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.name;
}

async function submitWorkflow(workflow: Record<string, unknown>): Promise<string> {
  const url = getComfyUrl()!;
  const res = await fetch(`${url}/prompt`, {
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

async function freeVram(): Promise<void> {
  const url = getComfyUrl()!;
  try {
    await fetch(`${url}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: false, free_memory: true }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.warn(`[comfyui-qwen] /free failed:`, e instanceof Error ? e.message : e);
  }
}

class OomError extends Error {
  constructor(message: string) { super(message); this.name = 'OomError'; }
}

interface ComfyOutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

async function pollJob(promptId: string, maxWait = 300_000): Promise<ComfyOutputImage> {
  const url = getComfyUrl()!;
  const interval = 1_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const res = await fetch(`${url}/history/${promptId}`);
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

async function submitAndPoll(workflow: Record<string, unknown>): Promise<ComfyOutputImage> {
  const run = async () => {
    const promptId = await submitWorkflow(workflow);
    return pollJob(promptId);
  };
  try {
    return await run();
  } catch (e) {
    if (e instanceof OomError) {
      console.warn(`[comfyui-qwen] OOM detected, freeing VRAM and retrying...`);
      await freeVram();
      return await run();
    }
    throw e;
  }
}

async function downloadImage(img: ComfyOutputImage): Promise<string> {
  const url = getComfyUrl()!;
  const params = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || '',
    type: img.type || 'output',
  });
  const res = await fetch(`${url}/view?${params}`);
  if (!res.ok) throw new Error(`ComfyUI download failed: ${res.status}`);
  const rawBuf = Buffer.from(await res.arrayBuffer());
  const jpegBuf = await sharp(rawBuf).jpeg({ quality: 92 }).toBuffer();
  return `data:image/jpeg;base64,${jpegBuf.toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Workflow builder
// ---------------------------------------------------------------------------

function buildWorkflow(imageName: string, prompt: string, seed?: number): Record<string, unknown> {
  const actualSeed = seed ?? Math.floor(Math.random() * 999999);
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CHECKPOINT() } },
    '4': { class_type: 'LoadImage', inputs: { image: imageName } },
    '5': {
      class_type: 'QwenImageIntegratedKSampler',
      inputs: {
        model: ['1', 0], clip: ['1', 1], vae: ['1', 2], image1: ['4', 0],
        positive_prompt: prompt, negative_prompt: '',
        generation_mode: '\u56fe\u751f\u56fe image-to-image',
        batch_size: 1, width: 0, height: 0, seed: actualSeed,
        steps: 4, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple',
        denoise: 1.0, auraflow_shift: 3.0, cfg_norm_strength: 1.0,
      },
    },
    '6': { class_type: 'SaveImage', inputs: { images: ['5', 0], filename_prefix: 'api_output' } },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Edit an image using ComfyUI Qwen Edit AIO.
 * Returns base64 JPEG or null on failure.
 */
export async function generateWithQwen(
  image: string,
  prompt: string,
): Promise<string | null> {
  const url = getComfyUrl();
  if (!url) {
    console.warn('[comfyui-qwen] Not configured (COMFYUI_QWEN_URL not set)');
    return null;
  }

  const t0 = Date.now();
  console.log(`[comfyui-qwen] Starting edit, prompt: ${prompt.slice(0, 120)}...`);

  try {
    const buf = await resolveImageToBuffer(image);
    const filename = `input_${Date.now()}.png`;
    const uploadedName = await uploadImage(buf, filename);
    console.log(`[comfyui-qwen] Uploaded ${(buf.length / 1024).toFixed(0)}KB`);

    const workflow = buildWorkflow(uploadedName, prompt);
    const outputImg = await submitAndPoll(workflow);
    const result = await downloadImage(outputImg);

    console.log(`[comfyui-qwen] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s, result ${(result.length / 1024).toFixed(0)}KB`);
    return result;
  } catch (e) {
    console.error(`[comfyui-qwen] Error after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, e instanceof Error ? e.message : e);
    return null;
  }
}
