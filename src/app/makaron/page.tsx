import type { Metadata } from 'next'
import LandingPage from '@/app/landingpage/page'
import { SITE_NAME, absoluteUrl, buildPublicMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPublicMetadata({
  title: 'Makaron AI Creative Studio',
  description:
    'Makaron is an AI creative studio for editing photos, turning images into videos, generating posters, and making social content through chat.',
  path: '/makaron',
  image: '/landing/desktop-screenshot.jpg',
  keywords: ['Makaron', 'Makaron AI', 'Makaron app', 'Makaron creative studio'],
})

export default function MakaronBrandPage() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    alternateName: 'Makaron AI',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    url: absoluteUrl('/makaron'),
    description:
      'Makaron is an AI creative studio for editing photos, turning images into videos, generating posters, and making social content through chat.',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <LandingPage />
    </>
  )
}
