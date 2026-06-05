import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { SITE_NAME, absoluteUrl, buildPublicMetadata } from '@/lib/seo'
import { isIndexableSkill } from '@/lib/seo-skill-filter'

type Props = { params: Promise<{ skillId: string }> }

type HomeSkillRow = {
  id: string
  labels: Record<string, string> | null
  image: string | null
  prompt: string | null
  image_count: number | null
  before_images: string[] | null
}

async function getSkill(skillId: string): Promise<HomeSkillRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('home_skills')
    .select('id, labels, image, prompt, image_count, before_images')
    .eq('id', skillId)
    .eq('is_active', true)
    .single()

  if (error || !data) return null
  return data as HomeSkillRow
}

function skillTitle(skill: HomeSkillRow) {
  return skill.labels?.en || skill.labels?.zh || 'Makaron AI creative skill'
}

function skillDescription(skill: HomeSkillRow) {
  const prompt = skill.prompt?.replace(/\s+/g, ' ').trim()
  if (prompt) return prompt.length > 156 ? `${prompt.slice(0, 153)}...` : prompt
  return `${skillTitle(skill)} is a Makaron AI creative skill for transforming images and making visual content by chat.`
}

function isVideoUrl(url: string | null | undefined) {
  if (!url) return false
  return /\.(mp4|mov|webm)(?:[?#].*)?$/i.test(url)
}

function seoImageForSkill(skill: HomeSkillRow) {
  if (skill.image && !isVideoUrl(skill.image)) return skill.image
  const firstBefore = Array.isArray(skill.before_images) ? skill.before_images.find(Boolean) : null
  return firstBefore || '/landing/desktop-screenshot.jpg'
}

function SkillMedia({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className: string
}) {
  if (isVideoUrl(src)) {
    return (
      <video
        src={src}
        aria-label={alt}
        className={className}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
      />
    )
  }

  return <img src={src} alt={alt} className={className} />
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { skillId } = await params
  const skill = await getSkill(skillId)
  if (!skill) return {}

  const metadata = buildPublicMetadata({
    title: `${skillTitle(skill)} - Makaron AI Skill`,
    description: skillDescription(skill),
    path: `/home/${skill.id}`,
    image: seoImageForSkill(skill),
    keywords: ['Makaron skill', 'AI image skill', skillTitle(skill)],
  })

  if (!isIndexableSkill(skill)) {
    metadata.robots = {
      index: false,
      follow: true,
      googleBot: {
        index: false,
        follow: true,
      },
    }
  }

  return metadata
}

export default async function SkillDetailPage({ params }: Props) {
  const { skillId } = await params
  const skill = await getSkill(skillId)
  if (!skill) notFound()

  const title = skillTitle(skill)
  const desc = skillDescription(skill)
  const beforeImages = Array.isArray(skill.before_images) ? skill.before_images.slice(0, 3) : []

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${title} - Makaron AI Skill`,
    description: desc,
    url: absoluteUrl(`/home/${skill.id}`),
    image: absoluteUrl(seoImageForSkill(skill)),
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: absoluteUrl('/home'),
    },
    mainEntity: {
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Web',
      url: absoluteUrl('/home'),
    },
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <section className="relative min-h-screen overflow-hidden">
        {skill.image && (
          <SkillMedia src={skill.image} alt={`${title} preview in Makaron`} className="absolute inset-0 h-full w-full object-cover opacity-45" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/82 to-black/42" />
        <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-24 lg:grid-cols-[0.95fr_1.05fr] lg:px-10">
          <div>
            <div className="mb-10 flex flex-wrap items-center gap-4 text-sm text-white/58">
              <Link href="/makaron" className="font-semibold hover:text-white">Makaron</Link>
              <span>/</span>
              <span>AI skill</span>
            </div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-fuchsia-300/90">Makaron AI Skill</p>
            <h1 className="mt-5 text-5xl font-black leading-[0.95] tracking-normal lg:text-7xl">{title}</h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-white/72 lg:text-lg">{desc}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={`/home?skill=${skill.id}`} className="rounded-lg bg-white px-5 py-3 text-sm font-bold text-black hover:bg-white/86">
                Open this skill
              </Link>
              <Link href="/use-cases" className="rounded-lg border border-white/18 px-5 py-3 text-sm font-bold text-white hover:bg-white/8">
                Explore use cases
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.045] p-3 shadow-2xl shadow-black/30">
            <div className="relative overflow-hidden rounded-lg bg-black">
              {skill.image ? (
                <SkillMedia src={skill.image} alt={`${title} generated example`} className="aspect-[4/5] w-full object-cover" />
              ) : (
                <div className="aspect-[4/5] w-full bg-white/5" />
              )}
            </div>
            {beforeImages.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-3">
                {beforeImages.map((url, index) => (
                  <img key={url} src={url} alt={`${title} input example ${index + 1}`} className="aspect-square rounded-lg object-cover" />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-white/[0.035]">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-3 lg:px-10">
          <div className="rounded-lg border border-white/10 bg-black/24 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-fuchsia-300/75">Input</p>
            <p className="mt-4 text-sm leading-6 text-white/68">
              Upload {skill.image_count && skill.image_count > 1 ? `${skill.image_count} images` : 'an image'} and let Makaron understand the subject, style, and creative direction.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/24 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-fuchsia-300/75">Prompt</p>
            <p className="mt-4 text-sm leading-6 text-white/68">
              Start from the built-in skill prompt, then keep refining the result by chatting with the AI agent.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/24 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-fuchsia-300/75">Output</p>
            <p className="mt-4 text-sm leading-6 text-white/68">
              Save the generated image or continue into video, poster, social, and storyboard workflows in the same Makaron project.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
