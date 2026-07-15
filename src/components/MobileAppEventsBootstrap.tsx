'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isMakaronIOSApp } from '@/lib/native-app'
import {
  clearPendingDeepLink,
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
      clearPendingDeepLink()
      router.replace(route)
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

      void initializeMobileAppEvents()

      // This is first-party funnel telemetry. Meta records the install automatically.
      try {
        if (!localStorage.getItem(FIRST_OPEN_KEY)) {
          localStorage.setItem(FIRST_OPEN_KEY, '1')
          trackMetaEvent('AppFirstOpen')
        }
      } catch {}

      const launchUrl = await App.getLaunchUrl()
      if (launchUrl?.url) {
        routeDeepLink(launchUrl.url)
      } else {
        const pending = getPendingDeepLink()
        if (pending) routeDeepLink(pending)
      }
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
