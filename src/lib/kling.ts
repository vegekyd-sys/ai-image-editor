import jwt from 'jsonwebtoken'

const KLING_BASE = process.env.KLING_API_BASE || 'https://api-beijing.klingai.com'

export interface KlingTaskInput {
  prompt: string
  images: string[]        // Supabase public URLs or base64 (without data: prefix)
  mode?: 'std' | 'pro'
  duration?: number       // 5 or 10
  aspect_ratio?: string   // '9:16' | '16:9' | '1:1'
  // Video editing (video_list)
  videoUrl?: string                    // Reference video URL (MP4/MOV, ≥3s, 720-2160px, ≤200MB)
  videoReferType?: 'base' | 'feature'  // 'base' = video to edit, 'feature' = feature reference (default: 'base')
  keepOriginalSound?: boolean          // Keep original video sound (default: false)
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

const KLING_RATIOS = ['1:1', '16:9', '9:16'] as const

/** Detect aspect ratio from an image URL by fetching dimensions. Returns closest Kling-supported ratio. */
export async function detectAspectRatio(imageUrl: string): Promise<string> {
  try {
    const sharp = (await import('sharp')).default
    const res = await fetch(imageUrl)
    const buf = Buffer.from(await res.arrayBuffer())
    const { width, height } = await sharp(buf).metadata()
    if (!width || !height) return '3:4'
    const ratio = width / height
    let best = '3:4'
    let bestDiff = Infinity
    for (const r of KLING_RATIOS) {
      const [w, h] = r.split(':').map(Number)
      const diff = Math.abs(ratio - w / h)
      if (diff < bestDiff) { bestDiff = diff; best = r }
    }
    console.log(`🎬 [kling] detected aspect ratio: ${width}x${height} → ${best}`)
    return best
  } catch (e) {
    console.warn('[kling] detectAspectRatio failed, defaulting to 3:4:', e)
    return '3:4'
  }
}

/** Submit a v3-omni video task. Returns the Kling task ID. */
export async function createKlingTask(input: KlingTaskInput): Promise<string> {
  const hasVideo = !!input.videoUrl
  const referType = input.videoReferType ?? 'base'

  // All images are references — no first_frame. Aspect ratio is always explicit.
  const body: Record<string, unknown> = {
    model_name: 'kling-v3-omni',
    image_list: input.images.map((img) => ({
      image_url: img.startsWith('data:') ? img.replace(/^data:image\/\w+;base64,/, '') : img,
    })),
    prompt: input.prompt,
    mode: input.mode ?? 'std',
    // When video_list is present, sound must be 'off' (keep_original_sound controls video audio)
    sound: hasVideo ? 'off' : 'on',
  }

  // Add video_list for video editing
  if (hasVideo) {
    body.video_list = [{
      video_url: input.videoUrl,
      refer_type: referType,
      keep_original_sound: input.keepOriginalSound ? 'yes' : 'no',
    }]
  }

  if (input.aspect_ratio) {
    body.aspect_ratio = input.aspect_ratio
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

/**
 * Filter images to only those referenced in the script (<<<image_N>>>),
 * and remap indices to be sequential (e.g. image_1, image_5, image_9 → image_1, image_2, image_3).
 * Returns the filtered image list and the remapped prompt.
 */
export function filterAndRemapImages(
  prompt: string,
  imageUrls: string[],
  maxImages = 7,
): { filteredImages: string[]; finalPrompt: string } {
  const refs = [...new Set(
    Array.from(prompt.matchAll(/<<<image_(\d+)>>>/g), m => Number(m[1]))
  )].sort((a, b) => a - b)

  let filteredImages: string[]
  let finalPrompt: string

  if (refs.length > 0) {
    filteredImages = refs.map(n => imageUrls[n - 1]).filter((img): img is string => !!img)
    finalPrompt = prompt
    refs.forEach((origIdx, newIdx) => {
      finalPrompt = finalPrompt.replaceAll(`<<<image_${origIdx}>>>`, `<<<image_${newIdx + 1}>>>`)
    })
  } else {
    filteredImages = imageUrls
    finalPrompt = prompt
  }

  if (filteredImages.length > maxImages) {
    filteredImages = filteredImages.slice(0, maxImages)
  }

  return { filteredImages, finalPrompt }
}

/**
 * Parse Shot durations from script and return total seconds.
 * Matches: "Shot 1 (2s):", "Shot 2 (3.5s):", "镜头1 (2s):" etc.
 * Returns undefined if no shots found (let caller decide fallback).
 */
export function parseTotalDuration(script: string): number | undefined {
  const matches = script.matchAll(/(?:Shot|镜头|分镜)\s*\d+\s*\((\d+(?:\.\d+)?)(?:s|秒)\)/gi)
  let total = 0
  let found = false
  for (const m of matches) {
    total += parseFloat(m[1])
    found = true
  }
  return found ? Math.round(total) : undefined
}

// ---------------------------------------------------------------------------
// Unified animation task submission — single code path for GUI and CUI
// ---------------------------------------------------------------------------

export interface SubmitAnimationInput {
  projectId: string
  prompt: string
  imageUrls: string[]
  duration?: number
  aspectRatio?: string
  // Video editing
  videoUrl?: string
  videoReferType?: 'base' | 'feature'
  keepOriginalSound?: boolean
}

/**
 * Submit a video animation task: filter/remap images, call Kling (or PiAPI),
 * persist to DB. Both the API route and the Agent tool call this.
 */
export async function submitAnimationTask(input: SubmitAnimationInput): Promise<{ taskId: string; animationId: string }> {
  const { projectId, prompt, imageUrls, duration, aspectRatio, videoUrl, videoReferType, keepOriginalSound } = input

  // Filter to only referenced images and remap indices sequentially
  const { filteredImages, finalPrompt } = filterAndRemapImages(prompt, imageUrls)

  // Resolve duration: explicit > parsed from script shots > undefined (Kling decides)
  const resolvedDuration = duration ?? parseTotalDuration(finalPrompt)

  // Create video task — default Kling direct (v3-omni), ANIMATE_PROVIDER=piapi to fallback
  const usePiAPI = process.env.ANIMATE_PROVIDER === 'piapi'
  let taskId: string

  if (usePiAPI) {
    const { createKlingTask: createKlingTaskPiAPI } = await import('./piapi')
    taskId = await createKlingTaskPiAPI({
      prompt: finalPrompt.replace(/<<<image_(\d+)>>>/g, '@image_$1'),
      images: filteredImages,
      duration: resolvedDuration ?? 10,
      aspect_ratio: aspectRatio ?? '9:16',
      enable_audio: true,
      version: '3.0',
    })
  } else {
    taskId = await createKlingTask({
      prompt: finalPrompt,
      images: filteredImages,
      duration: resolvedDuration,
      aspect_ratio: aspectRatio,
      videoUrl,
      videoReferType,
      keepOriginalSound,
    })
  }

  // Persist to DB
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: animation, error } = await supabase
    .from('project_animations')
    .insert({
      project_id: projectId,
      piapi_task_id: taskId,
      status: 'processing',
      prompt: finalPrompt,
      snapshot_urls: filteredImages,
    })
    .select('id')
    .single()

  if (error) throw error

  return { taskId, animationId: animation.id }
}
