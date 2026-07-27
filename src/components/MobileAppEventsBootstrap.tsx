'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isMakaronIOSApp } from '@/lib/native-app'
import {
  captureMobileDeepLinkAttribution,
  clearPendingDeepLink,
  fetchDeferredMobileAppLinkResult,
  getMobileAppEventsContext,
  getPendingDeepLink,
  initializeMobileAppEvents,
  persistPendingDeepLink,
  routeForMakaronDeepLink,
} from '@/lib/marketing/mobile-app-events'
import {
  createMetaEventId,
  recordFirstPartyMarketingEvent,
  trackMetaEvent,
} from '@/lib/marketing/meta-pixel'

const FIRST_OPEN_KEY = 'makaron:meta-first-open-recorded'

export default function MobileAppEventsBootstrap() {
  const router = useRouter()

  useEffect(() => {
    if (!isMakaronIOSApp()) return

    let cancelled = false
    let appUrlHandle: { remove: () => Promise<void> } | undefined

    const sdkParams = () => {
      const context = getMobileAppEventsContext()
      return {
        app_version: context.appVersion,
        app_build: context.appBuild,
        advertiser_tracking_status: context.advertiserTrackingStatus,
        advertiser_id_collection_enabled: context.advertiserIDCollectionEnabled,
      }
    }

    const routeDeepLink = (value: string, launchSource: string) => {
      persistPendingDeepLink(value)
      const route = routeForMakaronDeepLink(value)
      if (!route || cancelled) return
      const attribution = captureMobileDeepLinkAttribution(value)
      clearPendingDeepLink()
      recordFirstPartyMarketingEvent('MobileDeepLinkRouted', {
        launch_source: launchSource,
        skill_id: attribution?.skill_id,
        has_campaign_attribution: Boolean(attribution?.campaign_id || attribution?.utm_campaign),
        ...sdkParams(),
      }, createMetaEventId('mobile.deep_link.routed'))
      router.replace(route)
    }

    const recordFirstOpen = (launchSource: string, deferredStatus?: string) => {
      try {
        if (!localStorage.getItem(FIRST_OPEN_KEY)) {
          localStorage.setItem(FIRST_OPEN_KEY, '1')
          trackMetaEvent('AppFirstOpen', {
            launch_source: launchSource,
            deferred_status: deferredStatus,
            ...sdkParams(),
          })
        }
      } catch {}
    }

    async function start() {
      const { App } = await import('@capacitor/app')
      const handle = await App.addListener('appUrlOpen', ({ url }) => {
        routeDeepLink(url, 'app_url_open')
      })
      if (cancelled) {
        await handle.remove()
        return
      }
      appUrlHandle = handle

      await initializeMobileAppEvents()

      let launchSource = 'organic'
      let deferredStatus: string | undefined
      const launchUrl = await App.getLaunchUrl()
      if (launchUrl?.url) {
        launchSource = 'launch_url'
        routeDeepLink(launchUrl.url, launchSource)
      } else {
        const pending = getPendingDeepLink()
        if (pending) {
          launchSource = 'pending_link'
          routeDeepLink(pending, launchSource)
        } else {
          const deferred = await fetchDeferredMobileAppLinkResult(() => {
            recordFirstPartyMarketingEvent('DeferredDeepLinkFetchStarted', {
              launch_source: 'first_launch',
              ...sdkParams(),
            }, createMetaEventId('deferred.started'))
          })
          deferredStatus = deferred.status
          let resultEvent: string | undefined
          if (deferred.status === 'resolved') resultEvent = 'DeferredDeepLinkFetchResolved'
          if (deferred.status === 'empty') resultEvent = 'DeferredDeepLinkFetchEmpty'
          if (deferred.status === 'error') resultEvent = 'DeferredDeepLinkFetchError'
          if (resultEvent) {
            recordFirstPartyMarketingEvent(resultEvent, {
              launch_source: 'first_launch',
              deferred_status: deferred.status,
              error_message: deferred.error?.slice(0, 200),
              ...sdkParams(),
            }, createMetaEventId(`deferred.${deferred.status}`))
          }
          if (deferred.url) {
            launchSource = 'deferred_link'
            routeDeepLink(deferred.url, launchSource)
          }
        }
      }

      // Resolve and persist deferred attribution before recording first open.
      // Meta records the install automatically; this event is our first-party truth.
      recordFirstOpen(launchSource, deferredStatus)
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
