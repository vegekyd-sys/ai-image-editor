import Link from 'next/link'
import { useCasePages } from '@/lib/public-seo-pages'
import { SITE_NAME, absoluteUrl } from '@/lib/seo'

export default function UseCasesIndexPage() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Makaron AI creative studio use cases',
    description: 'AI image editing, photo to video, poster, product photo, and social content use cases for Makaron.',
    url: absoluteUrl('/use-cases'),
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: absoluteUrl('/home'),
    },
    hasPart: useCasePages.map((page) => ({
      '@type': 'WebPage',
      name: page.title,
      url: absoluteUrl(`/use-cases/${page.slug}`),
      description: page.description,
    })),
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <section className="relative min-h-[72vh] overflow-hidden border-b border-white/10">
        <img
          src="/landing/desktop-screenshot.jpg"
          alt="Makaron AI creative studio interface"
          className="absolute inset-0 h-full w-full object-cover opacity-42"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/72 to-black" />
        <div className="relative z-10 mx-auto flex min-h-[72vh] max-w-6xl flex-col justify-end px-6 pb-16 pt-28 lg:px-10">
          <Link href="/makaron" className="mb-12 w-fit text-sm font-semibold text-white/62 hover:text-white">
            Makaron
          </Link>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-fuchsia-300/90">AI creative studio</p>
          <h1 className="mt-5 max-w-4xl text-5xl font-black leading-[0.95] tracking-normal lg:text-7xl">
            Search-ready ways to use Makaron
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-white/70 lg:text-lg">
            Makaron turns photos into edited images, videos, posters, stickers, and social content through an AI agent you can direct by chat.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/home" className="rounded-lg bg-white px-5 py-3 text-sm font-bold text-black hover:bg-white/86">
              Start creating
            </Link>
            <a href="#use-cases" className="rounded-lg border border-white/18 px-5 py-3 text-sm font-bold text-white hover:bg-white/8">
              Browse use cases
            </a>
            <Link href="/makaron" className="rounded-lg border border-white/18 px-5 py-3 text-sm font-bold text-white hover:bg-white/8">
              About Makaron
            </Link>
          </div>
        </div>
      </section>

      <section id="use-cases" className="mx-auto max-w-6xl px-6 py-16 lg:px-10 lg:py-24">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {useCasePages.map((page) => (
            <Link
              key={page.slug}
              href={`/use-cases/${page.slug}`}
              className="group overflow-hidden rounded-lg border border-white/10 bg-white/[0.045] transition hover:-translate-y-1 hover:border-fuchsia-300/40 hover:bg-white/[0.07]"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-white/5">
                <img
                  src={page.image}
                  alt={page.imageAlt}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/72 to-transparent" />
                <p className="absolute bottom-4 left-4 text-xs font-bold uppercase tracking-[0.18em] text-fuchsia-200">
                  {page.eyebrow}
                </p>
              </div>
              <div className="p-5">
                <h2 className="text-xl font-black leading-tight tracking-normal">{page.title}</h2>
                <p className="mt-3 text-sm leading-6 text-white/62">{page.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}
