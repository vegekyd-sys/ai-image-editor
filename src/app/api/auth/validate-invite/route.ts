import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

// Authenticated endpoint — validates invite code and activates user
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { code, autoActivate } = await req.json()

  // Auto-activate: user already activated in DB, or existing user with projects
  if (autoActivate) {
    const admin = getSupabaseAdmin()

    // Check if already activated in user_profiles
    const { data: profile } = await admin
      .from('user_profiles')
      .select('activated')
      .eq('id', user.id)
      .single()

    if (profile?.activated) {
      const response = NextResponse.json({ success: true, autoActivated: true })
      response.cookies.set('mkr_activated', '1', {
        path: '/',
        maxAge: 365 * 24 * 60 * 60,
        sameSite: 'lax',
      })
      return response
    }

    // Fallback: existing user with projects (legacy users before activation system)
    const { count } = await admin
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (count && count > 0) {
      await admin
        .from('user_profiles')
        .upsert({ id: user.id, activated: true }, { onConflict: 'id' })

      const response = NextResponse.json({ success: true, autoActivated: true })
      response.cookies.set('mkr_activated', '1', {
        path: '/',
        maxAge: 365 * 24 * 60 * 60,
        sameSite: 'lax',
      })
      return response
    }

    return NextResponse.json({ success: false, error: 'Not activated' })
  }

  // Normal flow: validate invite code
  if (!code || typeof code !== 'string') {
    return NextResponse.json({ success: false, error: 'Code is required' }, { status: 400 })
  }

  const normalizedCode = code.trim().toUpperCase()

  const { data: inviteCode, error: fetchError } = await getSupabaseAdmin()
    .from('invite_codes')
    .select('id, max_uses, used_count, expires_at')
    .eq('code', normalizedCode)
    .single()

  if (fetchError || !inviteCode) {
    return NextResponse.json({ success: false, error: 'Invalid invite code' })
  }

  if (inviteCode.used_count >= inviteCode.max_uses) {
    return NextResponse.json({ success: false, error: 'Invite code has been fully used' })
  }

  if (inviteCode.expires_at && new Date(inviteCode.expires_at) < new Date()) {
    return NextResponse.json({ success: false, error: 'Invite code has expired' })
  }

  // Atomically increment used_count
  await getSupabaseAdmin()
    .from('invite_codes')
    .update({ used_count: inviteCode.used_count + 1 })
    .eq('id', inviteCode.id)
    .eq('used_count', inviteCode.used_count) // optimistic lock

  // Upsert user profile as activated
  await getSupabaseAdmin()
    .from('user_profiles')
    .upsert({
      id: user.id,
      activated: true,
      invite_code_used: normalizedCode,
    }, { onConflict: 'id' })

  const response = NextResponse.json({ success: true })
  response.cookies.set('mkr_activated', '1', {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    sameSite: 'lax',
  })
  return response
}
