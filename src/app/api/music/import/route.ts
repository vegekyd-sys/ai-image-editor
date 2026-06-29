import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'

export const maxDuration = 30

type ImportAudioSource = 'cli_upload' | 'cli_url'

interface ImportAudioInput {
  audioUrl?: string
  storagePath?: string
  title?: string
  duration?: number
  mimeType?: string
  fileSizeBytes?: number
  source?: ImportAudioSource
}

function titleFromAudioUrl(audioUrl: string, fallback: string): string {
  try {
    const pathname = new URL(audioUrl).pathname
    const filename = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '')
    return filename || fallback
  } catch {
    return fallback
  }
}

function isHttpUrl(value: string | undefined): value is string {
  return !!value && (value.startsWith('http://') || value.startsWith('https://'))
}

function cleanDuration(duration: unknown): number | null {
  const value = Number(duration)
  return Number.isFinite(value) && value > 0 ? value : null
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest(req)
    if ('error' in authResult) return authResult.error
    const { userId, supabase } = authResult.auth

    const { projectId, audios } = await req.json() as {
      projectId?: string
      audios?: ImportAudioInput[]
    }

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }
    if (!Array.isArray(audios) || audios.length === 0) {
      return NextResponse.json({ error: 'audios must be a non-empty array' }, { status: 400 })
    }
    if (audios.length > 10) {
      return NextResponse.json({ error: 'Too many audio imports in one request' }, { status: 400 })
    }

    const { data: latestRows, error: latestError } = await supabase
      .from('project_music')
      .select('track_index')
      .eq('project_id', projectId)
      .order('track_index', { ascending: false })
      .limit(1)

    if (latestError) {
      return NextResponse.json({ error: latestError.message }, { status: 500 })
    }

    const firstTrackIndex = Number(latestRows?.[0]?.track_index ?? -1) + 1
    for (let index = 0; index < audios.length; index++) {
      const audio = audios[index]
      if (!isHttpUrl(audio.audioUrl)) {
        return NextResponse.json({ error: `audios[${index}].audioUrl must be an http(s) URL` }, { status: 400 })
      }
      if (audio.source !== 'cli_upload' && audio.source !== 'cli_url') {
        return NextResponse.json({ error: `audios[${index}].source must be cli_upload or cli_url` }, { status: 400 })
      }
    }

    const rows = audios.map((audio, index) => {
      const audioUrl = audio.audioUrl!
      const title = (audio.title || titleFromAudioUrl(audioUrl, `Reference audio ${index + 1}`)).slice(0, 120)
      return {
        suno_task_id: `cli-audio-${crypto.randomUUID()}`,
        track_index: firstTrackIndex + index,
        project_id: projectId,
        user_id: userId,
        prompt: 'CLI audio import',
        audio_url: audioUrl,
        suno_audio_url: null,
        stream_audio_url: null,
        duration: cleanDuration(audio.duration),
        title,
        tags: audio.source === 'cli_url' ? 'reference,audio,cli,url' : 'reference,audio,cli',
        status: 'completed',
        selected: false,
      }
    })

    const { data: inserted, error: insertError } = await supabase
      .from('project_music')
      .insert(rows)
      .select('suno_task_id, track_index, audio_url, title, duration')

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    const tracks = (inserted || []).map(track => ({
      musicTaskId: track.suno_task_id,
      trackIndex: track.track_index,
      audioUrl: track.audio_url,
      title: track.title,
      duration: track.duration ?? undefined,
    }))

    return NextResponse.json({ tracks })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/music/import POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
