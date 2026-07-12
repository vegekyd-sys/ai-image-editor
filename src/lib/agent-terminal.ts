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
  code?: 'stream_error' | 'missing_finish' | 'empty_final_step' | 'truncated' | 'provider_error' | 'content_filter' | 'unfinished_tool_turn' | 'studio_run_incomplete';
  detail?: string;
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
}): boolean {
  return input.activeStudioRun && (
    input.studioRunTouched
    || input.runCodeStarted
    || input.recoveryPrompt
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
