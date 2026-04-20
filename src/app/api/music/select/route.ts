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

    // Deselect all, then find the matching track by any of the three URL columns
    await supabase.from('project_music')
      .update({ selected: false })
      .eq('project_id', projectId)

    const { data: match } = await supabase.from('project_music')
      .select('audio_url, track_index')
      .eq('project_id', projectId)
      .or(`audio_url.eq.${audioUrl},suno_audio_url.eq.${audioUrl},stream_audio_url.eq.${audioUrl}`)
      .limit(1)
      .single()

    if (match) {
      await supabase.from('project_music')
        .update({ selected: true })
        .eq('project_id', projectId)
        .eq('track_index', match.track_index)
    }

    const permanentUrl = match?.audio_url || audioUrl
    return NextResponse.json({ success: true, permanentUrl })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/music/select POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
