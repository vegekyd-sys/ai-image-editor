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
      url: 'https://cdn.example/final.mp4',
      editableSourcePath: 'project/code/final.json',
      createdAt: '2026-07-12T09:54:28Z',
    });
  });

  it('ignores non-delivery and non-URL artifacts', () => {
    expect(extractStudioDeliveryVideo([
      { input: { operation: 'put_artifact', stage: 'review', artifact: { outputPath: 'https://cdn.example/review.mp4' } } },
      { input: { operation: 'put_artifact', stage: 'delivery', artifact: { outputPath: 'project/media/final.mp4' } } },
    ])).toBeNull();
  });
});
