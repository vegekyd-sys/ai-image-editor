import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

/**
 * POST /api/auth/continue
 * Body: { email }
 *
 * Checks if a user exists and their confirmation status.
 * Frontend uses this to decide whether to call signInWithPassword or signUp.
 * This prevents the "blind signUp" that triggers duplicate verification emails.
 *
 * Returns:
 *  { action: 'login' }        — user exists & email confirmed → frontend calls signInWithPassword
 *  { action: 'signup' }       — user doesn't exist → frontend calls signUp (sends 1 email)
 *  { action: 'verify-email' } — user exists but email not confirmed → show verify view (no new email)
 */
export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ action: 'error', message: 'Email required' }, { status: 400 })
  }

  try {
    const admin = getSupabaseAdmin()

    // Use GoTrue admin REST API with filter param (supported in newer versions)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1&filter=${encodeURIComponent(email.toLowerCase())}`,
      {
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      }
    )

    if (!res.ok) {
      console.error('[auth/continue] Admin API error:', res.status)
      // Fallback: let frontend handle normally (signIn then signUp)
      return NextResponse.json({ action: 'login' })
    }

    const data = await res.json()
    const users = data.users || []
    const user = users.find((u: { email?: string }) => u.email?.toLowerCase() === email.toLowerCase())

    if (!user) {
      return NextResponse.json({ action: 'signup' })
    }

    if (!user.email_confirmed_at) {
      return NextResponse.json({ action: 'verify-email' })
    }

    return NextResponse.json({ action: 'login' })
  } catch (e) {
    console.error('[auth/continue] Error:', e)
    void e
    // Fallback: let frontend try login first
    return NextResponse.json({ action: 'login' })
  }
}
