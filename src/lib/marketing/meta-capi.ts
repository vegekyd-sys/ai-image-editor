import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

export type MetaCapiEventName =
  | 'CompleteRegistration'
  | 'CustomizeProduct'
  | 'StartTrial'
  | 'InitiateCheckout'
  | 'Subscribe'
  | 'Purchase'

interface MetaCapiInput {
  eventName: MetaCapiEventName
  eventId: string
  eventSourceUrl?: string
  userId?: string
  email?: string | null
  value?: number
  currency?: string
  customData?: Record<string, unknown>
  request?: NextRequest
  fbp?: string
  fbc?: string
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

function graphVersion(): string {
  return process.env.META_API_VERSION || process.env.META_GRAPH_API_VERSION || 'v23.0'
}

export function readAttributionCookie(raw?: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>
  } catch {
    return {}
  }
}

function cleanText(value: unknown, max = 2048): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function uuidOrNull(value: unknown): string | null {
  const text = cleanText(value, 64)
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null
}

async function recordServerMarketingEvent(input: MetaCapiInput, customData: Record<string, unknown>) {
  try {
    const req = input.request
    const sourceUrl = cleanText(input.eventSourceUrl)
    let pagePath: string | null = null
    if (sourceUrl) {
      try {
        const parsed = new URL(sourceUrl)
        pagePath = `${parsed.pathname}${parsed.search}`
      } catch {}
    }

    const row = {
      event_name: input.eventName,
      event_id: cleanText(input.eventId, 512),
      event_source: 'server',
      user_id: uuidOrNull(input.userId),
      project_id: uuidOrNull(customData.project_id),
      skill_id: cleanText(customData.skill_id, 512),
      page_url: sourceUrl,
      page_path: pagePath,
      user_agent: cleanText(req?.headers.get('user-agent')),
      fbp: cleanText(input.fbp || req?.cookies.get('_fbp')?.value, 512),
      fbc: cleanText(input.fbc || req?.cookies.get('_fbc')?.value, 512),
      utm_source: cleanText(customData.utm_source, 512),
      utm_medium: cleanText(customData.utm_medium, 512),
      utm_campaign: cleanText(customData.utm_campaign, 512),
      utm_content: cleanText(customData.utm_content, 512),
      utm_term: cleanText(customData.utm_term, 512),
      attribution: customData,
      event_params: {
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.currency ? { currency: input.currency } : {}),
      },
    }

    const { error } = await getSupabaseAdmin().from('marketing_events').insert(row)
    if (error && error.code !== '23505') {
      console.warn(`[marketing-events] server ${input.eventName} failed: ${error.message}`)
    }
  } catch (error) {
    console.warn(`[marketing-events] server ${input.eventName} failed:`, error)
  }
}

export async function sendMetaCapiEvent(input: MetaCapiInput): Promise<void> {
  const customData = {
    ...input.customData,
    ...(input.value !== undefined ? { value: input.value } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
  }

  await recordServerMarketingEvent(input, customData)

  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID || process.env.META_PIXEL_ID
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN
  if (!pixelId || !accessToken) return

  const req = input.request
  const userData: Record<string, unknown> = {}
  const email = input.email?.trim()
  if (email) userData.em = [sha256(email)]
  if (input.userId) userData.external_id = [sha256(input.userId)]
  const fbp = input.fbp || req?.cookies.get('_fbp')?.value
  const fbc = input.fbc || req?.cookies.get('_fbc')?.value
  if (fbp) userData.fbp = fbp
  if (fbc) userData.fbc = fbc

  const forwarded = req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || req?.headers.get('x-real-ip') || undefined
  const userAgent = req?.headers.get('user-agent') || undefined
  if (ip) userData.client_ip_address = ip
  if (userAgent) userData.client_user_agent = userAgent

  const payload = {
    data: [{
      event_name: input.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: input.eventId,
      action_source: 'website',
      event_source_url: input.eventSourceUrl,
      user_data: userData,
      custom_data: customData,
    }],
    ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}),
  }

  const url = `https://graph.facebook.com/${graphVersion()}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.warn(`[meta-capi] ${input.eventName} failed: ${res.status} ${text.slice(0, 500)}`)
  }
}
