'use client'

import { getMarketingAttribution, type MarketingAttribution } from './attribution'
import { isMakaronIOSApp } from '@/lib/native-app'

export type MetaStandardEvent =
  | 'PageView'
  | 'ViewContent'
  | 'CompleteRegistration'
  | 'CustomizeProduct'
  | 'StartTrial'
  | 'InitiateCheckout'
  | 'Subscribe'
  | 'Purchase'

export type MetaCustomEvent =
  | 'UploadIntent'
  | 'FileSelected'

export type MetaEventName = MetaStandardEvent | MetaCustomEvent

type MetaEventParams = Record<string, string | number | boolean | undefined>
const ANON_ID_KEY = 'mkr_anonymous_id'
const STANDARD_EVENTS = new Set<MetaEventName>([
  'PageView',
  'ViewContent',
  'CompleteRegistration',
  'CustomizeProduct',
  'StartTrial',
  'InitiateCheckout',
  'Subscribe',
  'Purchase',
])

declare global {
  interface Window {
    fbq?: {
      (command: 'track', event: MetaStandardEvent, params?: MetaEventParams, options?: { eventID?: string }): void
      (command: 'trackCustom', event: string, params?: MetaEventParams, options?: { eventID?: string }): void
    }
  }
}

export function createMetaEventId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
  return `${prefix}.${Date.now()}.${random}`
}

function attributionParams(attribution?: MarketingAttribution): MetaEventParams {
  const a = attribution ?? getMarketingAttribution()
  return {
    utm_source: a.utm_source,
    utm_medium: a.utm_medium,
    utm_campaign: a.utm_campaign,
    utm_content: a.utm_content,
    utm_term: a.utm_term,
    skill_id: a.skill_id,
  }
}

function getAnonymousId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const existing = localStorage.getItem(ANON_ID_KEY)
    if (existing) return existing
    const next = createMetaEventId('anon')
    localStorage.setItem(ANON_ID_KEY, next)
    return next
  } catch {
    return undefined
  }
}

function logFirstPartyMarketingEvent(
  event: MetaEventName,
  params: MetaEventParams,
  eventId: string,
) {
  if (typeof window === 'undefined') return
  if (isMakaronIOSApp()) return

  const attribution = getMarketingAttribution()
  const payload = {
    eventName: event,
    eventId,
    eventSource: 'browser',
    params,
    attribution,
    skillId: params.skill_id || attribution.skill_id,
    projectId: params.project_id,
    anonymousId: getAnonymousId(),
    url: window.location.href,
    path: `${window.location.pathname}${window.location.search}`,
    referrer: document.referrer,
  }

  try {
    const body = JSON.stringify(payload)
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon('/api/marketing/events', blob)
      return
    }
    fetch('/api/marketing/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {}
}

export function trackMetaEvent(
  event: MetaEventName,
  params: MetaEventParams = {},
  eventId?: string,
  attempt = 0,
) {
  if (typeof window === 'undefined') return
  if (isMakaronIOSApp()) return
  const finalEventId = eventId || createMetaEventId(event.toLowerCase())
  const merged = { ...attributionParams(), ...params }
  if (attempt === 0) logFirstPartyMarketingEvent(event, merged, finalEventId)
  if (!window.fbq) {
    if (attempt < 6) {
      window.setTimeout(() => trackMetaEvent(event, params, finalEventId, attempt + 1), 500)
    }
    return
  }
  if (STANDARD_EVENTS.has(event)) {
    window.fbq('track', event as MetaStandardEvent, merged, { eventID: finalEventId })
  } else {
    window.fbq('trackCustom', event, merged, { eventID: finalEventId })
  }
}

export function trackCheckoutStart(
  type: 'subscription' | 'topup',
  params: MetaEventParams = {},
): string {
  const eventId = createMetaEventId(`checkout.${type}`)
  trackMetaEvent('InitiateCheckout', { checkout_type: type, ...params }, eventId)
  try {
    sessionStorage.setItem(`mkr_checkout_event_${type}`, eventId)
  } catch {}
  return eventId
}

export function trackCheckoutSuccessFromUrl(searchParams: URLSearchParams) {
  const type = searchParams.get('checkout_type')
  const eventId = searchParams.get('meta_event_id')
  if (!eventId || (type !== 'subscription' && type !== 'topup')) return

  const sentKey = `mkr_checkout_success_${eventId}`
  try {
    if (localStorage.getItem(sentKey)) return
    localStorage.setItem(sentKey, '1')
  } catch {}

  if (type === 'subscription') {
    trackMetaEvent('Subscribe', { checkout_type: type, currency: 'USD' }, eventId)
  } else {
    trackMetaEvent('Purchase', { checkout_type: type, currency: 'USD' }, eventId)
  }
}
