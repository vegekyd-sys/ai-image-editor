import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

// Public endpoint — no auth required
// Adds email to waitlist
export async function POST(req: NextRequest) {
  const { email } = await req.json()

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ success: false, error: 'Valid email is required' }, { status: 400 })
  }

  const normalized = email.trim().toLowerCase()

  const { error } = await getSupabaseAdmin()
    .from('waitlist')
    .upsert({ email: normalized }, { onConflict: 'email' })

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to join waitlist' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
