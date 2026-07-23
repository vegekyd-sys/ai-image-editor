export type AgentFinishReason =
  | 'stop'
  | 'tool-calls'
  | 'length'
  | 'content-filter'
  | 'error'
  | 'other'
  | string;

export interface ModelTerminationObservation {
  sawFinish: boolean;
  finishReason?: AgentFinishReason;
  rawFinishReason?: string;
  finalStepTextChars: number;
  finalStepToolCalls: number;
  finalStepDeliveredArtifact: boolean;
  streamError?: unknown;
}

export interface ModelTerminationAssessment {
  ok: boolean;
  retryable: boolean;
  code?: 'stream_error' | 'missing_finish' | 'empty_final_step' | 'truncated' | 'provider_error' | 'content_filter' | 'unfinished_tool_turn' | 'attempt_budget_handoff' | 'studio_run_incomplete' | 'studio_stage_handoff' | 'non_retryable_tool_failure' | 'skill_video_submission_pending';
  detail?: string;
}

export function shouldHandoffToStudioComposition(input: {
  durableExecution: boolean;
  attemptWorkUnit?: string;
  currentStage?: string;
}): boolean {
  return input.durableExecution
    && input.currentStage === 'composition'
    && input.attemptWorkUnit !== 'studio:composition';
}

export function shouldCompleteDurableStudioRun(input: {
  durableExecution: boolean;
  status?: string;
  currentStage?: string | null;
}): boolean {
  return input.durableExecution
    && input.status === 'completed'
    && !input.currentStage;
}

export function shouldStopAfterStudioToolStep(input: {
  durableExecution: boolean;
  attemptWorkUnit?: string;
  toolResults?: ReadonlyArray<{ toolName?: string; output?: unknown }>;
}): boolean {
  if (!input.durableExecution) return false;
  return Boolean(input.toolResults?.some(result => {
    if (result.toolName !== 'studio_run' || !result.output || typeof result.output !== 'object') return false;
    const output = result.output as Record<string, unknown>;
    if (output.success === false || !output.studioRun || typeof output.studioRun !== 'object') return false;
    const studioRun = output.studioRun as Record<string, unknown>;
    const currentStage = typeof studioRun.currentStage === 'string' ? studioRun.currentStage : undefined;
    const status = typeof studioRun.status === 'string' ? studioRun.status : undefined;
    return shouldHandoffToStudioComposition({
      durableExecution: true,
      attemptWorkUnit: input.attemptWorkUnit,
      currentStage,
    }) || shouldCompleteDurableStudioRun({
      durableExecution: true,
      status,
      currentStage: currentStage || null,
    });
  }));
}

export function shouldStopAfterDurablePublishToolStep(input: {
  durableExecution: boolean;
  requiresMaterializedVideo?: boolean;
  toolResults?: ReadonlyArray<{ toolName?: string; output?: unknown }>;
}): boolean {
  if (!input.durableExecution) return false;
  return Boolean(input.toolResults?.some(result => {
    if (!['write_file', 'publish_draft'].includes(result.toolName || '') || !result.output || typeof result.output !== 'object') return false;
    const output = result.output as Record<string, unknown>;
    if (output.success === false) return false;
    if (input.requiresMaterializedVideo) {
      if (output.published === true) return output.artifactType === 'video';
      return Array.isArray(output.published) && output.published.some(item => (
        item && typeof item === 'object' && (item as Record<string, unknown>).type === 'video'
      ));
    }
    if (output.published === true) return true;
    return Array.isArray(output.published) && output.published.length > 0;
  }));
}

export function shouldStopAfterTerminalToolFailure(input: {
  toolResults?: ReadonlyArray<{ toolName?: string; output?: unknown }>;
}): boolean {
  return Boolean(input.toolResults?.some(result => {
    if (!result.output || typeof result.output !== 'object') return false;
    const output = result.output as Record<string, unknown>;
    return output.success === false && output.terminal === true;
  }));
}

export function requestsMaterializedVideo(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return /\b(?:mp4|vlog)\b/.test(normalized)
    || /\bexport\b.{0,24}\bvideo\b/.test(normalized)
    || /\b(?:make|create|produce|finish)\b.{0,32}\bvideo\b/.test(normalized)
    || /(?:做|制作|生成|创建|剪辑|编辑|导出).{0,20}视频/.test(normalized)
    || /视频.{0,20}(?:制作|生成|导出|成片)/.test(normalized)
    || ['导出视频', '导出成片', '视频成片', '最终视频', '做个视频', '做条视频', '做一条视频', '短片'].some(term => normalized.includes(term));
}

