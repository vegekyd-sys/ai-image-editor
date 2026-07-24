'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isMakaronIOSApp } from '@/lib/native-app'
import {
  captureMobileDeepLinkAttribution,
  clearPendingDeepLink,
  fetchDeferredMobileAppLink,
  getPendingDeepLink,
  initializeMobileAppEvents,
  persistPendingDeepLink,
  routeForMakaronDeepLink,
} from '@/lib/marketing/mobile-app-events'
import { trackMetaEvent } from '@/lib/marketing/meta-pixel'

const FIRST_OPEN_KEY = 'makaron:meta-first-open-recorded'

export default function MobileAppEventsBootstrap() {
  const router = useRouter()

  useEffect(() => {
    if (!isMakaronIOSApp()) return

    let cancelled = false
    let appUrlHandle: { remove: () => Promise<void> } | undefined

    const routeDeepLink = (value: string) => {
      persistPendingDeepLink(value)
      const route = routeForMakaronDeepLink(value)
      if (!route || cancelled) return
      captureMobileDeepLinkAttribution(value)
      clearPendingDeepLink()
      router.replace(route)
    }

    const recordFirstOpen = () => {
      try {
        if (!localStorage.getItem(FIRST_OPEN_KEY)) {
          localStorage.setItem(FIRST_OPEN_KEY, '1')
          trackMetaEvent('AppFirstOpen')
        }
      } catch {}
    }

    async function start() {
      const { App } = await import('@capacitor/app')
      const handle = await App.addListener('appUrlOpen', ({ url }) => {
        routeDeepLink(url)
      })
      if (cancelled) {
        await handle.remove()
        return
      }
      appUrlHandle = handle

      await initializeMobileAppEvents()

      const launchUrl = await App.getLaunchUrl()
      if (launchUrl?.url) {
        routeDeepLink(launchUrl.url)
      } else {
        const pending = getPendingDeepLink()
        if (pending) {
          routeDeepLink(pending)
        } else {
          const deferredUrl = await fetchDeferredMobileAppLink()
          if (deferredUrl) routeDeepLink(deferredUrl)
        }
      }

      // Resolve and persist deferred attribution before recording first open.
      // Meta records the install automatically; this event is our first-party truth.
      recordFirstOpen()
    }

    void start().catch((error) => {
      console.warn('[MetaAppEvents] bootstrap failed:', error)
    })

    return () => {
      cancelled = true
      if (appUrlHandle) void appUrlHandle.remove()
    }
  }, [router])

  return null
}
