import type { Metadata } from 'next'
import { buildPublicMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPublicMetadata({
  title: 'Makaron Releases',
  description: 'Product releases from Makaron, the AI creative studio for images, video, music, and agent-led creation.',
  path: '/releases/video-in-timeline',
  image: '/landing/video.jpg',
  keywords: ['Makaron releases', 'AI video timeline', 'AI creative workflow'],
})

export default function ReleasesLayout({ children }: { children: React.ReactNode }) {
  return children
}
