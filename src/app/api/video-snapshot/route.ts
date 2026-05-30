import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { createVideo } from '@/lib/skills/create-video'
import { requireCredits, deductFixedCredits } from '@/lib/billing/credits'
import { VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations'
import { normalizeVideoModelId } from '@/lib/video-model-capabilities'
import type { VideoMeta } from '@/types'

export const maxDuration = 30

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
      sourceSnapshotIds,
      videoUrl,
      videoReferType,
      keepOriginalSound,
    } = await req.json()
    const selectedVideoModel = normalizeVideoModelId(videoModel)
    const inputImageUrls: string[] = Array.isArray(imageUrls) ? [...imageUrls] : []
    const inputVideoUrl = typeof videoUrl === 'string' && videoUrl.startsWith('http') ? videoUrl : undefined

    if (!projectId || !prompt || (inputImageUrls.length === 0 && !inputVideoUrl)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .maybeSingle()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (project.user_id !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const creditCheck = await requireCredits(userId, 50)
    if (!creditCheck.ok) return creditCheck.response

    // Save original imageUrls before mutation (for detail view display)
    const allSourceUrls: string[] = [...inputImageUrls, ...(inputVideoUrl ? [inputVideoUrl] : [])].filter((u: string) => !!u)
    const originalFirstUrl = inputImageUrls.find((u: string) => u?.startsWith('http') && !u.endsWith('.mp4')) || ''

    // Auto-route video references: detect video snapshots in imageUrls
    const { data: dbSnaps } = await supabase
      .from('snapshots')
      .select('type, video_meta, image_url')
      .eq('project_id', projectId)
      .order('sort_order')
    const autoVideoUrls: string[] = []
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
          const sourceDuration = Number(meta?.duration)
          if (Number.isFinite(sourceDuration) && sourceDuration > 0) {
            referenceVideoDuration = (referenceVideoDuration ?? 0) + sourceDuration
          }
          inputImageUrls[ref - 1] = ''
        }
      }
    }
    if (referenceVideoDuration != null && referenceVideoDuration > 15.5) {
      return NextResponse.json({ error: `Reference video duration too long (${referenceVideoDuration.toFixed(1).replace(/\.0$/, '')}s). Maximum 15s with small metadata tolerance.` }, { status: 400 })
    }
    const effectiveDuration = duration ?? (referenceVideoDuration != null ? Math.min(15, Math.round(referenceVideoDuration)) : undefined)

    const skillResult = await createVideo({
      script: prompt,
      images: inputImageUrls,
      duration: effectiveDuration,
      aspectRatio,
      videoModel: selectedVideoModel,
      videoUrl: inputVideoUrl,
      videoReferType,
      videoUrls: autoVideoUrls.length ? autoVideoUrls : undefined,
      referenceVideoDuration,
      keepOriginalSound,
    })

    if (!skillResult.success || !skillResult.taskId) {
      return NextResponse.json({ error: skillResult.message }, { status: 500 })
    }

    const taskId = skillResult.taskId

    const snapshotId = crypto.randomUUID()

    const videoMeta: VideoMeta = {
      taskId,
      videoUrl: null,
      prompt,
      sourceSnapshotIds: sourceSnapshotIds || [],
      sourceUrls: allSourceUrls.length > 0 ? allSourceUrls : (originalFirstUrl ? [originalFirstUrl] : []),
      status: 'processing',
      duration: effectiveDuration || null,
      model: selectedVideoModel,
      createdAt: new Date().toISOString(),
    }

    // Atomic sort_order allocation
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

    // Deduct credits — store amount in videoMeta for refund on failure
    const videoSec = effectiveDuration || 10
    const creditsCharged = Math.ceil(videoSec * 22)
    videoMeta.creditsCharged = creditsCharged
    supabase.from('snapshots').update({ video_meta: videoMeta }).eq('id', snapshotId).then(() => {})

    deductFixedCredits(userId, creditsCharged, 'create_video', undefined, undefined)
      .catch(e => console.error('[billing] video-snapshot deduct error:', e))

    return NextResponse.json({ snapshotId, taskId, videoMeta })
  } catch (err) {
    console.error('video-snapshot POST error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
