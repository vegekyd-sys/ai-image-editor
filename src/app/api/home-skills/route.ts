import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

export async function GET() {
  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('home_skills')
      .select('id, labels, image, prompt, skill_path, image_count, sort_order, updated_at, before_images')
      .eq('is_active', true)
      .order('sort_order')

    const cacheHeaders = { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' }
    if (error) return NextResponse.json([], { status: 200, headers: cacheHeaders })

    return NextResponse.json(data || [], { headers: cacheHeaders })
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}
