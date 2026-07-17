import type { Metadata } from 'next'
import Link from 'next/link'
import { buildPublicMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPublicMetadata({
  title: 'Privacy Policy',
  description: 'Privacy policy for Makaron, an AI creative studio for images and video.',
  path: '/privacy',
  keywords: ['Makaron privacy policy', 'AI creative studio privacy'],
})

const sections = [
  {
    title: 'Information we collect',
    items: [
      'Account information, such as email address and authentication identifiers.',
      'Content you choose to upload, create, or save in Makaron, including photos, videos, prompts, chat messages, generated media, and project metadata. Photos may include embedded metadata such as capture time or location when present.',
      'Billing and purchase records needed to provide credits, subscriptions, top-ups, invoices, and fraud prevention. Payment card details are handled by payment providers and app store billing systems.',
      'Usage, device, diagnostic, and performance information used to operate, secure, debug, and improve the service.',
    ],
  },
  {
    title: 'How we use information',
    items: [
      'Provide AI editing, video generation, project storage, account sync, credits, subscriptions, and customer support.',
      'Process purchases, restore entitlements, prevent abuse, and keep billing records.',
      'Improve reliability, quality, safety, and product experience.',
      'Comply with legal, tax, security, and platform requirements.',
    ],
  },
  {
    title: 'AI processing, sharing, and consent',
    items: [
      'Before the Makaron iOS app sends your content to a third-party AI service, the app explains what will be sent, identifies the recipients, and asks for your permission. If you do not allow AI processing, Makaron does not send your content to those AI services.',
      'The content sent for a requested creative action can include photos, videos, audio, prompts, chat messages, and generated media needed for a follow-up edit. Your sign-in password and payment card information are not sent to AI services.',
      'Depending on the feature and model you select, recipients may include Google (Gemini), OpenAI and Microsoft (Azure OpenAI), DeepSeek, xAI, ByteDance/Volcengine (SeeDance), and Kuaishou/Kling.',
      'These providers process the selected content to perform the edit or generation you request, provide safety and abuse prevention, and return the result. Makaron requires service providers handling personal information to provide the same or equivalent privacy and security protection described in this policy and required by applicable law.',
      'Makaron also uses infrastructure, authentication, storage, analytics, payment, and app store providers to operate, secure, and support the product.',
      'We do not sell personal information.',
    ],
  },
  {
    title: 'Your choices',
    items: [
      'You can choose what media to upload and what projects to keep.',
      'You can request account or data deletion by contacting support.',
      'You can manage iOS subscriptions through your Apple account subscription settings.',
    ],
  },
]

export default function PrivacyPage() {
  return (
    <main className="makaron-ios-page makaron-ios-page-x min-h-screen bg-black text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-14 sm:py-20">
        <header className="space-y-5">
          <Link href="/home" className="text-sm font-medium text-white/45 transition hover:text-white">
            Makaron
          </Link>
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300/70">
              Last updated: July 15, 2026
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Privacy Policy</h1>
            <p className="max-w-2xl text-base leading-7 text-white/60">
              Makaron is an AI creative studio for editing images, generating videos, and managing
              creative projects. This policy explains what information we collect and how we use it.
            </p>
          </div>
        </header>

        <section className="space-y-8">
          {sections.map((section) => (
            <div key={section.title} className="space-y-3 border-t border-white/10 pt-6">
              <h2 className="text-xl font-semibold">{section.title}</h2>
              <ul className="space-y-3 text-sm leading-6 text-white/62">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-fuchsia-300/80" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="space-y-3 border-t border-white/10 pt-6 text-sm leading-6 text-white/62">
          <h2 className="text-xl font-semibold text-white">Retention and security</h2>
          <p>
            We keep information for as long as needed to provide Makaron, comply with legal
            obligations, resolve disputes, prevent abuse, and maintain business records. We use
            technical and organizational safeguards appropriate for a cloud creative service.
          </p>
        </section>

        <section className="space-y-3 border-t border-white/10 pt-6 text-sm leading-6 text-white/62">
          <h2 className="text-xl font-semibold text-white">Contact</h2>
          <p>
            For privacy questions, support, or account deletion requests, email{' '}
            <a className="text-fuchsia-200 underline-offset-4 hover:underline" href="mailto:tianyi@versa-ai.com">
              tianyi@versa-ai.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
