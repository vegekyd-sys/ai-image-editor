import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createVideo } from '@/lib/skills/create-video'
import { filterAndRemapImages } from '@/lib/kling'
import { requireCredits, deductFixedCredits } from '@/lib/billing/credits'
import { normalizeVideoModelId } from '@/lib/video-model-capabilities'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, imageUrls, prompt, duration, aspectRatio, videoModel } = await req.json()
    const selectedVideoModel = normalizeVideoModelId(videoModel)

    if (!projectId || !imageUrls?.length || !prompt) {
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

    // Pre-flight credit check
    const creditCheck = await requireCredits(user.id, 50)
    if (!creditCheck.ok) return creditCheck.response

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
          imageUrls[ref - 1] = ''
        }
      }
    }
    if (referenceVideoDuration != null && referenceVideoDuration > 15.5) {
      return NextResponse.json({ error: `Reference video duration too long (${referenceVideoDuration.toFixed(1).replace(/\.0$/, '')}s). Maximum 15s with small metadata tolerance.` }, { status: 400 })
    }
    const effectiveDuration = duration ?? (referenceVideoDuration != null ? Math.min(15, Math.round(referenceVideoDuration)) : undefined)

    // Call skill layer (stateless, no DB)
    const skillResult = await createVideo({
      script: prompt,
      images: imageUrls,
      duration: effectiveDuration,
      aspectRatio,
      videoModel: selectedVideoModel,
      videoUrls: autoVideoUrls.length ? autoVideoUrls : undefined,
      referenceVideoDuration,
      referenceVideoMetas: referenceVideoMetas.length ? referenceVideoMetas : undefined,
    })

    if (!skillResult.success || !skillResult.taskId) {
      return NextResponse.json({ error: skillResult.message }, { status: 500 })
    }

    const taskId = skillResult.taskId

    // Persist to DB (API route responsibility)
    const { filteredImages, finalPrompt } = filterAndRemapImages(prompt, imageUrls)
    const { data: animation, error } = await supabase
      .from('project_animations')
      .insert({
        project_id: projectId,
        piapi_task_id: taskId,
        status: 'processing',
        prompt: finalPrompt,
        snapshot_urls: filteredImages,
      })
      .select('id')
      .single()

    if (error) throw error

    // Deduct credits for video generation (fire-and-forget)
    // Per-second billing: 22 credits/s ($0.11/s × 2x markup), default 10s if smart mode
    const videoSec = effectiveDuration || 10
    const toolName = selectedVideoModel === 'seedance' ? 'create_video_seedance' : 'create_video_kling'
    const { getToolPrice } = await import('@/lib/billing/pricing')
    const price = await getToolPrice(toolName)
    const creditsPerSec = price?.credits ?? 22
    deductFixedCredits(user.id, Math.ceil(videoSec * creditsPerSec), toolName, selectedVideoModel, undefined)
      .catch(e => console.error('[billing] animate deduct error:', e))

    return NextResponse.json({ animationId: animation.id, taskId })
  } catch (err) {
    console.error('animate POST error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
