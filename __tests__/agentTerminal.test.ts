import { describe, expect, it } from 'vitest';
import {
  classifyModelTermination,
  describeModelStreamError,
  resolvePersistedRunStatus,
  requestsStudioRunCompletion,
  resolveStudioCompletionRequested,
  shouldCompleteDurableStudioRun,
  shouldContinueActiveStudioRun,
  shouldHandoffToStudioComposition,
  requestsMaterializedVideo,
  shouldStopAfterDurablePublishToolStep,
  shouldStopAfterTerminalToolFailure,
  shouldStopAfterStudioToolStep,
  shouldUseTextOnlyRecovery,
} from '@/lib/agent-terminal';

describe('agent terminal semantics', () => {
  it('rejects the exact empty final step that previously became a silent success', () => {
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason: 'stop',
      finalStepTextChars: 0,
      finalStepToolCalls: 0,
      finalStepDeliveredArtifact: false,
    })).toMatchObject({ ok: false, retryable: true, code: 'empty_final_step' });
  });

  it.each(['length', 'error', 'other'] as const)('rejects %s even when the provider closes normally', (finishReason) => {
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason,
      finalStepTextChars: 12,
      finalStepToolCalls: 0,
      finalStepDeliveredArtifact: false,
    }).ok).toBe(false);
  });

  it('keeps nested transport details for durable diagnosis', () => {
    const cause = Object.assign(new Error('socket disconnected before TLS'), { code: 'ECONNRESET' });
    const error = Object.assign(new Error('fetch failed'), { cause });
    const detail = describeModelStreamError(error);
    expect(detail).toContain('fetch failed');
    expect(detail).toContain('ECONNRESET');
    expect(classifyModelTermination({
      sawFinish: false,
      finalStepTextChars: 0,
      finalStepToolCalls: 0,
      finalStepDeliveredArtifact: false,
      streamError: error,
    }).detail).toBe(detail);
  });

  it('accepts a clean final reply or a completed final tool action', () => {
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason: 'stop',
      finalStepTextChars: 12,
      finalStepToolCalls: 0,
      finalStepDeliveredArtifact: false,
    }).ok).toBe(true);
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason: 'tool-calls',
      finalStepTextChars: 0,
      finalStepToolCalls: 1,
      finalStepDeliveredArtifact: true,
    }).ok).toBe(true);
  });

  it('does not treat preview/read tools as delivery', () => {
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason: 'tool-calls',
      finalStepTextChars: 0,
      finalStepToolCalls: 1,
      finalStepDeliveredArtifact: false,
    })).toMatchObject({ ok: false, code: 'unfinished_tool_turn' });
  });

  it('keeps tools enabled when delivered images are only intermediate Studio Run assets', () => {
    expect(shouldUseTextOnlyRecovery({ deliveredArtifact: true, activeStudioRun: true })).toBe(false);
    expect(shouldUseTextOnlyRecovery({ deliveredArtifact: true, activeStudioRun: false })).toBe(true);
  });

  it('does not allow a touched running Studio Run to end with a promise to continue later', () => {
    expect(shouldContinueActiveStudioRun({
      activeStudioRun: true,
      studioRunTouched: true,
      runCodeStarted: false,
      recoveryPrompt: false,
      completionRequested: true,
    })).toBe(true);
    expect(shouldContinueActiveStudioRun({
      activeStudioRun: false,
      studioRunTouched: true,
      runCodeStarted: true,
      recoveryPrompt: true,
      completionRequested: true,
    })).toBe(false);
  });

  it('lets an Agent Run finish while its Studio workflow intentionally waits for the next user turn', () => {
    expect(shouldContinueActiveStudioRun({
      activeStudioRun: true,
      studioRunTouched: true,
      runCodeStarted: false,
      recoveryPrompt: false,
      attemptWorkUnit: 'studio:review',
      completionRequested: false,
    })).toBe(false);
    expect(requestsStudioRunCompletion('你不用导出，现在草稿不对，等我继续反馈')).toBe(false);
    expect(requestsStudioRunCompletion('Studio Run 先不要导出视频，等我看完草稿')).toBe(false);
    expect(requestsStudioRunCompletion("Don't export the Studio Run yet; wait for my review.")).toBe(false);
    expect(requestsStudioRunCompletion('不要只给预览，要导出最终视频')).toBe(true);
    expect(resolveStudioCompletionRequested(
      '你不用导出，现在草稿不对，等我继续反馈',
      '给这个角色做个有意思的介绍视频，用 Studio Run',
    )).toBe(false);
    expect(resolveStudioCompletionRequested(
      '[System durable continuation] Resume attempt 3 at review.',
      '你不用导出，现在草稿不对，等我继续反馈',
    )).toBe(false);
  });

  it('keeps a durable Studio work unit alive while an async asset finishes', () => {
    expect(shouldContinueActiveStudioRun({
      activeStudioRun: true,
      studioRunTouched: false,
      runCodeStarted: false,
      recoveryPrompt: false,
      attemptWorkUnit: 'studio:assets',
      completionRequested: true,
    })).toBe(true);
    expect(shouldContinueActiveStudioRun({
      activeStudioRun: true,
      studioRunTouched: false,
      runCodeStarted: false,
      recoveryPrompt: false,
      attemptWorkUnit: 'agent',
      completionRequested: true,
    })).toBe(false);
  });

  it('keeps explicit video delivery and explicit Studio completion requests durable', () => {
    expect(requestsStudioRunCompletion('给这个角色做个有意思的介绍视频，用 Studio Run')).toBe(true);
    expect(requestsStudioRunCompletion('继续完成当前 Studio Run')).toBe(true);
    expect(requestsStudioRunCompletion('resume the current Studio Run')).toBe(true);
    expect(resolveStudioCompletionRequested(
      '[System durable continuation] Resume attempt 2 at review.',
      '给这个角色做个有意思的介绍视频，用 Studio Run',
    )).toBe(true);
    expect(resolveStudioCompletionRequested(
      '继续完成当前 Studio Run',
      'Studio Run 先不要导出视频，等我看完草稿',
    )).toBe(true);
  });

  it('hands Composition to a dedicated durable attempt before code generation starts', () => {
    expect(shouldHandoffToStudioComposition({
      durableExecution: true,
      attemptWorkUnit: 'studio:assets',
      currentStage: 'composition',
    })).toBe(true);
    expect(shouldHandoffToStudioComposition({
      durableExecution: true,
      attemptWorkUnit: 'studio:composition',
      currentStage: 'composition',
    })).toBe(false);
    expect(shouldHandoffToStudioComposition({
      durableExecution: false,
      attemptWorkUnit: 'studio:assets',
      currentStage: 'composition',
    })).toBe(false);
  });

  it('stops the AI SDK tool loop on the same step that advances Assets to Composition', () => {
    expect(shouldStopAfterStudioToolStep({
      durableExecution: true,
      attemptWorkUnit: 'studio:assets',
      toolResults: [{
        toolName: 'studio_run',
        output: { success: true, studioRun: { status: 'running', currentStage: 'composition' } },
      }],
    })).toBe(true);
    expect(shouldStopAfterStudioToolStep({
      durableExecution: true,
      attemptWorkUnit: 'studio:composition',
      toolResults: [{
        toolName: 'studio_run',
        output: { success: true, studioRun: { status: 'running', currentStage: 'composition' } },
      }],
    })).toBe(false);
    expect(shouldStopAfterStudioToolStep({
      durableExecution: true,
      attemptWorkUnit: 'studio:assets',
      toolResults: [{
        toolName: 'write_file',
        output: { success: true },
      }],
    })).toBe(false);
  });

  it('lets the agent repair a non-retryable input, but stops a terminal repeat', () => {
    expect(shouldStopAfterTerminalToolFailure({
      toolResults: [{
        toolName: 'generate_animation',
        output: { success: false, retryable: false, repairable: true, terminal: false, errorCode: 'seedance_reference_image_too_small' },
      }],
    })).toBe(false);
    expect(shouldStopAfterTerminalToolFailure({
      toolResults: [{
        toolName: 'generate_animation',
        output: { success: false, retryable: false, terminal: true, errorCode: 'seedance_reference_image_unchanged_retry_blocked' },
      }],
    })).toBe(true);
  });

  it('ends a durable execution as soon as Delivery completes the Studio Run', () => {
    expect(shouldCompleteDurableStudioRun({
      durableExecution: true,
      status: 'completed',
      currentStage: null,
    })).toBe(true);
    expect(shouldCompleteDurableStudioRun({
      durableExecution: false,
      status: 'completed',
      currentStage: null,
    })).toBe(false);
    expect(shouldCompleteDurableStudioRun({
      durableExecution: true,
      status: 'running',
      currentStage: 'review',
    })).toBe(false);
  });

  it('stops a durable Agent Run on the same step that publishes its final artifact', () => {
    expect(shouldStopAfterDurablePublishToolStep({
      durableExecution: true,
      toolResults: [{ toolName: 'write_file', output: { success: true, published: true, artifactType: 'design' } }],
    })).toBe(true);
    expect(shouldStopAfterDurablePublishToolStep({
      durableExecution: true,
      toolResults: [{ toolName: 'publish_draft', output: { success: true, published: true, artifactType: 'design' } }],
    })).toBe(true);
    expect(shouldStopAfterDurablePublishToolStep({
      durableExecution: true,
      toolResults: [{ toolName: 'write_file', output: { success: true, published: [{ type: 'video' }] } }],
    })).toBe(true);
    expect(shouldStopAfterDurablePublishToolStep({
      durableExecution: true,
      toolResults: [{ toolName: 'write_file', output: { success: true, published: false } }],
    })).toBe(false);
    expect(shouldStopAfterDurablePublishToolStep({
      durableExecution: false,
      toolResults: [{ toolName: 'write_file', output: { success: true, published: true } }],
    })).toBe(false);
  });

  it('keeps a video request running after an editable design publish until video delivery', () => {
    expect(requestsMaterializedVideo('这6张图做个好玩的玩水vlog')).toBe(true);
    expect(requestsMaterializedVideo('finish and export an MP4 video')).toBe(true);
    expect(requestsMaterializedVideo('给这个角色做个有意思的介绍视频，用 Studio Run')).toBe(true);
    expect(requestsMaterializedVideo('做一张夏日海报')).toBe(false);
    expect(shouldStopAfterDurablePublishToolStep({
      durableExecution: true,
      requiresMaterializedVideo: true,
      toolResults: [{ toolName: 'write_file', output: { success: true, published: true, artifactType: 'design' } }],
    })).toBe(false);
    expect(shouldStopAfterDurablePublishToolStep({
      durableExecution: true,
      requiresMaterializedVideo: true,
      toolResults: [{ toolName: 'publish_draft', output: { success: true, published: true, artifactType: 'design' } }],
    })).toBe(false);
    expect(shouldStopAfterDurablePublishToolStep({
      durableExecution: true,
      requiresMaterializedVideo: true,
      toolResults: [{ toolName: 'write_file', output: { success: true, published: [{ type: 'video' }] } }],
    })).toBe(true);
  });

  it('never persists completed without explicit done evidence', () => {
    expect(resolvePersistedRunStatus({ currentStatus: 'running', sawDone: false, sawError: false })).toBe('failed');
    expect(resolvePersistedRunStatus({ currentStatus: 'running', sawDone: true, sawError: true })).toBe('failed');
    expect(resolvePersistedRunStatus({ currentStatus: 'running', sawDone: true, sawError: false })).toBe('completed');
    expect(resolvePersistedRunStatus({ currentStatus: 'aborted', sawDone: false, sawError: false })).toBe('aborted');
  });
});
