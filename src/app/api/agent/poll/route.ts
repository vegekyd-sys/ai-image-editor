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
  if (!session) {
    return NextResponse.json(null, { status: 401 })
  }

  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json(null, { status: 400 })
  }

  // Verify project ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) {
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
