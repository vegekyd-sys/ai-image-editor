import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ generateText: vi.fn(), getTokenRate: vi.fn() }));
vi.mock('ai', async importOriginal => ({ ...await importOriginal<typeof import('ai')>(), generateText: mocks.generateText }));
vi.mock('@/lib/billing/token-rates', () => ({ getTokenRate: mocks.getTokenRate }));
vi.mock('@/lib/kling', () => ({ parseTotalDuration: () => 5 }));
vi.mock('@/lib/prompts/animate.md', () => ({ default: 'Write a video script.' }));
import { writeVideoScript } from '@/lib/skills/write-video-script';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T02:00:00Z'));
  vi.stubEnv('AGENT_MODEL', '');
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-only');
  mocks.getTokenRate.mockResolvedValue({ model_id: 'deepseek/deepseek-flash', input_per_1m: .3, cache_read_per_1m: .006, cache_write_per_1m: 0, output_per_1m: 1.2, markup: 2 });
  mocks.generateText.mockResolvedValue({ text: 'Title\nShot 1 (5s): A wizard.', steps: [], usage: { inputTokens: 1_500_000, inputTokenDetails: { noCacheTokens: 1_000_000, cacheReadTokens: 500_000 }, outputTokens: 1_000_000 } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('uses the Flash default with native PNG input and off-peak supplier cost before markup', async () => {
  const result = await writeVideoScript({ images: [png] });
  expect(result.success).toBe(true);
  expect(result.usage).toMatchObject({ modelId: 'deepseek/deepseek-flash', provider: 'deepseek' });
  expect(result.usage?.providerCostUsd).toBeCloseTo(.7515);
  expect(mocks.generateText.mock.calls[0][0].messages[0].content[0].image).toBe(png);
  expect(mocks.generateText.mock.calls[0][0].providerOptions).toMatchObject({ deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'high' } });
});

it('rejects missing exact Flash pricing before requesting a paid inference', async () => {
  mocks.getTokenRate.mockResolvedValue(null);
  expect((await writeVideoScript({ images: [png] })).success).toBe(false);
  expect(mocks.generateText).not.toHaveBeenCalled();
});
