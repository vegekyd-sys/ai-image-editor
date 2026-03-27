/**
 * Foldin (SeeDance 2.0) Video API Client
 *
 * API Documentation: Gateway API for foldin model
 * Base URL: https://aistudio.foldin.cn/api/gateway
 */

const GATEWAY_BASE_URL = process.env.FOLDIN_GATEWAY_URL || 'https://aistudio.foldin.cn/api/gateway';
const ACCESS_KEY = process.env.FOLDIN_ACCESS_KEY;

if (!ACCESS_KEY) {
  console.warn('[foldin] FOLDIN_ACCESS_KEY not set, foldin provider will not work');
}

export interface FoldinCreateTaskInput {
  prompt: string;
  images: string[];  // Public URLs
  duration?: number; // 3-15s
  ratio?: string;    // "16:9", "9:16", "1:1"
  resolution?: string; // "480P" or "720P"
}

export interface FoldinTaskStatus {
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELED';
  error: string | null;
  notice: string | null;
  stage: string;
  total: number;
  ready: number;
  failed: number;
}

export interface FoldinOutput {
  id: string;
  asset_id: string;
  attachment_id: string;
  object_url: string | null;
  upstream_object_url: string | null;
  source: 'archive' | 'upstream_pending_archive' | 'upstream_fallback';
}

/**
 * Create a video generation task
 * Returns requestId for polling
 */
export async function createFoldinTask(input: FoldinCreateTaskInput): Promise<string> {
  if (!ACCESS_KEY) {
    throw new Error('FOLDIN_ACCESS_KEY not configured');
  }

  const { prompt, images, duration, ratio, resolution } = input;

  // Build references array from images
  const references = images.map(url => ({
    type: 'image' as const,
    url,
  }));

  const payload: any = {
    model: 'foldin',
    prompt,
    references,
  };

  if (duration) payload.duration = duration;
  if (ratio) payload.ratio = ratio;
  if (resolution) payload.resolution = resolution;

  console.log(`[foldin] Creating task: ${images.length} images, duration=${duration ?? 'auto'}, ratio=${ratio ?? 'auto'}`);

  const response = await fetch(`${GATEWAY_BASE_URL}/v1/videos/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Foldin API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const requestId = data.requestId || data.request_id || data.data?.requestId;

  if (!requestId) {
    throw new Error(`Foldin API did not return requestId: ${JSON.stringify(data)}`);
  }

  console.log(`[foldin] Task created: ${requestId}`);
  return requestId;
}

/**
 * Query task status
 */
export async function getFoldinTaskStatus(requestId: string): Promise<FoldinTaskStatus> {
  if (!ACCESS_KEY) {
    throw new Error('FOLDIN_ACCESS_KEY not configured');
  }

  const response = await fetch(`${GATEWAY_BASE_URL}/v1/tasks/${requestId}`, {
    headers: {
      'Authorization': `Bearer ${ACCESS_KEY}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Foldin status query error: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  const data = result.data || result;

  return {
    status: data.status || 'PENDING',
    error: data.error || null,
    notice: data.notice || null,
    stage: data.stage || '',
    total: data.total || 0,
    ready: data.ready || 0,
    failed: data.failed || 0,
  };
}

/**
 * Query task outputs (video URL)
 */
export async function getFoldinTaskOutputs(requestId: string): Promise<FoldinOutput[]> {
  if (!ACCESS_KEY) {
    throw new Error('FOLDIN_ACCESS_KEY not configured');
  }

  const response = await fetch(`${GATEWAY_BASE_URL}/v1/tasks/${requestId}/outputs`, {
    headers: {
      'Authorization': `Bearer ${ACCESS_KEY}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Foldin outputs query error: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  const data = result.data || result;

  return data.outputs || [];
}

/**
 * Poll task until completion (with timeout)
 * Returns video URL when ready
 */
export async function pollFoldinTask(
  requestId: string,
  options: {
    maxWaitMs?: number;
    intervalMs?: number;
    onProgress?: (status: FoldinTaskStatus) => void;
  } = {}
): Promise<string> {
  const { maxWaitMs = 300_000, intervalMs = 4000, onProgress } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const status = await getFoldinTaskStatus(requestId);
    onProgress?.(status);

    if (status.status === 'SUCCESS') {
      // Query outputs to get video URL
      const outputs = await getFoldinTaskOutputs(requestId);
      if (outputs.length === 0) {
        throw new Error('Foldin task succeeded but no outputs returned');
      }

      const output = outputs[0];
      // Prefer object_url, fallback to upstream_object_url
      const videoUrl = output.object_url || output.upstream_object_url;

      if (!videoUrl) {
        throw new Error('Foldin task succeeded but no video URL available');
      }

      console.log(`[foldin] Task completed: ${requestId}, video=${videoUrl}`);
      return videoUrl;
    }

    if (status.status === 'FAILED') {
      throw new Error(`Foldin task failed: ${status.error || 'Unknown error'}`);
    }

    if (status.status === 'CANCELED') {
      throw new Error('Foldin task was canceled');
    }

    // Still PENDING or RUNNING, wait and retry
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Foldin task timeout after ${maxWaitMs}ms`);
}
