import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createVideo } from '@/lib/skills/create-video'
import { filterAndRemapImages } from '@/lib/kling'
import { requireCredits, deductFixedCredits } from '@/lib/billing/credits'
import type { VideoMeta } from '@/types'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, imageUrls, prompt, duration, aspectRatio, videoModel, sourceSnapshotIds } = await req.json()

    if (!projectId || !imageUrls?.length || !prompt) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const creditCheck = await requireCredits(user.id, 50)
    if (!creditCheck.ok) return creditCheck.response

    // Save first valid URL before auto-detect may clear them (for poster)
    const originalFirstUrl = imageUrls.find((u: string) => u?.startsWith('http')) || ''

    // Auto-route video references: detect video snapshots in imageUrls
    const { data: dbSnaps } = await supabase
      .from('snapshots')
      .select('type, video_meta, image_url')
      .eq('project_id', projectId)
      .order('sort_order')
    let autoVideoUrls: string[] = []
    if (dbSnaps?.length) {
      const scriptRefs = [...new Set(
        Array.from(prompt.matchAll(/<<<(?:image|media)_(\d+)>>>/g), (m: RegExpMatchArray) => Number(m[1]))
      )]
      for (const ref of scriptRefs) {
        const snap = dbSnaps[ref - 1]
        const videoUrl = (snap?.video_meta as Record<string, unknown> | null)?.videoUrl as string | undefined
        if (snap?.type === 'video' && videoUrl) {
          autoVideoUrls.push(videoUrl)
          imageUrls[ref - 1] = ''
        }
      }
    }

    const skillResult = await createVideo({
      script: prompt,
      images: imageUrls,
      duration,
      aspectRatio,
      videoModel,
      videoUrls: autoVideoUrls.length ? autoVideoUrls : undefined,
    })

    if (!skillResult.success || !skillResult.taskId) {
      return NextResponse.json({ error: skillResult.message }, { status: 500 })
    }

    const taskId = skillResult.taskId
    const { filteredImages, finalPrompt } = filterAndRemapImages(prompt, imageUrls)

    const snapshotId = crypto.randomUUID()
    const posterUrl = filteredImages[0] || originalFirstUrl || imageUrls.find((u: string) => u?.startsWith('http')) || ''

    const videoMeta: VideoMeta = {
      taskId,
      videoUrl: null,
      prompt: finalPrompt,
      sourceSnapshotIds: sourceSnapshotIds || [],
      sourceUrls: filteredImages.length > 0 ? filteredImages : (originalFirstUrl ? [originalFirstUrl] : []),
      status: 'processing',
      duration: duration || null,
      model: videoModel || 'kling',
      createdAt: new Date().toISOString(),
    }

    // Atomic sort_order allocation
    const { data: sortData } = await supabase.rpc('next_sort_order', { p_project_id: projectId })
    const sortOrder = sortData ?? 0

    const { error } = await supabase.from('snapshots').insert({
      id: snapshotId,
      project_id: projectId,
      image_url: posterUrl,
      tips: [],
      message_id: '',
      sort_order: sortOrder,
      type: 'video',
      video_meta: videoMeta,
    })

    if (error) throw error

    // Deduct credits (fire-and-forget)
    const videoSec = duration || 10
    deductFixedCredits(user.id, Math.ceil(videoSec * 22), 'create_video', undefined, undefined)
      .catch(e => console.error('[billing] video-snapshot deduct error:', e))

    return NextResponse.json({ snapshotId, taskId, videoMeta })
  } catch (err) {
    console.error('video-snapshot POST error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
