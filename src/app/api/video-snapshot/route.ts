import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { createVideo } from '@/lib/skills/create-video'
import { filterAndRemapImages } from '@/lib/kling'
import {
  deductFixedCredits,
  isInsufficientCreditsError,
  refundCredits,
  requireCredits,
} from '@/lib/billing/credits'
import { VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations'
import { estimateVideoCredits, estimateVideoProviderCostUsd, getVideoModelCapability, normalizeVideoModelId, resolvePersistedVideoDuration, resolveVideoGenerationRoute, resolveVideoOutputDuration, supportsNativeTextToVideo } from '@/lib/video-model-capabilities'
import type { VideoMeta } from '@/types'

export const maxDuration = 1800

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest(req)
    if ('error' in authResult) return authResult.error
    const { userId, supabase } = authResult.auth

    const {
      projectId,
      imageUrls,
      prompt,
      duration,
      aspectRatio,
      videoModel,
      videoResolution,
      sourceSnapshotIds,
      videoUrl,
      videoReferType,
      keepOriginalSound,
      videoOperation,
      videoExtendDirection,
      generateAudio,
      contentFilter,
      outputFormat,
      webSearch,
    } = await req.json()
    const selectedVideoModel = normalizeVideoModelId(videoModel)
    const videoCapability = getVideoModelCapability(selectedVideoModel)
    const videoRoute = resolveVideoGenerationRoute({ model: selectedVideoModel, resolution: videoResolution })
    const inputImageUrls: string[] = Array.isArray(imageUrls) ? [...imageUrls] : []
    const inputVideoUrl = typeof videoUrl === 'string' && videoUrl.startsWith('http') ? videoUrl : undefined

    if (!projectId || !prompt || (inputImageUrls.length === 0 && !inputVideoUrl && !supportsNativeTextToVideo(selectedVideoModel))) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .maybeSingle()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (project.user_id !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Save original imageUrls before mutation (for detail view display)
    const originalImageUrlsByIndex = [...inputImageUrls]
    const originalFirstUrl = inputImageUrls.find((u: string) => u?.startsWith('http') && !u.endsWith('.mp4')) || ''

    // Auto-route video references: detect video snapshots in imageUrls
    const { data: dbSnaps } = await supabase
      .from('snapshots')
      .select('id, type, video_meta, image_url')
      .eq('project_id', projectId)
      .order('sort_order')
    const autoVideoUrls: string[] = []
    const autoVideoSnapshotIds: string[] = []
    const videoRefIndices = new Set<number>()
    const referenceVideoMetas: Array<{ width?: number | null; height?: number | null; fileSizeBytes?: number | null }> = []
    let referenceVideoDuration: number | undefined
    const scriptRefs = [...new Set(
      Array.from(prompt.matchAll(/<<<(?:image|media)_(\d+)>>>/g), (m: RegExpMatchArray) => Number(m[1]))
    )]
    if (dbSnaps?.length) {
      for (const ref of scriptRefs) {
        const snap = dbSnaps[ref - 1]
        const meta = snap?.video_meta as Record<string, unknown> | null
        const videoUrl = meta?.videoUrl as string | undefined
        if (snap?.type === 'video' && videoUrl) {
          autoVideoUrls.push(videoUrl)
          videoRefIndices.add(ref)
          if (typeof snap.id === 'string') autoVideoSnapshotIds.push(snap.id)
          referenceVideoMetas.push({
            width: Number.isFinite(Number(meta?.width)) ? Number(meta?.width) : null,
            height: Number.isFinite(Number(meta?.height)) ? Number(meta?.height) : null,
            fileSizeBytes: Number.isFinite(Number(meta?.fileSizeBytes)) ? Number(meta?.fileSizeBytes) : null,
          })
          const sourceDuration = Number(meta?.duration)
          if (Number.isFinite(sourceDuration) && sourceDuration > 0) {
            referenceVideoDuration = (referenceVideoDuration ?? 0) + sourceDuration
          }
          inputImageUrls[ref - 1] = ''
        }
      }
    }
    const acceptedReferenceDuration = videoCapability.maxReferenceVideoDuration + (videoCapability.referenceVideoDurationTolerance ?? 0)
    if (referenceVideoDuration != null && referenceVideoDuration > acceptedReferenceDuration) {
      return NextResponse.json({ error: `Reference video duration too long (${referenceVideoDuration.toFixed(1).replace(/\.0$/, '')}s). Maximum ${videoCapability.maxReferenceVideoDuration}s with small metadata tolerance.` }, { status: 400 })
    }
    const effectiveDuration = resolveVideoOutputDuration({
      requestedDuration: duration,
      referenceVideoDuration,
      model: selectedVideoModel,
      operation: videoOperation,
    })
    const originalVideoUrls = [...(inputVideoUrl ? [inputVideoUrl] : []), ...autoVideoUrls]
    let providerInputVideoUrl = inputVideoUrl
    let providerAutoVideoUrls = autoVideoUrls
    if (originalVideoUrls.length > 0) {
      const { prepareProviderVideoReferences } = await import('@/lib/provider-video-reference')
      const prepared = await prepareProviderVideoReferences({
        supabase,
        userId,
        projectId,
        urls: originalVideoUrls,
        reason: videoRoute.provider,
      })
      if (prepared.normalized.length > 0) {
        console.log(`[video-snapshot] normalized ${prepared.normalized.length} video reference(s) for provider input`)
      }
      providerInputVideoUrl = inputVideoUrl ? prepared.urls[0] : undefined
      providerAutoVideoUrls = inputVideoUrl ? prepared.urls.slice(1) : prepared.urls
    }

    const videoSec = effectiveDuration || 10
    const { filteredImages } = filterAndRemapImages(prompt, inputImageUrls, videoCapability.maxImageReferences ?? 7)
    const creditsRequired = estimateVideoCredits({
      model: selectedVideoModel,
      resolution: videoRoute.resolution,
      durationSec: videoSec,
      imageCount: filteredImages.length,
      referenceVideoDurationSec: referenceVideoDuration,
      operation: videoOperation,
      contentFilter,
    }) ?? Math.ceil(videoSec * 22)
    const toolName = selectedVideoModel === 'grok' ? 'create_video_grok' : 'create_video'
    const creditCheck = await requireCredits(userId, creditsRequired)
    if (!creditCheck.ok) return creditCheck.response

    let reservedCredits = 0
    try {
      const reservation = await deductFixedCredits(
        userId,
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
        videoUrl: providerInputVideoUrl,
        videoReferType,
        videoUrls: providerAutoVideoUrls.length ? providerAutoVideoUrls : undefined,
        referenceVideoDuration,
        referenceVideoMetas: referenceVideoMetas.length ? referenceVideoMetas : undefined,
        keepOriginalSound,
        videoOperation,
        videoExtendDirection,
        generateAudio,
        contentFilter,
        outputFormat,
        webSearch,
      })

      if (!skillResult.success || !skillResult.taskId) {
        if (reservedCredits > 0) {
          await refundCredits(userId, reservedCredits, toolName)
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
      const actualVideoModel = skillResult.videoModel || selectedVideoModel
      const actualVideoRoute = resolveVideoGenerationRoute({ model: actualVideoModel, resolution: videoRoute.resolution })
      const snapshotId = crypto.randomUUID()
      const referencedImageUrls = scriptRefs
        .filter(ref => !videoRefIndices.has(ref))
        .map(ref => originalImageUrlsByIndex[ref - 1])
        .filter((u): u is string => !!u && u.startsWith('http') && !u.endsWith('.mp4'))
      const sourceUrls = [...referencedImageUrls, ...(inputVideoUrl ? [inputVideoUrl] : []), ...autoVideoUrls].filter(Boolean)
      const providerCostUsd = estimateVideoProviderCostUsd({
        model: actualVideoModel,
        resolution: actualVideoRoute.resolution,
        durationSec: videoSec,
        imageCount: filteredImages.length,
        referenceVideoDurationSec: referenceVideoDuration,
        operation: videoOperation,
        contentFilter,
      })

      const videoMeta: VideoMeta = {
        taskId,
        videoUrl: skillResult.videoUrl || null,
        prompt,
        sourceSnapshotIds: [...(Array.isArray(sourceSnapshotIds) ? sourceSnapshotIds : []), ...autoVideoSnapshotIds],
        sourceUrls: sourceUrls.length > 0
          ? sourceUrls
          : (originalFirstUrl ? [originalFirstUrl] : []),
        status: skillResult.status === 'completed' && skillResult.videoUrl ? 'completed' : 'processing',
        duration: resolvePersistedVideoDuration({
          model: actualVideoModel,
          operation: videoOperation,
          outputDuration: effectiveDuration,
          referenceVideoDuration,
        }) || null,
        model: actualVideoModel,
        resolution: actualVideoRoute.resolution,
        aspectRatio,
        providerModel: skillResult.providerModel || actualVideoRoute.providerModel,
        providerUrl: skillResult.videoUrl,
        providerMode: actualVideoRoute.providerMode,
        operation: videoOperation || 'generate',
        contentFilter: actualVideoModel === 'seedance-2.5' ? contentFilter !== false : undefined,
        createdAt: new Date().toISOString(),
        creditsCharged: reservedCredits,
        ...(providerCostUsd != null ? { providerCostUsd } : {}),
      }

      const { data: sortData } = await supabase.rpc('next_sort_order', { p_project_id: projectId })
      const sortOrder = sortData ?? 0
      const { error } = await supabase.from('snapshots').insert({
        id: snapshotId,
        project_id: projectId,
        image_url: VIDEO_PLACEHOLDER_IMAGE,
        tips: [],
        message_id: '',
        sort_order: sortOrder,
        type: 'video',
        video_meta: videoMeta,
      })

      if (error) throw error
      reservedCredits = 0
      return NextResponse.json({ snapshotId, taskId, videoMeta })
    } catch (error) {
      if (reservedCredits > 0) {
        await refundCredits(userId, reservedCredits, toolName)
      }
      throw error
    }
  } catch (err) {
    console.error('video-snapshot POST error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
