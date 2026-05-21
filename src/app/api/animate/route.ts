import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createVideo } from '@/lib/skills/create-video'
import { filterAndRemapImages } from '@/lib/kling'
import { requireCredits, deductFixedCredits } from '@/lib/billing/credits'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, imageUrls, prompt, duration, aspectRatio, videoModel } = await req.json()

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

    // Call skill layer (stateless, no DB)
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
    const videoSec = duration || 10
    const toolName = videoModel === 'seedance' ? 'create_video_seedance' : 'create_video_kling'
    const { getToolPrice } = await import('@/lib/billing/pricing')
    const price = await getToolPrice(toolName)
    const creditsPerSec = price?.credits ?? 22
    deductFixedCredits(user.id, Math.ceil(videoSec * creditsPerSec), toolName, videoModel || 'kling', undefined)
      .catch(e => console.error('[billing] animate deduct error:', e))

    return NextResponse.json({ animationId: animation.id, taskId })
  } catch (err) {
    console.error('animate POST error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
