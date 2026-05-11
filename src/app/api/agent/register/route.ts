import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { generateChallenge } from '@/lib/challenges'

export async function GET() {
  return NextResponse.json({
    name: 'Makaron AI',
    description: 'AI image/video/music creation via CLI',
    registration: {
      step1: { method: 'POST', url: '/api/agent/register', body: {} },
      step2: { method: 'POST', url: '/api/agent/register/verify', body: { challenge_id: 'string', answer: 'string (numeric)' } },
    },
    after_registration: {
      setup: 'export MAKARON_API_KEY=<your_api_key>',
      install: 'npx makaron-cli',
      verify: 'npx makaron-cli list',
    },
    cli_usage: {
      create_project: 'npx makaron-cli create --image <path_or_url>',
      edit_image: 'npx makaron-cli chat --project <id> "your instruction"',
      generate_video: 'npx makaron-cli chat --project <id> "create a 5 second video"',
      add_music: 'npx makaron-cli chat --project <id> "add background music"',
      list_projects: 'npx makaron-cli list',
    },
    capabilities: ['image editing', 'style transfer', 'text-to-image', 'video generation', 'background music', 'motion graphics'],
    welcome_credits: 500,
    claim: { method: 'POST', url: '/api/agent/claim', auth: 'Bearer <api_key>', returns: 'claim_url for human' },
    docs: 'https://www.makaron.app/agent',
  })
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()

  // Check if registration is enabled
  const { data: setting } = await admin.from('app_settings').select('value').eq('key', 'agent_registration_enabled').single()
  if (setting?.value !== 'true') {
    return NextResponse.json({ error: 'agent_registration_disabled' }, { status: 503 })
  }

  // IP rate limiting: max 5 challenges per IP per hour
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { count } = await admin
    .from('agent_challenges')
    .select('id', { count: 'exact', head: true })
    .eq('ip_address', ip)
    .gte('created_at', oneHourAgo)

  if ((count ?? 0) >= 5) {
    return NextResponse.json({ error: 'rate_limited', message: 'Too many registration attempts. Try again in 1 hour.' }, { status: 429 })
  }

  // Generate challenge
  const challenge = generateChallenge()

  const { data, error } = await admin
    .from('agent_challenges')
    .insert({
      challenge_text: challenge.text,
      expected_answer: String(challenge.answer),
      ip_address: ip,
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }

  return NextResponse.json({
    challenge_id: data.id,
    challenge: challenge.text,
    hint: 'Solve the math problem and POST your answer to /api/agent/register/verify',
  })
}
