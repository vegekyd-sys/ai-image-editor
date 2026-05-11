import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

/**
 * POST /api/auth/signup
 * Body: { email, password }
 *
 * Creates a user with password via admin API (no confirmation email sent).
 * The frontend then triggers signInWithOtp separately to send the OTP code.
 */
export async function POST(req: NextRequest) {
  const { email, password } = await req.json()
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  try {
    const admin = getSupabaseAdmin()

    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
    })

    if (error) {
      if (error.message?.includes('already been registered') || error.message?.includes('already exists')) {
        return NextResponse.json({ error: 'User already registered' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[auth/signup] Error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
