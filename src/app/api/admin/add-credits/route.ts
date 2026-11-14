import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID } from 'crypto'
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

  const body = await req.json().catch(() => null)
  const { email, apiKey, credits } = body ?? {}
  const suppliedTargets = [email, apiKey].filter(value => value !== undefined)
  if (suppliedTargets.length !== 1 || typeof suppliedTargets[0] !== 'string' ||
      !suppliedTargets[0].trim() || !Number.isSafeInteger(credits) || credits <= 0) {
    return NextResponse.json({ error: 'Provide either email/user ID or apiKey, and credits as a positive integer' }, { status: 400 })
  }

  const target = suppliedTargets[0].trim()
  const isApiKey = apiKey !== undefined || target.startsWith('mk_live_')
  if (isApiKey && !target.startsWith('mk_live_')) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  let targetId: string | null = null

  if (isApiKey) {
    // Resolve ownership without authenticating as the target or updating last_used_at.
    const { data, error } = await admin
      .from('api_keys')
      .select('user_id')
      .eq('key_hash', createHash('sha256').update(target).digest('hex'))
      .eq('is_active', true)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: 'Unable to look up API key owner' }, { status: 503 })
    }
    if (data) targetId = data.user_id
  } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) {
    targetId = target
  } else {
    // Use RPC function to query auth.users directly (listUsers doesn't work with service role).
    const { data, error } = await admin.rpc('get_user_id_by_email', { p_email: target })
    if (error) {
      return NextResponse.json({ error: 'Unable to look up user' }, { status: 503 })
    }
    if (data) targetId = data
  }

  if (!targetId) {
    return NextResponse.json({ error: isApiKey ? 'Active API key not found' : 'User not found. You can also paste a user_id (UUID).' }, { status: 404 })
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
    ...(isApiKey ? {} : { email: target }),
    credits,
    newBalance: grant.balance,
  })
}
