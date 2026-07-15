'use client'

import { MetaAppEvents } from '@makaron/capacitor-meta-app-events'
import type { MetaEventName } from './meta-pixel'
import { isMakaronIOSApp } from '@/lib/native-app'

type MobileEventParams = Record<string, string | number | boolean | undefined>

export interface MobileAppEventsContext {
  provider: 'meta_app_events'
  appId?: string
  anonymousId?: string
}

const PENDING_DEEP_LINK_KEY = 'makaron:pending-deep-link'
const AUTOMATIC_META_EVENTS = new Set<MetaEventName>([
  'AppFirstOpen',
  'StartTrial',
  'Subscribe',
  'Purchase',
])

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

export function routeForMakaronDeepLink(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol === 'makaron:' && url.hostname === 'skill') {
      const skillId = url.pathname.split('/').filter(Boolean)[0]
      return skillId ? `/home?skill=${encodeURIComponent(skillId)}` : undefined
    }

    if (url.protocol !== 'https:' || !['makaron.app', 'www.makaron.app'].includes(url.hostname)) {
      return undefined
    }
    const skillFromQuery = url.searchParams.get('skill')
    const segments = url.pathname.split('/').filter(Boolean)
    const skillFromPath = segments[0] === 'home' && segments.length > 1 ? segments[1] : undefined
    const skillId = skillFromQuery || skillFromPath
    return skillId ? `/home?skill=${encodeURIComponent(skillId)}` : undefined
  } catch {
    return undefined
  }
}
