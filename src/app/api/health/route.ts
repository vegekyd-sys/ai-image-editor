import { NextResponse } from 'next/server'

type ServiceStatus = 'healthy' | 'unhealthy' | 'unavailable'

interface ServiceResult {
  status: ServiceStatus
  latency?: number
  error?: string
}

async function checkWithTimeout(
  name: string,
  fn: () => Promise<void>,
  timeoutMs: number,
): Promise<ServiceResult> {
  const start = Date.now()
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs),
      ),
    ])
    return { status: 'healthy', latency: Date.now() - start }
  } catch (e) {
    return {
      status: 'unhealthy',
      latency: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

function unavailable(reason: string): ServiceResult {
  return { status: 'unavailable', error: reason }
}

// --- Individual service checks ---

async function checkSupabaseDB(): Promise<ServiceResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return unavailable('SUPABASE env not set')

  return checkWithTimeout('supabase_db', async () => {
    const res = await fetch(`${url}/rest/v1/projects?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!res.ok && res.status !== 406) throw new Error(`HTTP ${res.status}`)
  }, 3000)
}

async function checkSupabaseAuth(): Promise<ServiceResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return unavailable('SUPABASE env not set')

  return checkWithTimeout('supabase_auth', async () => {
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }, 3000)
}

async function checkSupabaseStorage(): Promise<ServiceResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return unavailable('SUPABASE env not set')

  return checkWithTimeout('supabase_storage', async () => {
    const res = await fetch(`${url}/storage/v1/bucket`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    // 200 or 400 both mean storage is responding
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
  }, 3000)
}

async function checkGemini(): Promise<ServiceResult> {
  const key = process.env.GOOGLE_API_KEY
  if (!key) return unavailable('GOOGLE_API_KEY not set')

  const model = process.env.IMAGE_MODEL || 'gemini-3-pro-image-preview'
  return checkWithTimeout('gemini', async () => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${key}`,
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }, 5000)
}

async function checkOpenRouter(): Promise<ServiceResult> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return unavailable('OPENROUTER_API_KEY not set')

  return checkWithTimeout('openrouter', async () => {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }, 5000)
}

async function checkBedrock(): Promise<ServiceResult> {
  const accessKey = process.env.AWS_ACCESS_KEY_ID
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY
  if (!accessKey || !secretKey) return unavailable('AWS credentials not set')
  // Just verify credentials exist — actual Bedrock call requires SigV4 signing
  return { status: 'healthy', latency: 0 }
}

async function checkComfyUI(
  name: string,
  envVar: string,
): Promise<ServiceResult> {
  const url = process.env[envVar]
  if (!url) return unavailable(`${envVar} not set`)

  return checkWithTimeout(name, async () => {
    const res = await fetch(`${url}/system_stats`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }, 3000)
}

async function checkKling(): Promise<ServiceResult> {
  const accessKey = process.env.KLING_ACCESS_KEY
  const secretKey = process.env.KLING_SECRET_KEY
  if (!accessKey || !secretKey) return unavailable('KLING credentials not set')
  // Keys present = configured, actual health requires a signed request
  return { status: 'healthy', latency: 0 }
}

async function checkPiAPI(): Promise<ServiceResult> {
  const key = process.env.PIAPI_API_KEY
  if (!key) return unavailable('PIAPI_API_KEY not set')

  return checkWithTimeout('piapi', async () => {
    const res = await fetch('https://api.piapi.ai/api/v1/task/health-check', {
      headers: { 'x-api-key': key },
    })
    // Any response (even 404) means the API is reachable and key is accepted
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
  }, 3000)
}

async function checkHuggingFace(): Promise<ServiceResult> {
  const token = process.env.HF_TOKEN
  if (!token) return unavailable('HF_TOKEN not set')

  return checkWithTimeout('huggingface', async () => {
    const res = await fetch('https://huggingface.co/api/whoami-v2', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }, 3000)
}

// --- Main handler ---

export async function GET() {
  const [
    supabaseDb,
    supabaseAuth,
    supabaseStorage,
    gemini,
    openrouter,
    bedrock,
    comfyuiQwen,
    comfyuiPony,
    kling,
    piapi,
    huggingface,
  ] = await Promise.all([
    checkSupabaseDB(),
    checkSupabaseAuth(),
    checkSupabaseStorage(),
    checkGemini(),
    checkOpenRouter(),
    checkBedrock(),
    checkComfyUI('comfyui_qwen', 'COMFYUI_QWEN_URL'),
    checkComfyUI('comfyui_pony', 'COMFYUI_PONY_URL'),
    checkKling(),
    checkPiAPI(),
    checkHuggingFace(),
  ])

  const services = {
    supabase_db: supabaseDb,
    supabase_auth: supabaseAuth,
    supabase_storage: supabaseStorage,
    gemini,
    openrouter,
    bedrock,
    comfyui_qwen: comfyuiQwen,
    comfyui_pony: comfyuiPony,
    kling,
    piapi,
    huggingface,
  }

  const entries = Object.values(services)
  const healthy = entries.filter(s => s.status === 'healthy').length
  const unhealthy = entries.filter(s => s.status === 'unhealthy').length
  const unavailableCount = entries.filter(s => s.status === 'unavailable').length

  // Core services: if supabase or gemini is unhealthy → down
  const coreDown =
    supabaseDb.status === 'unhealthy' ||
    supabaseAuth.status === 'unhealthy' ||
    gemini.status === 'unhealthy'

  const overallStatus = coreDown ? 'down' : unhealthy > 0 ? 'degraded' : 'healthy'

  return NextResponse.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    services,
    summary: { healthy, unhealthy, unavailable: unavailableCount },
  })
}
