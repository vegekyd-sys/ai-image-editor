import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

// GET: paginated usage history for the authenticated user
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const offset = parseInt(url.searchParams.get('offset') || '0')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100)

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('usage_logs')
    .select('tool_name, model_used, credits_charged, input_tokens, output_tokens, source, duration_ms, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ usage: data ?? [], offset, limit })
}
