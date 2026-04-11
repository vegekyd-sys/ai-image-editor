import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createMusic } from '@/lib/skills/create-music'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { prompt, instrumental, style } = await req.json()

    if (!prompt) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
    }

    const result = await createMusic({ prompt, instrumental, style })

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 500 })
    }

    return NextResponse.json({ taskId: result.taskId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/music POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
