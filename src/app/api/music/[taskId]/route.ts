import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMusicStatus } from '@/lib/skills/get-music-status'
import { uploadAudio } from '@/lib/supabase/storage'

export const maxDuration = 30

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

    // On completed: upload to Supabase Storage synchronously, return permanent URLs
    if (result.status === 'completed' && result.tracks.length && projectId) {
      for (const track of result.tracks) {
        // Download from Suno → upload to Supabase → get permanent URL
        let permanentUrl = track.audioUrl
        if (track.audioUrl && !track.audioUrl.includes('supabase')) {
          try {
            const res = await fetch(track.audioUrl)
            if (res.ok) {
              const buffer = new Uint8Array(await res.arrayBuffer())
              const uploaded = await uploadAudio(supabase, userId, projectId, taskId, track.trackIndex, buffer)
              if (uploaded) permanentUrl = uploaded
            }
          } catch (err) {
            console.error('Audio upload error:', err)
          }
        }
        const sunoAudioUrl = track.audioUrl
        track.audioUrl = permanentUrl
        await supabase.from('project_music').upsert({
          suno_task_id: taskId,
          track_index: track.trackIndex,
          project_id: projectId,
          user_id: userId,
          audio_url: permanentUrl,
          suno_audio_url: sunoAudioUrl || null,
          stream_audio_url: track.streamAudioUrl || null,
          duration: track.duration,
          title: track.title,
          tags: track.tags,
          status: 'completed',
        }, { onConflict: 'suno_task_id,track_index' })
        console.log(`🎵 Audio ${taskId}-${track.trackIndex} persisted to Storage`)
      }
    }

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/music/[taskId] GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
