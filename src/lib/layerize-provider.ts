export const LAYERIZE_TEXT_PROMPT = 'Separate the major people, objects, and all visible headings, labels and wordmarks, including text printed on objects, into distinct layers. Text must be isolated on transparent layers, with clean object/background pixels beneath it. Preserve original lettering, appearance, placement and occlusion. Name layers in the language of the user request.';
export const LAYERIZE_PROVIDER_MODEL = 'doubao-seedream-5.5-layerize';
export const LAYERIZE_MODEL = 'seedream-5.5-layerize';
export type LayerizeQuality = 'auto' | '1K' | '1.5K' | '2K';
export interface LayerizeInput { imageUrl: string; prompt?: string; maxOutputs?: number; quality?: LayerizeQuality; editableText?: boolean }
export interface LayerizeProviderTask {
  id: string; model: string; status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  result_data?: Array<{ url: string; z_index: number; name?: string; description?: string; background: string;
    bounding_box?: { absolute: number[] }; text_recognition?: { text?: string; lines?: Array<{ bounding_box?: { absolute: number[] }; runs?: Array<{ text?: string; style?: Record<string, unknown> }> }> } }>;
  error?: { code?: string; message?: string }; usage?: Record<string, unknown>;
}
export class LayerizeProviderError extends Error {
  constructor(message: string, readonly uncertain = false, readonly taskId?: string) { super(message); }
}
export function layerizeRequest(input: LayerizeInput) {
  const url = new URL(input.imageUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Layerize requires an uploaded HTTPS original.');
  const n = input.maxOutputs ?? 8;
  if (!Number.isSafeInteger(n) || n < 2 || n > 100) throw new Error('maxOutputs must be 2–100 including the background.');
  const quality = input.quality ?? 'auto';
  if (!['auto', '1K', '1.5K', '2K'].includes(quality)) throw new Error('Layerize quality must be auto, 1K, 1.5K or 2K.');
  return { model: LAYERIZE_PROVIDER_MODEL, image_urls: [input.imageUrl], n, quality,
    ...(input.prompt?.trim() ? { prompt: input.prompt.trim() } : {}),
    prompt_priority: 'standard', output_format: 'png', model_params: { text_recognition: true } };
}
function headers() {
  if (!process.env.EVOLINK_API_KEY?.trim()) throw new Error('EvoLink is not configured; no task was submitted.');
  return { Authorization: `Bearer ${process.env.EVOLINK_API_KEY.trim()}`, 'Content-Type': 'application/json' };
}
function parseTask(value: unknown, expectedId?: string): LayerizeProviderTask {
  const task = value as LayerizeProviderTask;
  if (!task || !/^[a-zA-Z0-9_-]{1,160}$/.test(task.id ?? '') || task.model !== LAYERIZE_PROVIDER_MODEL || (expectedId && task.id !== expectedId)
    || !['pending', 'processing', 'completed', 'failed', 'cancelled'].includes(task.status)) throw new LayerizeProviderError('Provider receipt is invalid. Retain the request; do not submit again.', true, expectedId);
  return task;
}
export async function submitLayerize(input: LayerizeInput): Promise<LayerizeProviderTask> {
  const body = layerizeRequest(input);
  const auth = headers();
  let response: Response;
  try { response = await fetch('https://api.evolink.ai/v1/images/generations', { method: 'POST', headers: auth, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(60_000) }); }
  catch { throw new LayerizeProviderError('Submission outcome is unknown. Inspect this request before any new submission.', true); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new LayerizeProviderError(`Layerize submission HTTP ${response.status}. Do not retry automatically.`, response.status >= 500);
  return parseTask(data, data?.id);
}
/** Read only. Transport errors leave the existing task pending rather than creating another task. */
export async function queryLayerize(taskId: string): Promise<LayerizeProviderTask> {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(taskId)) throw new Error('Invalid task ID');
  const response = await fetch(`https://api.evolink.ai/v1/tasks/${taskId}`, { headers: headers(), redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new LayerizeProviderError(`Task query HTTP ${response.status}. Query the same task only.`, true, taskId);
  return parseTask(await response.json(), taskId);
}
