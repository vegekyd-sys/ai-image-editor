import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createMusic } from '@/lib/skills/create-music'
import { requireCredits } from '@/lib/billing/credits'
import { deductSeedAudioCredits, seedAudioMakaronCredits } from '@/lib/billing/seed-audio'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { prompt, instrumental, style, projectId, durationSeconds } = await req.json()

    if (!prompt) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
    }

    // Pre-flight credit check
    const creditCheck = await requireCredits(
      user.id,
      seedAudioMakaronCredits({ durationSeconds: durationSeconds ?? 20 }) || 10,
    )
    if (!creditCheck.ok) return creditCheck.response

    const result = await createMusic({
      prompt,
      instrumental,
      style,
      durationSeconds,
      supabase,
      userId: user.id,
      projectId,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 500 })
    }

    // Deduct credits for Seed Audio by actual generated-audio usage.
    deductSeedAudioCredits(user.id, {
      durationSeconds: result.duration,
      providerCreditsUsed: result.creditsUsed,
      model: result.model,
      generationSeconds: result.generationSeconds,
    })
      .catch(e => console.error('[billing] music deduct error:', e))

    return NextResponse.json({
      taskId: result.taskId,
      status: result.status,
      audioUrl: result.audioUrl,
      title: result.title,
      duration: result.duration,
      trackIndex: result.trackIndex,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/music POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
