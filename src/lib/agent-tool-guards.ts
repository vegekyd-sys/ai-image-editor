import { stableOperationKey } from './agent-execution';
import type { AgentContext } from './agent-tools';

export const DURABLE_IDEMPOTENT_TOOLS = new Set([
  'generate_image',
  'generate_animation',
  'materialize_media',
  'rotate_camera',
  'generate_audio',
  'prepare_visual_asset',
]);

export const DURABLE_INPUT_GUARDED_TOOLS = new Set([
  ...DURABLE_IDEMPOTENT_TOOLS,
  'studio_run',
  'publish_draft',
  'write_file',
  'write_code_file',
  'run_code',
  'preview_frame',
  'delete_file',
  'execution_checkpoint',
]);

export function wrapDurableInputAwareTools(
  tools: Record<string, any>,
  ctx: AgentContext,
): Record<string, any> {
  if (!ctx.execution || !ctx.supabase || !ctx.userId) return tools;
  for (const [toolName, definition] of Object.entries(tools)) {
    if (!DURABLE_INPUT_GUARDED_TOOLS.has(toolName) || typeof definition?.execute !== 'function') continue;
    const execute = definition.execute.bind(definition);
    definition.execute = async (input: unknown, executionOptions?: unknown) => {
      const { data: runState, error } = await ctx.supabase
        .from('agent_runs')
        .select('status, input_version')
        .eq('id', ctx.execution!.runId)
        .eq('user_id', ctx.userId)
        .maybeSingle();
      const currentInputVersion = Number(runState?.input_version || 0);
      if (
        error
        || runState?.status !== 'running'
        || currentInputVersion > ctx.execution!.inputEpoch
      ) {
        if (error) {
          console.warn(`[agent-execution] input-version guard failed before ${toolName}: ${error.message}`);
        }
        return {
          success: false,
          terminal: true,
          errorCode: 'agent_input_received',
          message: error
            ? 'Could not verify the latest Agent Run input before a durable mutation. Hand off and retry safely.'
            : 'A newer instruction arrived in this Agent Run. Stop this attempt before further durable mutations so the next attempt can continue with the new context.',
          userMessage: {
            zh: '已收到更新指令，正在从当前进度切换，不会继续执行旧目标。',
            en: 'A newer instruction was received. Switching from the current progress without continuing the old target.',
          },
        };
      }
      return execute(input, executionOptions);
    };
  }
  return tools;
}

export function wrapDurableIdempotentTools(
  tools: Record<string, any>,
  ctx: AgentContext,
): Record<string, any> {
  if (!ctx.execution || !ctx.supabase || !ctx.userId) return tools;
  for (const [toolName, definition] of Object.entries(tools)) {
    if (!DURABLE_IDEMPOTENT_TOOLS.has(toolName) || typeof definition?.execute !== 'function') continue;
    const execute = definition.execute.bind(definition);
    definition.execute = async (input: unknown, executionOptions?: unknown) => {
      const operationKey = stableOperationKey(toolName, input, ctx.execution!.inputEpoch);
      const { data, error } = await ctx.supabase.rpc('claim_agent_operation', {
        p_run_id: ctx.execution!.runId,
        p_attempt_id: ctx.execution!.attemptId,
        p_user_id: ctx.userId,
        p_work_unit_key: 'agent',
        p_operation_key: operationKey,
        p_tool_name: toolName,
      });
      if (error) {
        console.warn(`[agent-execution] operation ledger unavailable for ${toolName}: ${error.message}`);
        return execute(input, executionOptions);
      }
      const claim = Array.isArray(data) ? data[0] : data;
      if (!claim?.claimed) {
        if (claim?.operation_status === 'completed' && claim?.operation_result != null) {
          return {
            ...(typeof claim.operation_result === 'object' ? claim.operation_result : { result: claim.operation_result }),
            reused: true,
            operationKey,
          };
        }
        return {
          success: true,
          reused: true,
          operationKey,
          status: claim?.operation_status || 'running',
          message: `The identical ${toolName} operation is already ${claim?.operation_status || 'running'}. Do not submit it again; continue from its persisted project result or wait for reconciliation.`,
        };
      }

      const operationId = claim.operation_id as string;
      try {
        const result = await execute(input, executionOptions);
        const record: Record<string, unknown> = result && typeof result === 'object'
          ? result as Record<string, unknown>
          : { value: result };
        const failed = record.success === false || record.status === 'failed' || Boolean(record.error);
        await ctx.supabase.from('agent_operations').update({
          status: failed ? 'failed' : 'completed',
          result: record,
          external_task_id: record.taskId || record.jobId || record.snapshotId || null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', operationId);
        return { ...record, operationKey };
      } catch (error) {
        await ctx.supabase.from('agent_operations').update({
          status: 'failed',
          result: { error: error instanceof Error ? error.message : String(error) },
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', operationId);
        throw error;
      }
    };
  }
  return tools;
}
