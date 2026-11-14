import { getSupabaseAdmin } from '@/lib/supabase/service';
import { isBillingEnabled } from './credits';
import type { BillingAttribution } from './attribution';

/** Reuse the atomic task debit ledger, entering it only after provider completion.
 * The legacy RPC/table names contain "video"; no row is ever marked submitted,
 * so video reconciliation cannot poll or settle these completed image tasks. */
export async function chargeCompletedProviderTask(input: {
  id: string; userId: string; model: string; tool: string; fingerprint: string;
  taskId: string; credits: number; supplierCostUsd: number; attribution: BillingAttribution;
}): Promise<number> {
  if (!(await isBillingEnabled())) return 0;
  if (!Number.isSafeInteger(input.credits) || input.credits <= 0) throw new Error('Invalid task charge');
  const admin = getSupabaseAdmin();
  const { error } = await admin.rpc('reserve_mcp_video', {
    p_id: input.id, p_user_id: input.userId, p_api_key_id: input.attribution.apiKeyId ?? null,
    p_tool: input.tool, p_model: input.model, p_fingerprint: input.fingerprint,
    p_quote: { credits: input.credits, supplierCostUsd: input.supplierCostUsd, settlement: 'completed-output' },
    p_source: input.attribution.source ?? 'app', p_run_id: input.attribution.runId ?? null,
    p_project_id: input.attribution.projectId ?? null,
  });
  if (error) throw new Error('Completed task debit is pending; query this same job after checking credits.');
  const finished = await admin.rpc('finish_mcp_video_submission', {
    p_id: input.id, p_user_id: input.userId, p_task_id: input.taskId, p_state: 'completed',
  });
  if (finished.error) throw new Error('Task debit reconciliation pending; do not submit another job.');
  return input.credits;
}
