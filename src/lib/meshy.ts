/**
 * Meshy API client — Image-to-3D generation.
 * Docs: https://docs.meshy.ai/api-image-to-3d
 */

const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';

function getApiKey(): string | null {
  return process.env.MESHY_API_KEY?.trim() || null;
}

export function isMeshyAvailable(): boolean {
  return !!getApiKey();
}

export interface MeshyTask {
  id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  progress: number;
  model_urls: { glb?: string; usdz?: string; obj?: string; fbx?: string };
  thumbnail_url?: string;
  created_at: number;
  started_at?: number;
  finished_at?: number;
}

/**
 * Create an image-to-3D task. Returns the task ID.
 * imageUrl can be a public URL or a base64 data URI.
 */
export async function createImageTo3DTask(imageUrl: string): Promise<string> {
  const key = getApiKey();
  if (!key) throw new Error('MESHY_API_KEY not configured');

  const res = await fetch(`${MESHY_BASE}/image-to-3d`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_url: imageUrl,
      ai_model: 'meshy-6',
      should_texture: true,
      enable_pbr: true,
      target_formats: ['glb', 'usdz'],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Meshy create task failed: ${res.status} ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.result; // task ID
}

/**
 * Get current status of an image-to-3D task.
 */
export async function getTaskStatus(taskId: string): Promise<MeshyTask> {
  const key = getApiKey();
  if (!key) throw new Error('MESHY_API_KEY not configured');

  const res = await fetch(`${MESHY_BASE}/image-to-3d/${taskId}`, {
    headers: { 'Authorization': `Bearer ${key}` },
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Meshy get status failed: ${res.status} ${err.slice(0, 300)}`);
  }

  return res.json();
}
