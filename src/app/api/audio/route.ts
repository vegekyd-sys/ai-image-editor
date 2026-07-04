import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAudio } from '@/lib/skills/create-audio'
import { requireCredits, deductCredits } from '@/lib/billing/credits'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { prompt, durationSeconds, duration_seconds, title, projectId, model } = await req.json()
    if (!prompt) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
    }

    const creditCheck = await requireCredits(user.id, 10)
    if (!creditCheck.ok) return creditCheck.response

    const result = await createAudio({
      prompt,
      durationSeconds: durationSeconds ?? duration_seconds,
      title,
      model,
      supabase,
      userId: user.id,
      projectId,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 500 })
    }

    deductCredits(user.id, null, 'create_music')
      .catch(e => console.error('[billing] audio deduct error:', e))

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/audio POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
