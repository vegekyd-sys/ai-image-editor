import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createKlingTask } from '@/lib/kling'
import { createKlingTask as createKlingTaskPiAPI } from '@/lib/piapi'

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

    // Create video task — default Kling direct (v3-omni), ANIMATE_PROVIDER=piapi to fallback
    const usePiAPI = process.env.ANIMATE_PROVIDER === 'piapi'
    const taskId = usePiAPI
      ? await createKlingTaskPiAPI({
          // PiAPI uses @image_N format; convert <<<image_N>>> → @image_N
          prompt: prompt.replace(/<<<image_(\d+)>>>/g, '@image_$1'),
          images: imageUrls,
          duration: duration ?? 10,
          aspect_ratio: aspectRatio ?? '9:16',
          enable_audio: true,
          version: '3.0',
        })
      : await createKlingTask({
          prompt,
          images: imageUrls,
          duration: duration ?? undefined, // null = smart mode
          aspect_ratio: aspectRatio, // undefined = API auto-detects from images
        })

    // Save animation record to DB
    const { data: animation, error } = await supabase
      .from('project_animations')
      .insert({
        project_id: projectId,
        piapi_task_id: taskId,
        status: 'processing',
        prompt,
        snapshot_urls: imageUrls,
      })
      .select('id')
      .single()

    if (error) throw error

    return NextResponse.json({ animationId: animation.id, taskId })
  } catch (err) {
    console.error('animate POST error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
