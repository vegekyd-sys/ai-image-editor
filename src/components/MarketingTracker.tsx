'use client'

import Script from 'next/script'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { captureMarketingAttribution } from '@/lib/marketing/attribution'
import { trackCheckoutSuccessFromUrl, trackMetaEvent } from '@/lib/marketing/meta-pixel'

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID

export default function MarketingTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lastPageKey = useRef('')
  const [pixelReady, setPixelReady] = useState(!PIXEL_ID)

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    captureMarketingAttribution(pathname, params)

    const pageKey = `${pathname}?${params.toString()}`
    if (pixelReady && pageKey !== lastPageKey.current) {
      lastPageKey.current = pageKey
      trackMetaEvent('PageView')

      const skillId = params.get('skill') || (pathname.startsWith('/home/') ? pathname.split('/')[2] : '')
      if (skillId) {
        trackMetaEvent('ViewContent', {
          content_type: 'skill',
          content_name: skillId,
          skill_id: skillId,
        })
      }
    }

    if (pixelReady) trackCheckoutSuccessFromUrl(params)
  }, [pathname, searchParams, pixelReady])

  if (!PIXEL_ID) return null

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive" onReady={() => setPixelReady(true)}>
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${PIXEL_ID}');
        `}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  )
}
