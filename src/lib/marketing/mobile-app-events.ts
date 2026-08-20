'use client'

import { MetaAppEvents } from '@makaron/capacitor-meta-app-events'
import type { MetaEventName } from './meta-pixel'
import { isMakaronIOSApp } from '@/lib/native-app'
import { captureMarketingAttribution, type MarketingAttribution } from './attribution'

type MobileEventParams = Record<string, string | number | boolean | undefined>

export interface MobileAppEventsContext {
  provider: 'meta_app_events'
  appId?: string
  anonymousId?: string
  appVersion?: string
  appBuild?: string
  advertiserTrackingStatus?: string
  advertiserIDCollectionEnabled?: boolean
}

export type DeferredMobileAppLinkStatus =
  | 'not_ios'
  | 'already_checked'
  | 'initialization_failed'
  | 'sdk_unavailable'
  | 'resolved'
  | 'empty'
  | 'error'

export interface DeferredMobileAppLinkResult {
  status: DeferredMobileAppLinkStatus
  url?: string
  error?: string
  errorDomain?: string
  errorCode?: number
  nativeFetchStartedAt?: string
  nativeFetchLatencyMs?: number
  context: MobileAppEventsContext
}

const PENDING_DEEP_LINK_KEY = 'makaron:pending-deep-link'
const DEFERRED_DEEP_LINK_CHECKED_KEY = 'makaron:meta-deferred-deep-link-checked'
type DeferredLinkCapableMetaAppEvents = typeof MetaAppEvents & {
  fetchDeferredAppLink?: () => Promise<{
    status?: 'resolved' | 'empty' | 'error'
    url?: string | null
    errorDomain?: string
    errorCode?: number
    errorDescription?: string
    nativeFetchStartedAt?: string
    nativeFetchLatencyMs?: number
    appVersion?: string
    appBuild?: string
    advertiserTrackingStatus?: string
    advertiserIDCollectionEnabled?: boolean
  }>
}
const AUTOMATIC_META_EVENTS = new Set<MetaEventName>([
  'AppFirstOpen',
  'StartTrial',
  'Subscribe',
  'Purchase',
])
const DEEP_LINK_ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'campaign_id',
  'adset_id',
  'ad_id',
  'creative_id',
  'fbclid',
] as const

let context: MobileAppEventsContext = { provider: 'meta_app_events' }
let initializationPromise: Promise<boolean> | null = null

export function getMobileAppEventsContext(): MobileAppEventsContext {
  return context
}

export function initializeMobileAppEvents(): Promise<boolean> {
  if (!isMakaronIOSApp()) return Promise.resolve(false)
  if (!initializationPromise) {
    initializationPromise = MetaAppEvents.initialize()
      .then((result) => {
        context = {
          provider: 'meta_app_events',
          appId: result.appId,
          anonymousId: result.anonymousId,
          appVersion: result.appVersion,
          appBuild: result.appBuild,
          advertiserTrackingStatus: result.advertiserTrackingStatus,
          advertiserIDCollectionEnabled: result.advertiserIDCollectionEnabled,
        }
        return result.initialized
      })
      .catch((error) => {
        initializationPromise = null
        console.warn('[MetaAppEvents] initialization failed:', error)
        return false
      })
  }
  return initializationPromise
}

export async function trackMobileAppEvent(
  event: MetaEventName,
  params: MobileEventParams,
  eventId: string,
): Promise<boolean> {
  // Meta logs install/session and StoreKit revenue events automatically.
  if (AUTOMATIC_META_EVENTS.has(event) || !await initializeMobileAppEvents()) return false

  const value = typeof params.value === 'number' ? params.value : undefined
  const currency = typeof params.currency === 'string' ? params.currency : undefined
  try {
    const result = await MetaAppEvents.trackEvent({
      eventName: event,
      eventId,
      params,
      value,
      currency,
    })
    return result.tracked
  } catch (error) {
    console.warn(`[MetaAppEvents] failed to track ${event}:`, error)
    return false
  }
}

export function persistPendingDeepLink(url: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PENDING_DEEP_LINK_KEY, url)
  } catch {}
}

