'use client'

import { useLocale } from '@/lib/i18n'
import MakaronLogo from '@/components/MakaronLogo'

/** Commit the destination immediately even while the route's remaining chunks load. */
export default function LoginLoading() {
  const { t } = useLocale()
  return (
    <main className="makaron-ios-page min-h-dvh bg-black text-white flex flex-col items-center justify-center gap-6 px-6" aria-busy="true" data-testid="login-loading">
      <MakaronLogo markSize={40} />
      <h1 className="text-xl font-medium">{t('nav.signIn')}</h1>
      <p role="status" className="text-sm text-zinc-400">{t('login.loading')}</p>
      <a href="/home" className="text-sm text-fuchsia-400 min-h-11 flex items-center">{t('nav.explore')}</a>
    </main>
  )
}
