import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKlingTask } from '@/lib/piapi'

export const maxDuration = 15

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

    // Poll PiAPI
    const result = await getKlingTask(taskId)

    // If completed, update DB
    if (result.status === 'completed' && result.videoUrl) {
      await supabase
        .from('project_animations')
        .update({ status: 'completed', video_url: result.videoUrl })
        .eq('piapi_task_id', taskId)
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
