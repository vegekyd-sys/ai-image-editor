import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
}

export async function GET() {
  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('skill_categories')
      .select('id, labels, descriptions, sort_order, icon, is_active')
      .eq('is_active', true)
      .order('sort_order')

    // An empty list is the backwards-compatible "All" experience while the
    // additive migration rolls out or if category loading fails.
    if (error) return NextResponse.json([], { headers: CACHE_HEADERS })
    return NextResponse.json(data || [], { headers: CACHE_HEADERS })
  } catch {
    return NextResponse.json([], { status: 200, headers: CACHE_HEADERS })
  }
}
