import type { Metadata } from 'next'
import { buildPublicMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPublicMetadata({
  title: 'Makaron - AI photo and video creative studio',
  description:
    'Makaron helps creators edit images, make AI videos, generate posters, and explore creative directions from photos.',
  path: '/landingpage',
  image: '/landing/desktop-screenshot.jpg',
  keywords: ['Makaron landing page', 'AI video creative studio', 'AI image workflow'],
})

export default function LandingPageLayout({ children }: { children: React.ReactNode }) {
  return children
}
