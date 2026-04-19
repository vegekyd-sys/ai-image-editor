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

    // Deselect all tracks for this project, then select the chosen one
    await supabase.from('project_music')
      .update({ selected: false })
      .eq('project_id', projectId)

    // Match by audio_url OR suno_task_id URL (audio_url may have been updated to Supabase permanent URL)
    await supabase.from('project_music')
      .update({ selected: true })
      .eq('project_id', projectId)
      .eq('audio_url', audioUrl)

    // Return the permanent URL (may differ from the Suno temp URL the client sent)
    const { data: selected } = await supabase.from('project_music')
      .select('audio_url')
      .eq('project_id', projectId)
      .eq('selected', true)
      .single()

    return NextResponse.json({ success: true, permanentUrl: selected?.audio_url || audioUrl })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/music/select POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
