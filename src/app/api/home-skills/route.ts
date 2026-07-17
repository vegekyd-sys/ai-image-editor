import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { mergeHomeSkillLocalization } from '@/lib/home-skill-localizations.server'

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
}

const LEGACY_COLUMNS = 'id, labels, image, prompt, skill_path, image_count, sort_order, updated_at, before_images'
const LOCALIZED_COLUMNS = `${LEGACY_COLUMNS}, prompts, categories`

function normalizeRows(rows: unknown[] | null): unknown[] {
  return (rows || []).map((value) => {
    const row = value as Record<string, unknown>
    return mergeHomeSkillLocalization({
      ...row,
      prompts: row.prompts && typeof row.prompts === 'object' && !Array.isArray(row.prompts)
        ? row.prompts
        : {},
      categories: Array.isArray(row.categories) ? row.categories : [],
    })
  })
}

export async function GET() {
  try {
    const admin = getSupabaseAdmin()
    const localizedResult = await admin
      .from('home_skills')
      .select(LOCALIZED_COLUMNS)
      .eq('is_active', true)
      .order('sort_order')

    if (!localizedResult.error) {
      return NextResponse.json(normalizeRows(localizedResult.data), { headers: CACHE_HEADERS })
    }

    // During a rolling deploy the API can reach a database where the additive
    // prompts/categories migration has not run yet. Keep the existing home
    // usable by retrying with the legacy projection.
    const legacyResult = await admin
      .from('home_skills')
      .select(LEGACY_COLUMNS)
      .eq('is_active', true)
      .order('sort_order')

    if (legacyResult.error) {
      return NextResponse.json([], { status: 200, headers: CACHE_HEADERS })
    }

    return NextResponse.json(normalizeRows(legacyResult.data), { headers: CACHE_HEADERS })
  } catch {
    return NextResponse.json([], { status: 200, headers: CACHE_HEADERS })
  }
}
