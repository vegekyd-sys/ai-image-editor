import { describe, expect, it } from 'vitest';
import { buildAgentRecoveryContext } from '@/lib/agent-context';

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
  });
});
