import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { authenticateRequest } from '@/lib/api-auth'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  // Check if this is an agent requesting a claim URL (Bearer token)
  // or a human accepting a claim (session auth + token in body)
  const header = req.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null

  if (token?.startsWith('mk_live_')) {
    // Agent requesting claim URL
    return handleAgentClaimRequest(req)
  }

  // Human accepting claim
  return handleHumanClaimAccept(req)
}

async function handleAgentClaimRequest(req: NextRequest) {
  const authResult = await authenticateRequest(req)
  if ('error' in authResult) return authResult.error

  const { userId } = authResult.auth
  const admin = getSupabaseAdmin()

  // Verify this is an agent account
  const { data: profile } = await admin
    .from('user_profiles')
    .select('is_agent')
    .eq('id', userId)
    .single()

  if (!profile?.is_agent) {
    return NextResponse.json({ error: 'not_agent_account' }, { status: 400 })
  }

  // Generate claim token (1 hour expiry)
  const claimToken = `clm_${randomBytes(16).toString('hex')}`

  // Store in agent_challenges table (reuse — add claim_token column)
  // Actually let's use a simpler approach: store in user_profiles metadata
  // Store claim token as a simple row in a lightweight way
  const { error } = await admin
    .from('agent_challenges')
    .insert({
      challenge_text: `__CLAIM__:${claimToken}`,
      expected_answer: userId,
      ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'claim',
    })

  if (error) {
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.makaron.app'
  return NextResponse.json({
    claim_url: `${baseUrl}/claim?token=${claimToken}`,
  })
}


async function validateClaimToken(admin: any, token: string): Promise<Response | null> {
  const { data: claimRow } = await admin
    .from('agent_challenges')
    .select('created_at, verified_at, expected_answer')
    .eq('challenge_text', `__CLAIM__:${token}`)
    .single()

  if (!claimRow) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 404 })
  }

  if (claimRow.verified_at) {
    return NextResponse.json({ error: 'already_claimed', message: 'This agent account has already been claimed.' }, { status: 409 })
  }

  const elapsed = Date.now() - new Date(claimRow.created_at).getTime()
  if (elapsed > 7 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'token_expired', message: 'This claim link has expired (7 days). Run: npx makaron-cli claim' }, { status: 410 })
  }

  // Check if agent itself was already claimed via another token
  const { data: agentProfile } = await admin
    .from('user_profiles')
    .select('is_agent')
    .eq('id', claimRow.expected_answer)
    .single()

  if (agentProfile && !agentProfile.is_agent) {
    return NextResponse.json({ error: 'already_claimed', message: 'This agent account has already been claimed.' }, { status: 409 })
  }

  return null // valid
}

async function handleHumanClaimAccept(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.token) {
    return NextResponse.json({ error: 'missing_token' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  // Validate token (shared by check_only and actual claim)
  const tokenError = await validateClaimToken(admin, body.token)
  if (tokenError) return tokenError

  // check_only mode: just validate, don't require auth
  if (body.check_only) {
    return NextResponse.json({ valid: true })
  }

  // Actual claim requires login
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized', message: 'Please log in first' }, { status: 401 })
  }

  const humanUserId = session.user.id

  // Check: human can only claim 1 agent total
  const { count: claimedCount } = await admin
    .from('agent_challenges')
    .select('id', { count: 'exact', head: true })
    .like('challenge_text', '__CLAIM__:%')
    .not('verified_at', 'is', null)
    .eq('user_id', humanUserId)

  if ((claimedCount ?? 0) >= 1) {
    return NextResponse.json({ error: 'claim_limit_reached', message: 'You can only claim 1 agent account.' }, { status: 403 })
  }

  // Re-fetch for actual claim (already validated above)
  const { data: claimRow } = await admin
    .from('agent_challenges')
    .select('*')
    .eq('challenge_text', `__CLAIM__:${body.token}`)
    .single()

  if (!claimRow) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 404 })
  }

  const agentUserId = claimRow.expected_answer

  // Prevent self-claim
  if (agentUserId === humanUserId) {
    return NextResponse.json({ error: 'cannot_claim_self' }, { status: 400 })
  }

  // Determine new vs existing user
  const { data: existingBalance } = await admin
    .from('credit_balances')
    .select('balance')
    .eq('user_id', humanUserId)
    .single()

  const isNewUser = !existingBalance

  // Get agent's credit balance
  const { data: agentBalance } = await admin
    .from('credit_balances')
    .select('balance')
    .eq('user_id', agentUserId)
    .single()

  const agentCredits = agentBalance?.balance ?? 0
  let creditsTransferred = 0

  if (isNewUser && agentCredits > 0) {
    // New user: transfer credits (acts as their welcome credits)
    await admin.from('credit_balances').upsert({
      user_id: humanUserId,
      balance: agentCredits,
      lifetime_purchased: agentCredits,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    await admin.from('credit_purchases').insert({
      user_id: humanUserId,
      stripe_session_id: `agent_claim_${Date.now()}`,
      credits: agentCredits,
      amount_usd: 0,
      status: 'completed',
      source: 'agent_claim',
    })

    creditsTransferred = agentCredits
  }
  // Existing user: no credit transfer (anti-abuse)

  // Always: transfer API keys + usage logs
  await admin.from('api_keys').update({ user_id: humanUserId }).eq('user_id', agentUserId)
  await admin.from('usage_logs').update({ user_id: humanUserId }).eq('user_id', agentUserId)

  // Zero out agent balance
  await admin.from('credit_balances').update({ balance: 0, updated_at: new Date().toISOString() }).eq('user_id', agentUserId)

  // Mark claim as used
  await admin.from('agent_challenges').update({ verified_at: new Date().toISOString(), user_id: humanUserId }).eq('id', claimRow.id)

  // Mark agent profile as claimed
  await admin.from('user_profiles').update({ is_agent: false } as never).eq('id', agentUserId)

  return NextResponse.json({
    success: true,
    is_new_user: isNewUser,
    credits_transferred: creditsTransferred,
  })
}
