import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

// Public endpoint — no auth required
// Checks if an invite code is valid (exists, not expired, not maxed out)
export async function POST(req: NextRequest) {
  const { code } = await req.json()

  if (!code || typeof code !== 'string') {
    return NextResponse.json({ valid: false, error: 'Code is required' }, { status: 400 })
  }

  const { data, error } = await getSupabaseAdmin()
    .from('invite_codes')
    .select('id, max_uses, used_count, expires_at')
    .eq('code', code.trim().toUpperCase())
    .single()

  if (error || !data) {
    return NextResponse.json({ valid: false, error: 'Invalid invite code' })
  }

  if (data.used_count >= data.max_uses) {
    return NextResponse.json({ valid: false, error: 'Invite code has been fully used' })
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ valid: false, error: 'Invite code has expired' })
  }

  return NextResponse.json({ valid: true })
}
