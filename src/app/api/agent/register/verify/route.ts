import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { generateApiKey } from '@/lib/billing/api-keys'
import { addCredits } from '@/lib/billing/credits'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.challenge_id || body.answer === undefined) {
    return NextResponse.json({ error: 'missing_fields', message: 'Provide challenge_id and answer' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  // Find challenge
  const { data: challenge } = await admin
    .from('agent_challenges')
    .select('*')
    .eq('id', body.challenge_id)
    .single()

  if (!challenge) {
    return NextResponse.json({ error: 'challenge_not_found' }, { status: 404 })
  }

  // Check expiry (5 minutes)
  const elapsed = Date.now() - new Date(challenge.created_at).getTime()
  if (elapsed > 5 * 60 * 1000) {
    return NextResponse.json({ error: 'challenge_expired', message: 'Challenge expired. Request a new one.' }, { status: 410 })
  }

  // Check already used
  if (challenge.verified_at) {
    return NextResponse.json({ error: 'challenge_used', message: 'Challenge already verified.' }, { status: 409 })
  }

  // Compare answer (numeric, allow ±0.01 tolerance)
  const expected = parseFloat(challenge.expected_answer)
  const given = parseFloat(String(body.answer))
  if (isNaN(given) || Math.abs(expected - given) > 0.01) {
    return NextResponse.json({ error: 'incorrect_answer' }, { status: 403 })
  }

  // Create agent user
  const agentId = randomBytes(6).toString('hex')
  const email = `agent_${agentId}@agents.makaron.app`
  const password = randomBytes(32).toString('hex')

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    return NextResponse.json({ error: 'user_creation_failed', message: authError?.message }, { status: 500 })
  }

  const userId = authData.user.id

  // Create profile
  await admin.from('user_profiles').upsert({
    id: userId,
    is_agent: true,
    activated: true,
  }, { onConflict: 'id' })

  // Welcome credits
  const { data: creditSetting } = await admin.from('app_settings').select('value').eq('key', 'welcome_credits').single()
  const welcomeCredits = parseInt(creditSetting?.value || '500')

  await addCredits(userId, welcomeCredits)
  await admin.from('credit_purchases').insert({
    user_id: userId,
    stripe_session_id: `agent_welcome_${Date.now()}`,
    credits: welcomeCredits,
    amount_usd: 0,
    status: 'completed',
    source: 'welcome',
  }).then(() => {})

  // Generate API key
  const { key } = await generateApiKey(userId, 'Agent Auto-Registration')

  // Mark challenge verified
  await admin
    .from('agent_challenges')
    .update({ verified_at: new Date().toISOString(), user_id: userId })
    .eq('id', challenge.id)

  return NextResponse.json({
    api_key: key,
    credits: welcomeCredits,
    quick_start: {
      step1: `export MAKARON_API_KEY=${key}`,
      step2: 'npx makaron-cli create --image photo.jpg',
      step3: 'npx makaron-cli chat --project <id> "make it cinematic"',
    },
  })
}
