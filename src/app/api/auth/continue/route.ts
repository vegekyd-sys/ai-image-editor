import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

/**
 * POST /api/auth/continue
 * Body: { email }
 *
 * Checks if a user exists and their confirmation status.
 * Frontend uses this to decide whether to call signInWithPassword or signUp.
 */
export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ action: 'error', message: 'Email required' }, { status: 400 })
  }

  try {
    const admin = getSupabaseAdmin()

    // Use RPC to find user by email (works regardless of user count)
    const { data: userId } = await admin.rpc('get_user_id_by_email', { p_email: email.toLowerCase() })

    if (!userId) {
      return NextResponse.json({ action: 'signup' })
    }

    // User exists — check if email is confirmed via admin API
    const { data: userData } = await admin.auth.admin.getUserById(userId)
    if (!userData?.user) {
      return NextResponse.json({ action: 'signup' })
    }

    return NextResponse.json({ action: 'login' })
  } catch (e) {
    console.error('[auth/continue] Error:', e)
    return NextResponse.json({ action: 'login' })
  }
}
