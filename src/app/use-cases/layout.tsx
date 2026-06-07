import type { Metadata } from 'next'
import { buildPublicMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPublicMetadata({
  title: 'Makaron Use Cases',
  description:
    'Explore Makaron use cases for AI photo editing, photo to video, product visuals, posters, stickers, and social media content.',
  path: '/use-cases',
  keywords: ['Makaron use cases', 'AI content creation', 'AI image tools'],
})

export default function UseCasesLayout({ children }: { children: React.ReactNode }) {
  return children
}
