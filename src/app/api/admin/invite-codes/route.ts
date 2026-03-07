import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

const ADMIN_EMAILS = ['vege_kyd@msn.com']

async function checkAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !ADMIN_EMAILS.includes(user.email || '')) return null
  return user
}

// GET: list all invite codes
export async function GET() {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = getSupabaseAdmin()

  const { data: codes, error } = await admin
    .from('invite_codes')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch users grouped by invite code via SQL join
  const { data: rows } = await admin.rpc('get_invite_code_users') as { data: { invite_code_used: string, email: string }[] | null }

  // Fallback: direct query if RPC not available
  let usersByCode: Record<string, string[]> = {}
  if (!rows) {
    const { data: profiles } = await admin
      .from('user_profiles')
      .select('id, invite_code_used')
      .not('invite_code_used', 'is', null)

    if (profiles && profiles.length > 0) {
      // Fetch emails one by one via auth admin
      for (const p of profiles) {
        try {
          const { data: { user } } = await admin.auth.admin.getUserById(p.id)
          if (user?.email && p.invite_code_used) {
            if (!usersByCode[p.invite_code_used]) usersByCode[p.invite_code_used] = []
            usersByCode[p.invite_code_used].push(user.email)
          }
        } catch { /* skip */ }
      }
    }
  } else {
    for (const r of rows) {
      if (!usersByCode[r.invite_code_used]) usersByCode[r.invite_code_used] = []
      usersByCode[r.invite_code_used].push(r.email)
    }
  }

  const result = (codes || []).map(c => ({
    ...c,
    users: usersByCode[c.code] || [],
  }))

  return NextResponse.json(result)
}

// POST: create a new invite code
export async function POST(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { code, max_uses, expires_at } = await req.json()

  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Code is required' }, { status: 400 })
  }

  const { data, error } = await getSupabaseAdmin()
    .from('invite_codes')
    .insert({
      code: code.trim().toUpperCase(),
      max_uses: max_uses || 30,
      expires_at: expires_at || null,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Code already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
