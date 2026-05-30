import crypto from 'crypto'
import type { NextRequest } from 'next/server'

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

export async function sendMetaCapiEvent(input: MetaCapiInput): Promise<void> {
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

  const customData = {
    ...input.customData,
    ...(input.value !== undefined ? { value: input.value } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
  }

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
