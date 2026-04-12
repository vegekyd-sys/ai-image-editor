import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMusicStatus } from '@/lib/skills/get-music-status'
import { uploadAudio } from '@/lib/supabase/storage'

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
    const userId = session.user.id
    const result = await getMusicStatus({ taskId })

    // Persist completed tracks to project_music
    if (result.status === 'completed' && result.tracks.length && projectId) {
      for (const track of result.tracks) {
        await supabase.from('project_music').upsert({
          suno_task_id: taskId,
          track_index: track.trackIndex,
          project_id: projectId,
          user_id: userId,
          audio_url: track.audioUrl,
          duration: track.duration,
          title: track.title,
          tags: track.tags,
          status: 'completed',
        }, { onConflict: 'suno_task_id,track_index' })
      }

      // Re-upload audio to Supabase Storage after response is sent
      after(async () => {
        for (const track of result.tracks) {
          try {
            const res = await fetch(track.audioUrl)
            if (!res.ok) { console.error(`Audio download failed: ${res.status}`); continue }
            const buffer = new Uint8Array(await res.arrayBuffer())
            const permanentUrl = await uploadAudio(supabase, userId, projectId, taskId, track.trackIndex, buffer)
            if (permanentUrl) {
              await supabase.from('project_music')
                .update({ audio_url: permanentUrl })
                .eq('suno_task_id', taskId)
                .eq('track_index', track.trackIndex)
              console.log(`🎵 Audio ${taskId}-${track.trackIndex} persisted to Storage`)
            }
          } catch (err) {
            console.error('Audio persist error:', err)
          }
        }
      })
    }

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/music/[taskId] GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
