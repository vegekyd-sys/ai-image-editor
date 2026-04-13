import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createVideo } from '@/lib/skills/create-video'
import { filterAndRemapImages } from '@/lib/kling'
import { requireCredits, deductCredits } from '@/lib/billing/credits'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, imageUrls, prompt, duration, aspectRatio } = await req.json()

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

    // Call skill layer (stateless, no DB)
    const skillResult = await createVideo({
      script: prompt,
      images: imageUrls,
      duration,
      aspectRatio,
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
    deductCredits(user.id, null, 'create_video')
      .catch(e => console.error('[billing] animate deduct error:', e))

    return NextResponse.json({ animationId: animation.id, taskId })
  } catch (err) {
    console.error('animate POST error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
