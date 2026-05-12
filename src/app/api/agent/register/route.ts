import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { generateChallenge } from '@/lib/challenges'

export async function GET() {
  return NextResponse.json({
    name: 'Makaron AI',
    description: 'AI image/video/music creation via CLI',
    registration: {
      method_a_cli: {
        step1: 'npx makaron-cli register --json → { challenge_id, challenge, expected_format }',
        step2: 'npx makaron-cli register --verify --challenge-id <id> --answer <number> → { api_key, credits, claim_url }',
      },
      method_b_api: {
        step1: { method: 'POST', url: '/api/agent/register', body: {} },
        step2: { method: 'POST', url: '/api/agent/register/verify', body: { challenge_id: 'string', answer: 'string (numeric, 2dp)' } },
      },
    },
    after_registration: {
      setup: 'export MAKARON_API_KEY=<your_api_key>',
      one_shot: 'RUN_ID=$(npx makaron-cli chat --project auto --image photo.jpg -b "make it cinematic")',
      watch: 'npx makaron-cli responses watch $RUN_ID --jsonl',
    },
    cli_usage: {
      one_shot: 'npx makaron-cli chat --project auto --image <path> -b "<prompt>"',
      existing_project: 'npx makaron-cli chat --project <id> -b "<prompt>"',
      watch_results: 'npx makaron-cli responses watch <runId> --jsonl',
      pick_result: 'npx makaron-cli responses get <runId> --pick first_image_url',
      list_projects: 'npx makaron-cli list',
    },
    capabilities: ['image editing', 'style transfer', 'text-to-image', 'video generation', 'background music', 'motion graphics'],
    welcome_credits: 'auto (configured by admin)',
    claim: { method: 'POST', url: '/api/agent/claim', auth: 'Bearer <api_key>', returns: 'claim_url (7 day expiry)' },
    claim_cli: 'npx makaron-cli claim',
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
    expected_format: 'numeric, round to 2 decimal places',
    hint: 'Solve the math problem. Numbers may be in Chinese or Esperanto. Ignore special characters.',
  })
}
