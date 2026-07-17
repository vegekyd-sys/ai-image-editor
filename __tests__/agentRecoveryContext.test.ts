import { describe, expect, it } from 'vitest';
import {
  buildAgentRecoveryContext,
  isStudioRunContinuationRequest,
  selectPriorTerminalRun,
} from '@/lib/agent-context';

const metadata = {
  terminal: {
    recoverable: true,
    checkpoint: {
      draftPath: 'project/code/saved-draft.json',
      previewUrl: 'https://cdn.example.com/preview.jpg',
      lastTool: 'preview_frame',
    },
  },
};

describe('agent recovery context', () => {
  it('skips aborted transport attempts but keeps a completed run as a stale-checkpoint barrier', () => {
    expect(selectPriorTerminalRun([
      { id: 'current', status: 'running' },
      { id: 'aborted', status: 'aborted' },
      { id: 'failed', status: 'failed' },
    ], 'current')?.id).toBe('failed');

    expect(selectPriorTerminalRun([
      { id: 'aborted', status: 'aborted' },
      { id: 'completed', status: 'completed' },
      { id: 'failed', status: 'failed' },
    ])?.id).toBe('completed');
  });

  it('resumes from the exact saved draft instead of the original media', () => {
    const context = buildAgentRecoveryContext('继续', metadata);
    expect(context).toContain('project/code/saved-draft.json');
    expect(context).toContain('do not recreate the work from the original media');
    expect(context).toContain('preview_frame');
  });

  it('does not inject a stale checkpoint into an unrelated new request', () => {
    expect(buildAgentRecoveryContext('换成黑白风格', metadata)).toBe('');
  });

  it('recognizes a natural resume instruction, not only the exact word', () => {
    expect(buildAgentRecoveryContext('请继续刚才的修改', metadata)).toContain('project/code/saved-draft.json');
    expect(buildAgentRecoveryContext('继续之前的 Studio Run', metadata)).toContain('project/code/saved-draft.json');
    expect(buildAgentRecoveryContext('接着上次的内容做', metadata)).toContain('project/code/saved-draft.json');
  });

  it('recognizes an explicit continuation of an active Studio Run', () => {
    expect(isStudioRunContinuationRequest('继续当前 Studio Run 的 composition 阶段')).toBe(true);
    expect(isStudioRunContinuationRequest('Studio Run continue from review')).toBe(true);
    expect(isStudioRunContinuationRequest('把这张照片换成黑白')).toBe(false);
  });

  it('resumes a Studio Run from its durable stage even before a composition draft exists', () => {
    const context = buildAgentRecoveryContext('继续', {
      terminal: {
        recoverable: true,
        checkpoint: {
          studioRunId: 'studio-run-123',
          studioRunStage: 'composition',
          studioRunStatePath: 'project/studio-runs/studio-run-123/run.json',
          streamedCodePath: 'project/drafts/streamed-run-code.partial.js',
          streamedCodeChars: 8123,
          lastTool: 'read_file',
        },
      },
    });

    expect(context).toContain('studio-run-123');
    expect(context).toContain('current studio stage: composition');
    expect(context).toContain('Call studio_run status first');
    expect(context).toContain('Do not reread skill, prompt, director, component-library, or reference files');
    expect(context).toContain('composition-parts');
    expect(context).toContain('composition_parts.directory');
    expect(context).toContain('Do not restart a monolithic run_code payload');
    expect(context).not.toContain('under 9000 source characters');
    expect(context).toContain('streamed-run-code.partial.js (8123 chars)');
  });
});
