import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { addCredits } from '@/lib/billing/credits'

const ADMIN_EMAILS = ['vege_kyd@msn.com']

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !ADMIN_EMAILS.includes(user.email || '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { email, credits } = await req.json()
  if (!email || !credits || credits <= 0) {
    return NextResponse.json({ error: 'email and credits (>0) required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  let targetId: string | null = null

  // Accept UUID directly
  if (email.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    targetId = email
  } else {
    // Search auth.users by email — paginate through all
    for (let page = 1; page <= 20; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 100 })
      const found = data?.users?.find(u => u.email === email)
      if (found) { targetId = found.id; break }
      if (!data?.users?.length || data.users.length < 100) break
    }
  }

  if (!targetId) {
    return NextResponse.json({ error: `User not found: ${email}. You can also paste a user_id (UUID).` }, { status: 404 })
  }

  const newBalance = await addCredits(targetId, credits)

  // Record
  await admin.from('credit_purchases').insert({
    user_id: targetId,
    stripe_session_id: `admin_${Date.now()}`,
    credits,
    amount_usd: 0,
    status: 'completed',
    source: 'admin',
  })

  return NextResponse.json({ success: true, userId: targetId, email, credits, newBalance })
}
