import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

export async function GET() {
  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('home_skills')
      .select('id, labels, image, prompt, skill_path, image_count, sort_order, updated_at')
      .eq('is_active', true)
      .order('sort_order')

    if (error) return NextResponse.json([], { status: 200 })

    return NextResponse.json(data || [], {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
    })
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}
