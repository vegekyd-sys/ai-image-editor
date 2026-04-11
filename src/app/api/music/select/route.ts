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

    await supabase.from('project_music')
      .update({ selected: true })
      .eq('project_id', projectId)
      .eq('audio_url', audioUrl)

    return NextResponse.json({ success: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/music/select POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
