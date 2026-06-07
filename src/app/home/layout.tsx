import type { Metadata } from 'next'
import { buildPublicMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPublicMetadata({
  title: 'Makaron - AI creative studio',
  description:
    'Makaron is an AI creative studio for editing photos, making videos, generating posters, and turning images into social-ready content by chatting with an AI agent.',
  path: '/home',
  keywords: ['Makaron AI', 'AI creative studio', 'AI image agent'],
})

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return children
}
