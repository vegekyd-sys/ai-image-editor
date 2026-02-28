const PIAPI_BASE = 'https://api.piapi.ai/api/v1'

export interface KlingTaskInput {
  prompt: string
  images: string[]        // Supabase public URLs, referenced as @image_1, @image_2 ...
  version?: string        // '3.0' (default) or 'o1'
  duration?: number       // 3–15, default 10
  aspect_ratio?: string   // '9:16' | '16:9' | '1:1'
  enable_audio?: boolean
  resolution?: string     // '720p' | '1080p'
}

export interface KlingTaskResult {
  taskId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
}

function headers() {
  return {
    'x-api-key': process.env.PIAPI_API_KEY!,
    'Content-Type': 'application/json',
  }
}

/** Submit an image-to-video task. Returns the PiAPI task ID. */
export async function createKlingTask(input: KlingTaskInput): Promise<string> {
  const body = {
    model: 'kling',
    task_type: 'omni_video_generation',
    input: {
      prompt: input.prompt,
      images: input.images,
      version: input.version ?? '3.0',
      duration: input.duration ?? 10,
      aspect_ratio: input.aspect_ratio ?? '9:16',
      enable_audio: input.enable_audio ?? true,
      resolution: input.resolution ?? '720p',
    },
  }

  const res = await fetch(`${PIAPI_BASE}/task`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`PiAPI error ${res.status}: ${text}`)
  }

  const json = await res.json()
  const taskId = json?.data?.task_id
  if (!taskId) throw new Error(`PiAPI: no task_id in response: ${JSON.stringify(json)}`)
  return taskId
}

/** Poll a task for status + result. */
export async function getKlingTask(taskId: string): Promise<KlingTaskResult> {
  const res = await fetch(`${PIAPI_BASE}/task/${taskId}`, {
    headers: headers(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`PiAPI error ${res.status}: ${text}`)
  }

  const json = await res.json()
  const data = json?.data

  const rawStatus: string = data?.status ?? 'pending'
  let status: KlingTaskResult['status'] = 'pending'
  if (rawStatus === 'completed') status = 'completed'
  else if (rawStatus === 'failed') status = 'failed'
  else if (rawStatus === 'processing' || rawStatus === 'running') status = 'processing'

  const videoUrl: string | undefined = data?.output?.video ?? undefined

  return {
    taskId,
    status,
    videoUrl,
    error: data?.error?.message || undefined,
  }
}
