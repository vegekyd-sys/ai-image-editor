import type { Metadata } from 'next'
import Link from 'next/link'
import { buildPublicMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPublicMetadata({
  title: 'Support',
  description: 'Get help with Makaron accounts, projects, credits, subscriptions, and AI creative workflows.',
  path: '/support',
  keywords: ['Makaron support', 'Makaron help', 'Makaron contact'],
})

const supportItems = [
  {
    title: 'Account and login',
    body: 'Email us if you cannot sign in, need help with a review account, or want to delete your account.',
  },
  {
    title: 'Projects and generated media',
    body: 'Include the project link, approximate time, and what you expected to happen when reporting an editing or generation issue.',
  },
  {
    title: 'Credits, top-ups, and subscriptions',
    body: 'For iOS purchases, include the Apple receipt or transaction time. For web purchases, include the Stripe receipt or account email.',
  },
  {
    title: 'Safety and privacy',
    body: 'For data deletion or privacy requests, contact us from the email address tied to your Makaron account.',
  },
]

export default function SupportPage() {
  return (
    <main className="makaron-ios-page makaron-ios-page-x min-h-screen bg-black text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-14 sm:py-20">
        <header className="space-y-5">
          <Link href="/home" className="text-sm font-medium text-white/45 transition hover:text-white">
            Makaron
          </Link>
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300/70">
              Help and contact
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Support</h1>
            <p className="max-w-2xl text-base leading-7 text-white/60">
              Need help with Makaron? Send a short note and include your account email, device,
              and the project or purchase details when relevant.
            </p>
          </div>
        </header>

        <section className="rounded-2xl border border-fuchsia-300/20 bg-fuchsia-300/8 p-6">
          <p className="text-sm uppercase tracking-[0.18em] text-fuchsia-200/70">Email</p>
          <a
            className="mt-2 block text-2xl font-semibold text-white underline-offset-4 hover:underline"
            href="mailto:tianyi@versa-ai.com"
          >
            tianyi@versa-ai.com
          </a>
          <p className="mt-3 text-sm leading-6 text-white/55">
            We usually need your Makaron account email and a brief description of the issue.
          </p>
        </section>

        <section className="grid gap-4">
          {supportItems.map((item) => (
            <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="text-lg font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/58">{item.body}</p>
            </div>
          ))}
        </section>

        <section className="space-y-3 border-t border-white/10 pt-6 text-sm leading-6 text-white/62">
          <h2 className="text-xl font-semibold text-white">Useful links</h2>
          <div className="flex flex-wrap gap-3">
            <Link className="rounded-full border border-white/12 px-4 py-2 text-white/70 hover:text-white" href="/privacy">
              Privacy Policy
            </Link>
            <Link className="rounded-full border border-white/12 px-4 py-2 text-white/70 hover:text-white" href="/home">
              Open Makaron
            </Link>
            <a
              className="rounded-full border border-white/12 px-4 py-2 text-white/70 hover:text-white"
              href="https://apps.apple.com/account/subscriptions"
            >
              Manage Apple subscriptions
            </a>
          </div>
        </section>
      </div>
    </main>
  )
}
