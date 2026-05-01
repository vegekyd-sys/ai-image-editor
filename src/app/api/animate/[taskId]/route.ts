import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKlingTask } from '@/lib/kling'
import { getKlingTask as getKlingTaskPiAPI } from '@/lib/piapi'
import { uploadVideo } from '@/lib/supabase/storage'

export const maxDuration = 60

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { taskId } = await params

    // Poll task — route by taskId prefix or env var
    // cgt-* = SeeDance, mc-* = Motion Control, else = Kling omni-video
    const isSeedance = taskId.startsWith('cgt-')
    const isMotionControl = taskId.startsWith('mc-')
    const provider = process.env.ANIMATE_PROVIDER || 'kling'
    let result: { taskId: string; status: string; videoUrl?: string; error?: string }
    const realTaskId = isMotionControl ? taskId.slice(3) : taskId

    if (isSeedance) {
      const { getSeedanceTask } = await import('@/lib/seedance')
      result = await getSeedanceTask(taskId)
    } else if (isMotionControl) {
      const { getKlingMotionControlTask } = await import('@/lib/kling')
      result = await getKlingMotionControlTask(realTaskId)
      result.taskId = taskId // preserve mc- prefix for frontend
    } else if (provider === 'piapi') {
      result = await getKlingTaskPiAPI(taskId)
    } else {
      result = await getKlingTask(taskId)
    }

    // If completed, update DB
    if (result.status === 'completed' && result.videoUrl) {
      // Get animation record for project info
      const { data: anim } = await supabase
        .from('project_animations')
        .select('id, project_id, projects(user_id)')
        .eq('piapi_task_id', taskId)
        .single()

      await supabase
        .from('project_animations')
        .update({ status: 'completed', video_url: result.videoUrl })
        .eq('piapi_task_id', taskId)

      // Persist video to Supabase Storage after response is sent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const projects = anim?.projects as any
      const ownerUserId = Array.isArray(projects) ? projects[0]?.user_id : projects?.user_id
      if (anim?.project_id && ownerUserId) {
        const videoUrl = result.videoUrl
        const animId = anim.id
        const projectId = anim.project_id
        const userId = ownerUserId as string
        after(async () => {
          try {
            const res = await fetch(videoUrl)
            if (!res.ok) {
              console.error(`Video download failed: ${res.status}`)
              return
            }
            const buffer = new Uint8Array(await res.arrayBuffer())
            const permanentUrl = await uploadVideo(supabase, userId, projectId, animId, buffer)
            if (permanentUrl) {
              await supabase
                .from('project_animations')
                .update({ video_url: permanentUrl })
                .eq('id', animId)
              console.log(`Video ${animId} persisted to Storage`)
            }
          } catch (err) {
            console.error('Video persist error:', err)
          }
        })
      }
    } else if (result.status === 'failed') {
      await supabase
        .from('project_animations')
        .update({ status: 'failed' })
        .eq('piapi_task_id', taskId)
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('animate GET error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { taskId } = await params
    await supabase
      .from('project_animations')
      .update({ status: 'abandoned' })
      .eq('piapi_task_id', taskId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('animate DELETE error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
