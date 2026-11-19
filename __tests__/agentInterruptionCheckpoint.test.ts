import { describe, expect, it } from 'vitest';
import { recoverCompositionReceipt } from '@/lib/agent-interruption-checkpoint';

const projectId = 'project-1';
const draftPath = `${projectId}/drafts/latest-composition.json`;

describe('interrupted Agent composition receipts', () => {
  it('recovers the persisted draft from a successful run_code result', () => {
    expect(recoverCompositionReceipt(projectId, {
      tool_name: 'run_code',
      input: { code_path: 'an-input-file.js' },
      output: { type: 'json', value: { type: 'text', code_path: draftPath } },
    })).toEqual({ draftPath, lastTool: 'run_code' });
  });

  it('keeps the export identity even when the request used a snapshot id', () => {
    expect(recoverCompositionReceipt(projectId, {
      tool_name: 'materialize_media',
      input: { snapshot_id: 'snapshot' },
      output: { type: 'json', value: { success: true, jobId: 'job', status: 'queued' } },
    })).toEqual({ draftPath: undefined, exportJobId: 'job', lastTool: 'materialize_media' });
  });

  it('ignores a failed result, an unrelated JSON write, and a cross-project path', () => {
    const rows = [
      { tool_name: 'materialize_media', input: {}, output: { success: false, jobId: 'job' } },
      { tool_name: 'write_file', input: {}, output: { success: true, path: `${projectId}/drafts/storyboard.json` } },
      { tool_name: 'run_code', input: {}, output: { code_path: 'another-project/drafts/latest-composition.json' } },
      { tool_name: 'run_code', input: {}, output: { code_path: `${projectId}/drafts/../private.json` } },
    ];
    for (const row of rows) expect(recoverCompositionReceipt(projectId, row)).toBeUndefined();
  });
});
