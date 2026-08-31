import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import MakaronKids from '@/components/kids/MakaronKids'
import { normalizeLocale, translate } from '@/lib/locales'

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies()
  const locale = normalizeLocale(cookieStore.get('locale')?.value)
  return {
    title: translate(locale, 'kids.meta.title'),
    description: translate(locale, 'kids.meta.description'),
    robots: { index: false, follow: false },
  }
}

export default function KidsPage() {
  return <MakaronKids />
}
