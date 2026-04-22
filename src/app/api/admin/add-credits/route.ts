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

  // Find user by email
  const admin = getSupabaseAdmin()
  const { data: profiles } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const target = profiles?.users?.find(u => u.email === email)
  if (!target) {
    return NextResponse.json({ error: `User not found: ${email}` }, { status: 404 })
  }

  const newBalance = await addCredits(target.id, credits)

  // Record
  await admin.from('credit_purchases').insert({
    user_id: target.id,
    stripe_session_id: `admin_${Date.now()}`,
    credits,
    amount_usd: 0,
    status: 'completed',
    source: 'admin',
  })

  return NextResponse.json({ success: true, userId: target.id, email, credits, newBalance })
}
