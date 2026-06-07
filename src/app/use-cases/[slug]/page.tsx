import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getUseCasePage, useCasePages } from '@/lib/public-seo-pages'
import { SITE_NAME, absoluteUrl, buildPublicMetadata } from '@/lib/seo'

type Props = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return useCasePages.map((page) => ({ slug: page.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const page = getUseCasePage(slug)
  if (!page) return {}

  return buildPublicMetadata({
    title: page.title,
    description: page.description,
    path: `/use-cases/${page.slug}`,
    image: page.image,
    keywords: page.keywords,
  })
}

export default async function UseCasePage({ params }: Props) {
  const { slug } = await params
  const page = getUseCasePage(slug)
  if (!page) notFound()

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${page.title} | ${SITE_NAME}`,
    description: page.description,
    url: absoluteUrl(`/use-cases/${page.slug}`),
    image: absoluteUrl(page.image),
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: absoluteUrl('/home'),
    },
    about: page.keywords,
    mainEntity: {
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Web',
      description: page.description,
      url: absoluteUrl('/home'),
    },
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <section className="relative min-h-[76vh] overflow-hidden border-b border-white/10">
        <img
          src={page.image}
          alt={page.imageAlt}
          className="absolute inset-0 h-full w-full object-cover opacity-55"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black/38" />
        <div className="relative z-10 mx-auto flex min-h-[76vh] max-w-6xl flex-col justify-end px-6 pb-14 pt-24 lg:px-10">
          <div className="mb-10 flex flex-wrap items-center gap-4 text-sm text-white/58">
            <Link href="/makaron" className="font-semibold hover:text-white">Makaron</Link>
            <span>/</span>
            <Link href="/use-cases" className="font-semibold hover:text-white">Use cases</Link>
          </div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-fuchsia-300/90">{page.eyebrow}</p>
          <h1 className="mt-5 max-w-4xl text-5xl font-black leading-[0.95] tracking-normal lg:text-7xl">
            {page.h1}
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-white/74 lg:text-lg">{page.description}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/home" className="rounded-lg bg-white px-5 py-3 text-sm font-bold text-black hover:bg-white/86">
              Try Makaron
            </Link>
            <Link href="/use-cases" className="rounded-lg border border-white/18 px-5 py-3 text-sm font-bold text-white hover:bg-white/8">
              More use cases
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:px-10 lg:py-24">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-white/42">Who it is for</p>
          <h2 className="mt-4 text-3xl font-black tracking-normal lg:text-4xl">{page.audience}</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {page.outcomes.map((outcome) => (
            <div key={outcome} className="rounded-lg border border-white/10 bg-white/[0.045] p-5">
              <p className="text-sm leading-6 text-white/72">{outcome}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.035]">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-2 lg:px-10">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-fuchsia-300/75">Workflow</p>
            <ol className="mt-6 space-y-4">
              {page.workflow.map((step, index) => (
                <li key={step} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-black text-black">
                    {index + 1}
                  </span>
                  <span className="pt-1 text-base leading-7 text-white/76">{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-fuchsia-300/75">Example prompts</p>
            <div className="mt-6 space-y-3">
              {page.examples.map((example) => (
                <p key={example} className="rounded-lg border border-white/10 bg-black/34 p-4 text-sm leading-6 text-white/78">
                  {example}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16 lg:px-10">
        <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.045]">
          <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
            <div className="p-6 lg:p-10">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-white/42">Makaron</p>
              <h2 className="mt-4 text-3xl font-black tracking-normal">One AI workspace for images, video, and creative iteration</h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-white/66">
                Start with an image, describe the result, and keep refining. Makaron keeps the creative process in one project so every edit, video, and direction stays connected.
              </p>
              <Link href="/home" className="mt-8 inline-flex rounded-lg bg-fuchsia-400 px-5 py-3 text-sm font-black text-black hover:bg-fuchsia-300">
                Open Makaron
              </Link>
            </div>
            <img src="/landing/phone-screenshot.jpg" alt="Makaron mobile creative workspace" className="h-full min-h-[360px] w-full object-cover" />
          </div>
        </div>
      </section>
    </main>
  )
}
