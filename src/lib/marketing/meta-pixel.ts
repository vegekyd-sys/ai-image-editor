'use client'

import { getMarketingAttribution, type MarketingAttribution } from './attribution'

export type MetaStandardEvent =
  | 'PageView'
  | 'ViewContent'
  | 'CompleteRegistration'
  | 'CustomizeProduct'
  | 'StartTrial'
  | 'InitiateCheckout'
  | 'Subscribe'
  | 'Purchase'

type MetaEventParams = Record<string, string | number | boolean | undefined>

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

export function trackMetaEvent(
  event: MetaStandardEvent,
  params: MetaEventParams = {},
  eventId?: string,
  attempt = 0,
) {
  if (typeof window === 'undefined') return
  if (!window.fbq) {
    if (attempt < 6) {
      window.setTimeout(() => trackMetaEvent(event, params, eventId, attempt + 1), 500)
    }
    return
  }
  const merged = { ...attributionParams(), ...params }
  window.fbq('track', event, merged, eventId ? { eventID: eventId } : undefined)
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
