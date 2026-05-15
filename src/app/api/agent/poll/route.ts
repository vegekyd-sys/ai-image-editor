import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

/**
 * GET /api/agent/poll?projectId=xxx
 *
 * Lightweight endpoint for detecting running agent runs.
 * Returns: { id, started_at } | null
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json(null, { status: 400 })
  }

  // Allow public projects without auth; private projects require login
  const admin = getSupabaseAdmin()
  const { data: project } = await admin
    .from('projects')
    .select('id, user_id, is_public')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) {
    return NextResponse.json(null, { status: 404 })
  }
  if (!project.is_public && (!session || session.user.id !== project.user_id)) {
    return NextResponse.json(null, { status: 403 })
  }

  // Use admin client (run may be created by CLI with different user_id)
  const { data: run } = await getSupabaseAdmin()
    .from('agent_runs')
    .select('id, started_at')
    .eq('project_id', projectId)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json(run)
}
