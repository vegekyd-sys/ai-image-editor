import type { MetadataRoute } from 'next'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { SITE_URL } from '@/lib/seo'
import { useCasePages } from '@/lib/public-seo-pages'
import { isIndexableSkill } from '@/lib/seo-skill-filter'

export const revalidate = 3600

type SkillRow = {
  id: string
  labels: Record<string, string> | null
  prompt: string | null
  updated_at: string | null
}

async function getActiveSkillPages(): Promise<MetadataRoute.Sitemap> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return []
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('home_skills')
      .select('id, labels, prompt, updated_at')
      .eq('is_active', true)
      .order('sort_order')
      .limit(80)

    if (error || !data) return []

    return (data as SkillRow[])
      .filter(isIndexableSkill)
      .map((skill) => ({
        url: `${SITE_URL}/skill/${skill.id}`,
        lastModified: skill.updated_at ? new Date(skill.updated_at) : new Date(),
        changeFrequency: 'weekly',
        priority: 0.72,
      }))
  } catch {
    return []
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/home`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${SITE_URL}/makaron`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.92,
    },
    {
      url: `${SITE_URL}/landingpage`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.65,
    },
    {
      url: `${SITE_URL}/agent`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.68,
    },
    {
      url: `${SITE_URL}/releases/video-in-timeline`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/use-cases`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.86,
    },
    ...useCasePages.map((page) => ({
      url: `${SITE_URL}/use-cases/${page.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.82,
    })),
  ]

  return [...staticPages, ...(await getActiveSkillPages())]
}
