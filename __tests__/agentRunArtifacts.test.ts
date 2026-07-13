import { describe, expect, it } from 'vitest';
import { extractStudioDeliveryVideo } from '../src/lib/agent-run-artifacts';

describe('agent run artifact recovery', () => {
  it('extracts the latest run-scoped Studio delivery video', () => {
    expect(extractStudioDeliveryVideo([
      {
        created_at: '2026-07-12T09:54:28Z',
        input: {
          operation: 'put_artifact',
          stage: 'delivery',
          artifact: {
            outputPath: 'https://cdn.example/final.mp4',
            editableSourcePath: 'project/code/final.json',
          },
        },
      },
    ])).toEqual({
      outputPath: 'https://cdn.example/final.mp4',
      editableSourcePath: 'project/code/final.json',
      createdAt: '2026-07-12T09:54:28Z',
    });
  });

  it('accepts run-scoped workspace paths and ignores non-delivery artifacts', () => {
    expect(extractStudioDeliveryVideo([
      { input: { operation: 'put_artifact', stage: 'review', artifact: { outputPath: 'https://cdn.example/review.mp4' } } },
      { input: { operation: 'put_artifact', stage: 'delivery', artifact: { outputPath: 'project/media/final.mp4' } } },
    ])).toEqual({ outputPath: 'project/media/final.mp4' });
  });
});