export function getPendingDeepLink(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return localStorage.getItem(PENDING_DEEP_LINK_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function clearPendingDeepLink(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(PENDING_DEEP_LINK_KEY)
  } catch {}
}

function mobileSkillId(url: URL): string | undefined {
  if (url.protocol === 'makaron:' && url.hostname === 'skill') {
    return url.pathname.split('/').filter(Boolean)[0]
  }
  if (url.protocol !== 'https:' || !['makaron.app', 'www.makaron.app'].includes(url.hostname)) {
    return undefined
  }
  const segments = url.pathname.split('/').filter(Boolean)
  return url.searchParams.get('skill')
    || (segments[0] === 'home' && segments.length > 1 ? segments[1] : undefined)
    || undefined
}

function routeParamsForDeepLink(url: URL, skillId: string): URLSearchParams {
  const params = new URLSearchParams()
  params.set('skill', skillId)
  for (const key of DEEP_LINK_ATTRIBUTION_KEYS) {
    const value = url.searchParams.get(key)
    if (value) params.set(key, value)
  }
  return params
}

export function captureMobileDeepLinkAttribution(value: string): MarketingAttribution | undefined {
  try {
    const url = new URL(value)
    const skillId = mobileSkillId(url)
    if (!skillId) return undefined
    return captureMarketingAttribution('/home', routeParamsForDeepLink(url, skillId))
  } catch {
    return undefined
  }
}

export async function fetchDeferredMobileAppLinkResult(
  onStart?: () => void,
): Promise<DeferredMobileAppLinkResult> {
  if (!isMakaronIOSApp() || typeof window === 'undefined') {
    return { status: 'not_ios', context }
  }
  try {
    if (localStorage.getItem(DEFERRED_DEEP_LINK_CHECKED_KEY)) {
      return { status: 'already_checked', context }
    }
    if (!await initializeMobileAppEvents()) {
      return { status: 'initialization_failed', context }
    }
    const fetchDeferredAppLink = (MetaAppEvents as DeferredLinkCapableMetaAppEvents).fetchDeferredAppLink
    if (typeof fetchDeferredAppLink !== 'function') {
      localStorage.setItem(DEFERRED_DEEP_LINK_CHECKED_KEY, 'sdk_unavailable')
      return { status: 'sdk_unavailable', context }
    }
    onStart?.()
    const result = await fetchDeferredAppLink.call(MetaAppEvents)
    context = {
      ...context,
      appVersion: result.appVersion ?? context.appVersion,
      appBuild: result.appBuild ?? context.appBuild,
      advertiserTrackingStatus:
        result.advertiserTrackingStatus ?? context.advertiserTrackingStatus,
      advertiserIDCollectionEnabled:
        result.advertiserIDCollectionEnabled ?? context.advertiserIDCollectionEnabled,
    }
    const diagnostics = {
      errorDomain: result.errorDomain,
      errorCode: result.errorCode,
      nativeFetchStartedAt: result.nativeFetchStartedAt,
      nativeFetchLatencyMs: result.nativeFetchLatencyMs,
    }
    if (result.status === 'error') {
      localStorage.setItem(DEFERRED_DEEP_LINK_CHECKED_KEY, 'error')
      return {
        status: 'error',
        error: result.errorDescription || 'Deferred app link lookup failed',
        ...diagnostics,
        context,
      }
    }
    if (typeof result.url === 'string' && result.url) {
      localStorage.setItem(DEFERRED_DEEP_LINK_CHECKED_KEY, 'resolved')
      return { status: 'resolved', url: result.url, ...diagnostics, context }
    }
    localStorage.setItem(DEFERRED_DEEP_LINK_CHECKED_KEY, 'empty')
    return { status: 'empty', ...diagnostics, context }
  } catch (error) {
    console.warn('[MetaAppEvents] deferred app link lookup failed:', error)
    try {
      localStorage.setItem(DEFERRED_DEEP_LINK_CHECKED_KEY, 'error')
    } catch {}
    return {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      context,
    }
  }
}

export async function fetchDeferredMobileAppLink(): Promise<string | undefined> {
  const result = await fetchDeferredMobileAppLinkResult()
  return result.url
}

export function routeForMakaronDeepLink(value: string): string | undefined {
  try {
    const url = new URL(value)
    const skillId = mobileSkillId(url)
    return skillId ? `/home?${routeParamsForDeepLink(url, skillId)}` : undefined
  } catch {
    return undefined
  }
}
