import jwt from 'jsonwebtoken'

const KLING_BASE = 'https://api-singapore.klingai.com'

export interface KlingTaskInput {
  prompt: string
  images: string[]        // Supabase public URLs or base64 (without data: prefix)
  mode?: 'std' | 'pro'
  duration?: number       // 5 or 10
  aspect_ratio?: string   // '9:16' | '16:9' | '1:1'
}

export interface KlingTaskResult {
  taskId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
}

function generateToken(): string {
  const ak = process.env.KLING_ACCESS_KEY?.trim()
  const sk = process.env.KLING_SECRET_KEY?.trim()
  if (!ak || !sk) throw new Error('KLING_ACCESS_KEY and KLING_SECRET_KEY must be set')

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256' as const, typ: 'JWT' as const }
  const payload = {
    iss: ak,
    exp: now + 1800, // 30 minutes
    nbf: now - 5,
  }
  return jwt.sign(payload, sk, { header })
}

function headers() {
  return {
    'Authorization': `Bearer ${generateToken()}`,
    'Content-Type': 'application/json',
  }
}

/** Submit a v3-omni video task. Returns the Kling task ID. */
export async function createKlingTask(input: KlingTaskInput): Promise<string> {
  const body: Record<string, unknown> = {
    model_name: 'kling-v3-omni',
    image_list: input.images.map((img, i) => ({
      image_url: img.startsWith('data:') ? img.replace(/^data:image\/\w+;base64,/, '') : img,
      // First image as first_frame → API auto-detects aspect ratio from it
      ...(i === 0 ? { type: 'first_frame' } : {}),
    })),
    prompt: input.prompt,
    mode: input.mode ?? 'std',
    sound: 'on',
  }
  // duration undefined = smart mode (API decides 3-15s)
  if (input.duration != null) {
    body.duration = String(input.duration)
  }

  const res = await fetch(`${KLING_BASE}/v1/videos/omni-video`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kling API error ${res.status}: ${text}`)
  }

  const json = await res.json()
  if (json.code !== 0) {
    throw new Error(`Kling API error: ${json.message || JSON.stringify(json)}`)
  }

  const taskId = json?.data?.task_id
  if (!taskId) throw new Error(`Kling: no task_id in response: ${JSON.stringify(json)}`)
  return taskId
}

/** Poll a task for status + result. */
export async function getKlingTask(taskId: string): Promise<KlingTaskResult> {
  const res = await fetch(`${KLING_BASE}/v1/videos/omni-video/${taskId}`, {
    headers: headers(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kling API error ${res.status}: ${text}`)
  }

  const json = await res.json()
  if (json.code !== 0) {
    throw new Error(`Kling API error: ${json.message || JSON.stringify(json)}`)
  }

  const data = json?.data

  const rawStatus: string = data?.task_status ?? 'submitted'
  let status: KlingTaskResult['status'] = 'pending'
  if (rawStatus === 'succeed') status = 'completed'
  else if (rawStatus === 'failed') status = 'failed'
  else if (rawStatus === 'processing' || rawStatus === 'submitted') status = 'processing'

  const videoUrl: string | undefined = data?.task_result?.videos?.[0]?.url ?? undefined

  return {
    taskId,
    status,
    videoUrl,
    error: data?.task_status_msg || undefined,
  }
}
