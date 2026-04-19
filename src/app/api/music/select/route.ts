import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { audioUrl, projectId } = await req.json()
    if (!audioUrl || !projectId) {
      return NextResponse.json({ error: 'audioUrl and projectId required' }, { status: 400 })
    }

    // Deselect all, then find the best match to select
    await supabase.from('project_music')
      .update({ selected: false })
      .eq('project_id', projectId)

    // Find a track with a permanent Supabase URL for this project
    // (client may send a stream URL that doesn't match DB — DB has permanent URL after upload)
    const { data: tracks } = await supabase.from('project_music')
      .select('audio_url, track_index')
      .eq('project_id', projectId)
      .eq('status', 'completed')
      .order('track_index')

    // Prefer track whose audio_url matches, otherwise first track with a Supabase URL
    const exact = tracks?.find((t: { audio_url: string }) => t.audio_url === audioUrl)
    const supabaseTrack = tracks?.find((t: { audio_url: string }) => t.audio_url?.includes('.supabase.co/'))
    const best = exact || supabaseTrack || tracks?.[0]

    if (best) {
      await supabase.from('project_music')
        .update({ selected: true })
        .eq('project_id', projectId)
        .eq('track_index', best.track_index)
    }

    const permanentUrl = best?.audio_url?.includes('.supabase.co/') ? best.audio_url : audioUrl
    return NextResponse.json({ success: true, permanentUrl })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/music/select POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
