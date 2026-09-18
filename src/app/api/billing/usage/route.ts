import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { summarizeRunUsage, type RunUsageRow } from '@/lib/billing/run-usage'

const USAGE_COLUMNS =
  'tool_name, model_used, credits_charged, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, source, duration_ms, run_id, project_id, created_at'
const LEGACY_USAGE_COLUMNS =
  'tool_name, model_used, credits_charged, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, source, duration_ms, created_at'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET: paginated usage history for the authenticated user.
 * Accepts browser sessions and Makaron API keys (makaron-cli `usage`).
 * Filters: `run_id`, `project_id`. When a filter is given the response also
 * carries an aggregated `summary` for the matched rows.
 */
export async function GET(req: NextRequest) {
  const authResult = await authenticateRequest(req)
  if ('error' in authResult) return authResult.error
  const { userId } = authResult.auth

  const url = new URL(req.url)
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0') || 0)
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '50') || 50), 200)
  const runId = url.searchParams.get('run_id')?.trim() || null
  const projectId = url.searchParams.get('project_id')?.trim() || null
  for (const [name, value] of [['run_id', runId], ['project_id', projectId]] as const) {
    if (value && !UUID_RE.test(value)) {
      return NextResponse.json({ error: `${name} must be a UUID` }, { status: 400 })
    }
  }

  const admin = getSupabaseAdmin()
  const buildQuery = (columns: string, withFilters: boolean) => {
    let query = admin
      .from('usage_logs')
      .select(columns)
      .eq('user_id', userId)
    if (withFilters && runId) query = query.eq('run_id', runId)
    if (withFilters && projectId) query = query.eq('project_id', projectId)
    return query.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  }

  let { data, error } = await buildQuery(USAGE_COLUMNS, true)
  let attributionAvailable = true
  if (error && (error.code === '42703' || /run_id|project_id/.test(error.message ?? ''))) {
    // Attribution migration not applied yet: fall back to the legacy columns.
    attributionAvailable = false
    if (runId || projectId) {
      return NextResponse.json({ error: 'Per-run usage is not available on this server yet.' }, { status: 501 })
    }
    ;({ data, error } = await buildQuery(LEGACY_USAGE_COLUMNS, false))
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const usage = (data ?? []) as unknown as RunUsageRow[]
  return NextResponse.json({
    usage,
    offset,
    limit,
    attribution_available: attributionAvailable,
    ...(runId || projectId ? { summary: summarizeRunUsage(usage), filter: { run_id: runId, project_id: projectId } } : {}),
  })
}
