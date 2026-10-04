import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { isAdmin } from '@/lib/admin'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { syncCodexAdminAllowlist } from '@/lib/personal-subscription-admin'

export async function POST(req: NextRequest) {
  const authResult = await authenticateRequest(req)
  if ('error' in authResult) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await isAdmin(authResult.auth.userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const admin = getSupabaseAdmin()

  // Find user by email via RPC (handles large user tables)
  const { data: userId, error: rpcErr } = await admin.rpc('get_user_id_by_email', { p_email: email })
  if (rpcErr || !userId) return NextResponse.json({ error: `User not found: ${email}` }, { status: 404 })

  const { data: profile, error: profileError } = await admin
    .from('user_profiles').select('is_admin').eq('id', userId).maybeSingle()
  if (profileError || !profile) return NextResponse.json({ error: 'User profile unavailable' }, { status: 500 })

  const { error } = await admin
    .from('user_profiles')
    .update({ is_admin: true })
    .eq('id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await syncCodexAdminAllowlist()
  } catch (syncError) {
    if (!profile.is_admin) {
      const { error: rollbackError } = await admin.from('user_profiles')
        .update({ is_admin: false }).eq('id', userId)
      if (rollbackError) console.error('[admin] role rollback failed:', rollbackError)
    }
    console.error('[admin] Codex relay sync failed:', syncError)
    return NextResponse.json({ error: 'codex_admin_sync_failed' }, { status: 502 })
  }

  return NextResponse.json({ success: true, userId })
}
