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
  code?: 'stream_error' | 'missing_finish' | 'empty_final_step' | 'truncated' | 'provider_error' | 'content_filter' | 'unfinished_tool_turn' | 'attempt_budget_handoff' | 'studio_run_incomplete' | 'studio_stage_handoff' | 'non_retryable_tool_failure';
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
    if (result.toolName !== 'write_file' || !result.output || typeof result.output !== 'object') return false;
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

const CHINESE_VIDEO_COUNT: Record<string, number> = {
  '一': 1,
  '两': 2,
  '二': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
  '七': 7,
  '八': 8,
  '九': 9,
  '十': 10,
};

export function requestedAsyncVideoSubmissionCount(prompt: string, priorContext = ''): number | null {
  const currentRequest = prompt.split('[User request').at(-1) || prompt;
  const isBriefContinuation = /^(?:ok(?:ay)?|yes|go|do it|proceed|好(?:的)?|可以|确认|开始|继续|重试(?:下)?)[\s.!。！]*$/i.test(currentRequest.trim());
  const requestContext = isBriefContinuation && priorContext.trim()
    ? `${priorContext}\n${currentRequest}`
    : currentRequest;
  const patterns = [
    /(?:生成|创建|制作|做|来|再生成|再做)\s*(\d+|[一两二三四五六七八九十])\s*(?:个|条|支|段|款|版|份|种)/gi,
    /(?:generate|create|make|produce)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:videos?|clips?|variants?|versions?)/gi,
    /(\d+|[一两二三四五六七八九十])\s*(?:个|条|支|段|款|版|份|种)\s*(?:不同(?:的)?\s*)?(?:视频|短片|动画|片段|版本|变体|动法|动作|方式|方案|效果|表情包)/gi,
    /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:different\s+)?(?:videos?|clips?|animations?|variants?|versions?|ways?)/gi,
  ];
  const englishCounts: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  let resolved: { count: number; index: number } | null = null;
  for (const pattern of patterns) {
    for (const match of requestContext.matchAll(pattern)) {
      const token = match[1].toLowerCase();
      const count = Number(token) || CHINESE_VIDEO_COUNT[token] || englishCounts[token];
      if (Number.isInteger(count) && count > 0 && (match.index ?? -1) >= (resolved?.index ?? -1)) {
        resolved = { count: Math.min(count, 10), index: match.index ?? 0 };
      }
    }
  }
  if (resolved) return resolved.count;

  const asksForOpenEndedMultiple = /(?:多个|多条|几(?:个|条|支|段|款|版|份)|若干|一批).{0,16}(?:视频|短片|动画|片段|版本|变体|动法|动作|方式|方案|效果|表情包)|(?:multiple|several|many|a few)\s+(?:videos?|clips?|animations?|variants?|versions?)/i.test(requestContext);
  if (asksForOpenEndedMultiple) return null;
  return 1;
}

export function requestsContinuedVideoWorkflow(prompt: string): boolean {
  const currentRequest = (prompt.split('[User request').at(-1) || prompt).toLowerCase();
  if (/(?:remotion|studio\s*run|explainer|vlog|composition|解说视频|介绍短片|剪辑|合成)/i.test(currentRequest)) return true;
  const durations = Array.from(currentRequest.matchAll(/(\d+(?:\.\d+)?)\s*(?:s|sec(?:ond)?s?|秒)/gi));
  return durations.some(match => Number(match[1]) > 15);
}

export function shouldStopAfterAsyncVideoSubmission(input: {
  durableExecution: boolean;
  studioRunActive: boolean;
  requestedCount: number | null;
  steps: ReadonlyArray<{ toolResults?: ReadonlyArray<{ toolName?: string; output?: unknown }> }>;
}): boolean {
  if (!input.durableExecution || input.studioRunActive) return false;
  if (input.requestedCount == null) return false;
  let submitted = 0;
  for (const step of input.steps) {
    for (const result of step.toolResults || []) {
      if (result.toolName !== 'generate_animation' || !result.output || typeof result.output !== 'object') continue;
      if ((result.output as Record<string, unknown>).success === true) submitted++;
    }
  }
  return submitted >= Math.max(1, input.requestedCount);
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
    || ['导出视频', '导出成片', '视频成片', '最终视频', '做个视频', '做条视频', '做一条视频', '短片'].some(term => normalized.includes(term));
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
}): boolean {
  return input.activeStudioRun && (
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
