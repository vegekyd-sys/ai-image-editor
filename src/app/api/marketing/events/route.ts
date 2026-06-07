import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { readAttributionCookie } from '@/lib/marketing/meta-capi'

const EVENT_NAME_MAX = 80
const TEXT_MAX = 2048
const SHORT_TEXT_MAX = 512

function cleanString(value: unknown, max = TEXT_MAX): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, max)
}

function cleanObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function pickString(source: Record<string, unknown>, key: string, max = SHORT_TEXT_MAX): string | undefined {
  return cleanString(source[key], max)
}

function uuidOrNull(value: unknown): string | null {
  const text = cleanString(value, 64)
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventName = cleanString(body.eventName, EVENT_NAME_MAX)
  if (!eventName) return NextResponse.json({ error: 'eventName is required' }, { status: 400 })

  const bodyAttribution = cleanObject(body.attribution)
  const cookieAttribution = readAttributionCookie(req.cookies.get('mkr_attribution')?.value)
  const attribution = { ...cookieAttribution, ...bodyAttribution }
  const eventParams = cleanObject(body.params)

  let userId: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  } catch {
    userId = null
  }

  const pageUrl = cleanString(body.url)
  let pagePath = cleanString(body.path)
  if (!pagePath && pageUrl) {
    try {
      const parsed = new URL(pageUrl)
      pagePath = `${parsed.pathname}${parsed.search}`
    } catch {}
  }

  const skillId = cleanString(body.skillId, SHORT_TEXT_MAX)
    || cleanString(eventParams.skill_id, SHORT_TEXT_MAX)
    || cleanString(attribution.skill_id, SHORT_TEXT_MAX)

  const row = {
    event_name: eventName,
    event_id: cleanString(body.eventId, SHORT_TEXT_MAX) ?? null,
    event_source: cleanString(body.eventSource, 64) ?? 'browser',
    user_id: userId,
    anonymous_id: cleanString(body.anonymousId, SHORT_TEXT_MAX) ?? null,
    project_id: uuidOrNull(body.projectId) ?? uuidOrNull(eventParams.project_id),
    skill_id: skillId ?? null,
    page_url: pageUrl ?? null,
    page_path: pagePath ?? null,
    referrer: cleanString(body.referrer) ?? null,
    user_agent: cleanString(req.headers.get('user-agent')) ?? null,
    fbp: cleanString(req.cookies.get('_fbp')?.value, SHORT_TEXT_MAX) ?? null,
    fbc: cleanString(req.cookies.get('_fbc')?.value, SHORT_TEXT_MAX) ?? null,
    utm_source: pickString(attribution, 'utm_source') ?? null,
    utm_medium: pickString(attribution, 'utm_medium') ?? null,
    utm_campaign: pickString(attribution, 'utm_campaign') ?? null,
    utm_content: pickString(attribution, 'utm_content') ?? null,
    utm_term: pickString(attribution, 'utm_term') ?? null,
    attribution,
    event_params: eventParams,
  }

  const admin = getSupabaseAdmin()
  const { error } = await admin.from('marketing_events').insert(row)

  if (error) {
    if (error.code === '23505') return NextResponse.json({ ok: true, duplicate: true })
    console.warn('[marketing-events] insert failed:', error.message)
    return NextResponse.json({ error: 'Failed to record event' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
