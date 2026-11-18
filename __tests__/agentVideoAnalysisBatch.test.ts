// @vitest-environment node
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { createTools, type AgentContext } from '@/lib/agent-tools';
import type { AgentModelRuntime } from '@/lib/agent-model-runtime';

const analyzeVideoContent = vi.hoisted(() => vi.fn());
vi.mock('@/lib/gemini', () => ({ analyzeVideoContent }));

it('limits concurrent video analysis while completing the whole batch in requested order', async () => {
  const requestedIndices = [9, 3, 11, 1, 7, 4, 2, 6, 5, 10, 8];
  const videoUrl = (index: number) => `https://example.com/video-${index}.mp4`;
  const ctx = {
    projectId: 'test-project',
    snapshotImages: Array.from({ length: 11 }, (_, i) => videoUrl(i + 1)),
  } as AgentContext;
  const runtime = { spec: { provider: 'deepseek' } } as AgentModelRuntime;
  let active = 0;
  let peak = 0;
  analyzeVideoContent.mockImplementation(async (url: string) => {
    active++;
    peak = Math.max(peak, active);
    try {
      // Complete out of order and make one item fail without losing later items.
      await delay(url === videoUrl(9) ? 30 : 5);
      if (url === videoUrl(3)) throw new Error('Provider unavailable');
      return `Analysis of ${url}`;
    } finally {
      active--;
    }
  });

  const tool = createTools(ctx, runtime).analyze_video;
  const result = await tool.execute!(
    { media_indices: [...requestedIndices, 9] },
    { toolCallId: 'video-batch', messages: [], context: {} },
  );

  expect(peak).toBe(4);
  expect(analyzeVideoContent).toHaveBeenCalledTimes(11);
  expect(result).toEqual({
    mode: 'batch_describe',
    analyses: requestedIndices.map(media_index => media_index === 3
      ? { media_index, error: 'Video analysis failed: Provider unavailable' }
      : { media_index, analysis: `Analysis of ${videoUrl(media_index)}`, videoUrl: videoUrl(media_index), source_range: undefined }),
  });
});
