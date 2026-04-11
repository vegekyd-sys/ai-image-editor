import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMusicStatus } from '@/lib/skills/get-music-status'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { taskId } = await params
    const projectId = req.nextUrl.searchParams.get('projectId')
    const result = await getMusicStatus({ taskId })

    // Persist completed tracks to project_music
    if (result.status === 'completed' && result.tracks.length && projectId) {
      for (const track of result.tracks) {
        await supabase.from('project_music').upsert({
          suno_task_id: taskId,
          track_index: track.trackIndex,
          project_id: projectId,
          user_id: session.user.id,
          audio_url: track.audioUrl,
          duration: track.duration,
          title: track.title,
          tags: track.tags,
          status: 'completed',
        }, { onConflict: 'suno_task_id,track_index' })
      }
    }

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/music/[taskId] GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
