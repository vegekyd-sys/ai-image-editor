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

  // Find user by email
  const { data: { users }, error: listErr } = await admin.auth.admin.listUsers()
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })
  const target = users.find(u => u.email === email)
  if (!target) return NextResponse.json({ error: `User not found: ${email}` }, { status: 404 })

  // Set admin flag
  const { error } = await admin
    .from('user_profiles')
    .update({ is_admin: true })
    .eq('id', target.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, userId: target.id })
}
