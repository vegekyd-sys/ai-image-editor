import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createMusic } from '@/lib/skills/create-music'
import { requireCredits, deductCredits } from '@/lib/billing/credits'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { prompt, instrumental, style, projectId } = await req.json()

    if (!prompt) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
    }

    // Pre-flight credit check
    const creditCheck = await requireCredits(user.id, 10)
    if (!creditCheck.ok) return creditCheck.response

    const result = await createMusic({ prompt, instrumental, style })

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 500 })
    }

    // Write pending rows to DB so polling resumes after page reload
    if (result.taskId && projectId) {
      for (const idx of [0, 1]) {
        await supabase.from('project_music').upsert({
          suno_task_id: result.taskId,
          track_index: idx,
          project_id: projectId,
          user_id: user.id,
          prompt,
          status: 'pending',
        }, { onConflict: 'suno_task_id,track_index' })
      }
    }

    // Deduct credits for music generation (fire-and-forget)
    deductCredits(user.id, null, 'create_music')
      .catch(e => console.error('[billing] music deduct error:', e))

    return NextResponse.json({ taskId: result.taskId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/music POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
