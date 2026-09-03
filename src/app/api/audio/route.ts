import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAudio } from '@/lib/skills/create-audio'
import { requireCredits } from '@/lib/billing/credits'
import { deductSeedAudioCredits } from '@/lib/billing/seed-audio'
import { quoteSeedAudio } from '@/lib/billing/media-pricing'

// A 120-second output can take longer than 120 seconds to render and persist.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const {
      prompt,
      kind,
      targetLanguage,
      target_language,
      translatedScript,
      translated_script,
      durationSeconds,
      duration_seconds,
      audioReferences,
      audio_references,
      imageUrls,
      image_urls,
      speechRate,
      speech_rate,
      loudnessRate,
      loudness_rate,
      pitchRate,
      pitch_rate,
      format,
      sampleRate,
      sample_rate,
      callbackUrl,
      callback_url,
      title,
      projectId,
      project_id,
      model,
    } = body
    if (!prompt && kind !== 'translation') {
      return NextResponse.json({ error: 'prompt is required unless kind=translation' }, { status: 400 })
    }

    const { credits: estimatedCredits } = await quoteSeedAudio({ durationSeconds: durationSeconds ?? duration_seconds ?? 20 })
    const creditCheck = await requireCredits(user.id, estimatedCredits || 10)
    if (!creditCheck.ok) return creditCheck.response

    const result = await createAudio({
      prompt,
      kind,
      targetLanguage: targetLanguage ?? target_language,
      translatedScript: translatedScript ?? translated_script,
      durationSeconds: durationSeconds ?? duration_seconds,
      audioReferences: audioReferences ?? audio_references,
      imageUrls: imageUrls ?? image_urls,
      speechRate: speechRate ?? speech_rate,
      loudnessRate: loudnessRate ?? loudness_rate,
      pitchRate: pitchRate ?? pitch_rate,
      format,
      sampleRate: sampleRate ?? sample_rate,
      callbackUrl: callbackUrl ?? callback_url,
      title,
      model,
      supabase,
      userId: user.id,
      projectId: projectId ?? project_id,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 500 })
    }

    deductSeedAudioCredits(user.id, {
      durationSeconds: result.duration,
      providerCreditsUsed: result.creditsUsed,
      model: result.model,
      generationSeconds: result.generationSeconds,
    })
      .catch(e => console.error('[billing] audio deduct error:', e))

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/audio POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
