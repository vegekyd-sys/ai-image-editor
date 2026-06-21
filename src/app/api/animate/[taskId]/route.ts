import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getKlingTask } from '@/lib/kling'
import { getKlingTask as getKlingTaskPiAPI } from '@/lib/piapi'
import { uploadVideo } from '@/lib/supabase/storage'

export const maxDuration = 60

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params

    // Allow anonymous access for public projects; require auth otherwise
    const authResult = await authenticateRequest(req)
    if ('error' in authResult) {
      const adminCheck = getSupabaseAdmin()
      const { data: animCheck } = await adminCheck
        .from('project_animations')
        .select('project_id, projects(is_public)')
        .eq('piapi_task_id', taskId)
        .single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const proj = animCheck?.projects as any
      const isPublic = Array.isArray(proj) ? proj[0]?.is_public : proj?.is_public
      if (!isPublic) return authResult.error
    }

    // Poll task — route by taskId prefix or env var
    // task-unified-* = Evolink SeeDance, cgt-* = SeeDance (Volcengine), mc-* = Motion Control, xai-* = Grok, else = Kling
    const isEvolink = taskId.startsWith('task-unified-')
    const isSeedance = taskId.startsWith('cgt-')
    const isMotionControl = taskId.startsWith('mc-')
    const isXai = taskId.startsWith('xai-')
    const provider = process.env.ANIMATE_PROVIDER || 'kling'
    let result: { taskId: string; status: string; videoUrl?: string; error?: string }
    const realTaskId = isMotionControl ? taskId.slice(3) : taskId

    if (isEvolink) {
      const { getEvolinkTask } = await import('@/lib/evolink')
      result = await getEvolinkTask(taskId)
    } else if (isSeedance) {
      const { getSeedanceTask } = await import('@/lib/seedance')
      result = await getSeedanceTask(taskId)
    } else if (isMotionControl) {
      const { getKlingMotionControlTask } = await import('@/lib/kling')
      result = await getKlingMotionControlTask(realTaskId)
      result.taskId = taskId // preserve mc- prefix for frontend
    } else if (isXai) {
      const { getXaiVideoTask } = await import('@/lib/xai-video')
      result = await getXaiVideoTask(taskId)
    } else if (provider === 'piapi') {
      result = await getKlingTaskPiAPI(taskId)
    } else {
      result = await getKlingTask(taskId)
    }

    // If completed, update DB (use admin client to bypass RLS)
    if (result.status === 'completed' && result.videoUrl) {
      const admin = getSupabaseAdmin()

      const { data: anim } = await admin
        .from('project_animations')
        .select('id, project_id, projects(user_id)')
        .eq('piapi_task_id', taskId)
        .single()

      await admin
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
        const ownerId = ownerUserId as string
        after(async () => {
          try {
            const res = await fetch(videoUrl)
            if (!res.ok) {
              console.error(`Video download failed: ${res.status}`)
              return
            }
            const buffer = new Uint8Array(await res.arrayBuffer())
            const adminClient = getSupabaseAdmin()
            const permanentUrl = await uploadVideo(adminClient, ownerId, projectId, animId, buffer)
            if (permanentUrl) {
              await adminClient
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
      const admin = getSupabaseAdmin()
      await admin
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
    const authResult = await authenticateRequest(req)
    if ('error' in authResult) return authResult.error

    const { taskId } = await params
    const admin = getSupabaseAdmin()
    await admin
      .from('project_animations')
      .update({ status: 'abandoned' })
      .eq('piapi_task_id', taskId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('animate DELETE error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
