import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createVideo } from '@/lib/skills/create-video'
import { filterAndRemapImages } from '@/lib/kling'
import {
  deductFixedCredits,
  isInsufficientCreditsError,
  refundCredits,
  requireCredits,
} from '@/lib/billing/credits'
import { estimateVideoCredits, getVideoModelCapability, normalizeVideoModelId, resolveVideoGenerationRoute, resolveVideoOutputDuration, supportsNativeTextToVideo } from '@/lib/video-model-capabilities'

export const maxDuration = 1800

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, imageUrls, prompt, duration, aspectRatio, videoModel, videoResolution, videoOperation, videoExtendDirection } = await req.json()
    const selectedVideoModel = normalizeVideoModelId(videoModel)
    const videoCapability = getVideoModelCapability(selectedVideoModel)
    const videoRoute = resolveVideoGenerationRoute({ model: selectedVideoModel, resolution: videoResolution })
    const inputImageUrls: string[] = Array.isArray(imageUrls) ? [...imageUrls] : []

    if (!projectId || !prompt || (inputImageUrls.length === 0 && !supportsNativeTextToVideo(selectedVideoModel))) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Verify project belongs to user
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Auto-route video references: detect video snapshots in imageUrls
    const { data: dbSnaps } = await supabase
      .from('snapshots')
      .select('type, video_meta')
      .eq('project_id', projectId)
      .order('sort_order')
    const autoVideoUrls: string[] = []
    const referenceVideoMetas: Array<{ width?: number | null; height?: number | null }> = []
    let referenceVideoDuration: number | undefined
    if (dbSnaps?.length) {
      const scriptRefs = [...new Set(
        Array.from(prompt.matchAll(/<<<(?:image|media)_(\d+)>>>/g), (m: RegExpMatchArray) => Number(m[1]))
      )]
      for (const ref of scriptRefs) {
        const snap = dbSnaps[ref - 1]
        const meta = snap?.video_meta as Record<string, unknown> | null
        const videoUrl = meta?.videoUrl as string | undefined
        if (snap?.type === 'video' && videoUrl) {
          autoVideoUrls.push(videoUrl)
          referenceVideoMetas.push({
            width: Number.isFinite(Number(meta?.width)) ? Number(meta?.width) : null,
            height: Number.isFinite(Number(meta?.height)) ? Number(meta?.height) : null,
          })
          const sourceDuration = Number(meta?.duration)
          if (Number.isFinite(sourceDuration) && sourceDuration > 0) {
            referenceVideoDuration = (referenceVideoDuration ?? 0) + sourceDuration
          }
          inputImageUrls[ref - 1] = ''
        }
      }
    }
    if (referenceVideoDuration != null && referenceVideoDuration > videoCapability.maxReferenceVideoDuration + 0.5) {
      return NextResponse.json({ error: `Reference video duration too long (${referenceVideoDuration.toFixed(1).replace(/\.0$/, '')}s). Maximum ${videoCapability.maxReferenceVideoDuration}s with small metadata tolerance.` }, { status: 400 })
    }
    const effectiveDuration = resolveVideoOutputDuration({
      requestedDuration: duration,
      referenceVideoDuration,
      model: selectedVideoModel,
      operation: videoOperation,
    })
    let providerAutoVideoUrls = autoVideoUrls
    if (autoVideoUrls.length > 0) {
      const { prepareProviderVideoReferences } = await import('@/lib/provider-video-reference')
      const prepared = await prepareProviderVideoReferences({
        supabase,
        userId: user.id,
        projectId,
        urls: autoVideoUrls,
        reason: videoRoute.provider,
      })
      if (prepared.normalized.length > 0) {
        console.log(`[animate] normalized ${prepared.normalized.length} video reference(s) for provider input`)
      }
      providerAutoVideoUrls = prepared.urls
    }

    const { filteredImages, finalPrompt } = filterAndRemapImages(prompt, inputImageUrls, videoCapability.maxImageReferences ?? 7)
    const videoSec = effectiveDuration || 10
    const creditsRequired = estimateVideoCredits({
      model: selectedVideoModel,
      resolution: videoRoute.resolution,
      durationSec: videoSec,
      imageCount: filteredImages.length,
      referenceVideoDurationSec: referenceVideoDuration,
      operation: videoOperation,
    }) ?? Math.ceil(videoSec * 22)
    const toolName = selectedVideoModel === 'grok' ? 'create_video_grok' : 'create_video'
    const creditCheck = await requireCredits(user.id, creditsRequired)
    if (!creditCheck.ok) return creditCheck.response

    let reservedCredits = 0
    try {
      const reservation = await deductFixedCredits(
        user.id,
        creditsRequired,
        toolName,
        selectedVideoModel,
        undefined,
      )
      reservedCredits = reservation.charged
    } catch (error) {
      if (isInsufficientCreditsError(error)) {
        return NextResponse.json({
          error: 'insufficient_credits',
          balance: error.balance,
          needed: error.required,
          action: 'topup',
        }, { status: 402 })
      }
      throw error
    }

    try {
      const skillResult = await createVideo({
        script: prompt,
        images: inputImageUrls,
        duration: effectiveDuration,
        aspectRatio,
        videoModel: selectedVideoModel,
        videoResolution: videoRoute.resolution,
        videoUrls: providerAutoVideoUrls.length ? providerAutoVideoUrls : undefined,
        referenceVideoDuration,
        referenceVideoMetas: referenceVideoMetas.length ? referenceVideoMetas : undefined,
        videoOperation,
        videoExtendDirection,
      })

      if (!skillResult.success || !skillResult.taskId) {
        if (reservedCredits > 0) {
          await refundCredits(user.id, reservedCredits, toolName)
          reservedCredits = 0
        }
        return NextResponse.json({
          error: skillResult.message,
          ...(skillResult.errorCode ? { code: skillResult.errorCode } : {}),
          ...(skillResult.errorReason ? { reason: skillResult.errorReason } : {}),
          ...(skillResult.errorDetails ? { details: skillResult.errorDetails } : {}),
          ...(skillResult.retryable === false ? { retryable: false } : {}),
          ...(skillResult.repairable != null ? { repairable: skillResult.repairable } : {}),
          ...(skillResult.terminal != null ? { terminal: skillResult.terminal } : {}),
          ...(skillResult.suggestedAction ? { suggestedAction: skillResult.suggestedAction } : {}),
        }, { status: skillResult.retryable === false ? 400 : 500 })
      }

      const taskId = skillResult.taskId
      const { data: animation, error } = await supabase
        .from('project_animations')
        .insert({
          project_id: projectId,
          piapi_task_id: taskId,
          status: skillResult.status === 'completed' && skillResult.videoUrl ? 'completed' : 'processing',
          prompt: finalPrompt,
          snapshot_urls: filteredImages,
          video_url: skillResult.videoUrl || null,
        })
        .select('id')
        .single()

      if (error) throw error

      reservedCredits = 0
      return NextResponse.json({ animationId: animation.id, taskId })
    } catch (error) {
      if (reservedCredits > 0) {
        await refundCredits(user.id, reservedCredits, toolName)
      }
      throw error
    }
  } catch (err) {
    console.error('animate POST error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
