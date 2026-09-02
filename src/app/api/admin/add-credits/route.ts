import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { authenticateRequest } from '@/lib/api-auth'
import { isAdmin } from '@/lib/admin'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { grantCreditsAndRecordPurchase } from '@/lib/billing/credits'

export async function POST(req: NextRequest) {
  const authResult = await authenticateRequest(req)
  if ('error' in authResult) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await isAdmin(authResult.auth.userId))) {
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
    // Use RPC function to query auth.users directly (listUsers doesn't work with service role)
    const { data } = await admin.rpc('get_user_id_by_email', { p_email: email })
    if (data) targetId = data
  }

  if (!targetId) {
    return NextResponse.json({ error: `User not found: ${email}. You can also paste a user_id (UUID).` }, { status: 404 })
  }

  const grant = await grantCreditsAndRecordPurchase({
    userId: targetId,
    credits,
    amountUsd: 0,
    stripeSessionId: `admin_${randomUUID()}`,
    source: 'admin',
  })

  return NextResponse.json({
    success: true,
    userId: targetId,
    email,
    credits,
    newBalance: grant.balance,
  })
}
