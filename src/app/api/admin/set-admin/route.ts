import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { isAdmin } from '@/lib/admin'
import { getSupabaseAdmin } from '@/lib/supabase/service'

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

  // Set admin flag
  const { error } = await admin
    .from('user_profiles')
    .update({ is_admin: true })
    .eq('id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, userId })
}
