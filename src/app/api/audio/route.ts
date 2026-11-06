import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAudio } from '@/lib/skills/create-audio'
import { requireCredits } from '@/lib/billing/credits'
import { deductAudioCredits, quoteAudioGeneration } from '@/lib/billing/audio'
import { getAudioModelCapability, resolveAudioRoute } from '@/lib/audio-model-capabilities'

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
      instrumental,
      style,
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

    const references = audioReferences ?? audio_references
    const images = imageUrls ?? image_urls
    const route = resolveAudioRoute({
      kind,
      model,
      instrumental,
      audioReferenceCount: Array.isArray(references) ? references.length : 0,
      imageReferenceCount: Array.isArray(images) ? images.length : 0,
    })
    if ('error' in route) return NextResponse.json({ error: route.error }, { status: 400 })
    const { credits: estimatedCredits } = await quoteAudioGeneration({
      provider: getAudioModelCapability(route.modelId).provider,
      durationSeconds: durationSeconds ?? duration_seconds ?? 20,
    })
    const creditCheck = await requireCredits(user.id, estimatedCredits || 10)
    if (!creditCheck.ok) return creditCheck.response

    const result = await createAudio({
      prompt,
      kind,
      instrumental,
      style,
      targetLanguage: targetLanguage ?? target_language,
      translatedScript: translatedScript ?? translated_script,
      durationSeconds: durationSeconds ?? duration_seconds,
      audioReferences: references,
      imageUrls: images,
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

    if (result.billing) {
      deductAudioCredits(user.id, result.billing)
        .catch(e => console.error('[billing] audio deduct error:', e))
    }

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/audio POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