function explicitlyPausesStudioRunCompletion(prompt: string): boolean {
  return /(?:不用|不要|别|无需|暂不|先不)\s*(?:再\s*)?(?:自动\s*)?(?:继续\s*)?(?:导出|完成|跑完|继续|materialize|export|complete|continue)/i.test(prompt)
    || /\b(?:do not|don't|dont|no need to)\b.{0,24}\b(?:export|complete|continue|materialize)\b/i.test(prompt);
}

export function requestsStudioRunCompletion(prompt: string): boolean {
  if (explicitlyPausesStudioRunCompletion(prompt)) return false;
  const namesStudioRun = /studio\s*run/i.test(prompt);
  return requestsMaterializedVideo(prompt)
    || (namesStudioRun && /(?:视频|成片|video|export)/i.test(prompt))
    || /(?:继续|接着|恢复|续上|跑完|完成|continue|resume).{0,48}studio\s*run/i.test(prompt)
    || /studio\s*run.{0,48}(?:继续|接着|恢复|续上|跑完|完成|continue|resume)/i.test(prompt);
}

export function resolveStudioCompletionRequested(
  prompt: string,
  durableObjective?: string,
): boolean {
  const isAutomaticContinuation = prompt.includes('[System durable continuation]')
    || prompt.includes('[System automatic recovery]')
    || prompt.includes('[Recoverable Agent Checkpoint]');
  if (!isAutomaticContinuation) {
    if (explicitlyPausesStudioRunCompletion(prompt)) return false;
    if (requestsStudioRunCompletion(prompt)) return true;
  }
  return requestsStudioRunCompletion(durableObjective?.trim() || prompt);
}

export function shouldUseTextOnlyRecovery(input: {
  deliveredArtifact: boolean;
  activeStudioRun: boolean;
}): boolean {
  return input.deliveredArtifact && !input.activeStudioRun;
}

export function shouldContinueActiveStudioRun(input: {
  activeStudioRun: boolean;
  studioRunTouched: boolean;
  runCodeStarted: boolean;
  recoveryPrompt: boolean;
  attemptWorkUnit?: string;
  completionRequested: boolean;
}): boolean {
  return input.activeStudioRun && input.completionRequested && (
    input.studioRunTouched
    || input.runCodeStarted
    || input.recoveryPrompt
    || Boolean(input.attemptWorkUnit?.startsWith('studio:'))
  );
}

export function describeModelStreamError(error: unknown, depth = 0): string {
  if (error == null) return '';
  if (depth > 3) return '';
  if (typeof error !== 'object') return String(error);

  const record = error as Record<string, unknown>;
  const name = error instanceof Error ? error.name : typeof record.name === 'string' ? record.name : '';
  const message = error instanceof Error ? error.message : typeof record.message === 'string' ? record.message : '';
  const code = typeof record.code === 'string' ? record.code : '';
  const statusCode = typeof record.statusCode === 'number'
    ? String(record.statusCode)
    : typeof (record.$metadata as Record<string, unknown> | undefined)?.httpStatusCode === 'number'
      ? String((record.$metadata as Record<string, unknown>).httpStatusCode)
      : '';
  const own = [name, message, code && `code=${code}`, statusCode && `status=${statusCode}`].filter(Boolean).join(': ');
  const cause = describeModelStreamError(record.cause, depth + 1);
  return [own, cause && `cause=${cause}`].filter(Boolean).join(' | ') || String(error);
}

/**
 * A transport EOF is not proof that an agent fulfilled the turn. The final
 * model step must end cleanly and produce either user-visible text or a
 * completed tool action. This prevents an exhausted reasoning turn from being
 * persisted as a successful run.
 */
export function classifyModelTermination(
  observation: ModelTerminationObservation,
): ModelTerminationAssessment {
  if (observation.streamError) {
    return {
      ok: false,
      retryable: true,
      code: 'stream_error',
      detail: describeModelStreamError(observation.streamError),
    };
  }

  if (!observation.sawFinish || !observation.finishReason) {
    return { ok: false, retryable: true, code: 'missing_finish' };
  }

  if (observation.finishReason === 'content-filter') {
    return { ok: false, retryable: false, code: 'content_filter', detail: observation.rawFinishReason };
  }
  if (observation.finishReason === 'length') {
    return { ok: false, retryable: true, code: 'truncated', detail: observation.rawFinishReason };
  }
  if (observation.finishReason === 'error' || observation.finishReason === 'other') {
    return { ok: false, retryable: true, code: 'provider_error', detail: observation.rawFinishReason };
  }

  const hasText = observation.finalStepTextChars > 0;
  const deliveredArtifact = observation.finalStepDeliveredArtifact;
  if (observation.finishReason === 'tool-calls' && !deliveredArtifact) {
    return { ok: false, retryable: true, code: 'unfinished_tool_turn' };
  }
  if (!hasText && !deliveredArtifact) {
    return { ok: false, retryable: true, code: 'empty_final_step', detail: observation.rawFinishReason };
  }

  return { ok: true, retryable: false };
}

export function resolvePersistedRunStatus(input: {
  currentStatus?: string | null;
  sawDone: boolean;
  sawError: boolean;
}): 'completed' | 'failed' | 'aborted' {
  if (input.currentStatus === 'aborted') return 'aborted';
  if (input.currentStatus === 'failed') return 'failed';
  if (input.sawError || !input.sawDone) return 'failed';
  return 'completed';
}
