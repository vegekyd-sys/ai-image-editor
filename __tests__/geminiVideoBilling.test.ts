// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ route: vi.fn(), deduct: vi.fn(), subscription: vi.fn() }));
vi.mock('@/lib/gemini-video-subscription', () => ({ analyzeVideoWithRouting: mocks.route }));
vi.mock('@/lib/billing/credits', () => ({ deductByTokens: mocks.deduct, recordSubscriptionUsage: mocks.subscription }));
afterEach(() => { vi.clearAllMocks(); });

describe('video billing uses the verified route', () => {
  it.each(['google-api', 'gemini-subscription'])('records %s once and keeps token categories', async provider => {
    mocks.route.mockResolvedValue({
      provider, usedModel: provider === 'google-api' ? 'gemini-3.8-flash' : 'gemini-3.8-flash-n',
      elapsedMs: 1234,
      usage: { modelId: 'gemini-3.8-flash', inputTokens: 1000, outputTokens: 150, cacheReadTokens: 300 },
    });
    mocks.deduct.mockResolvedValue({ charged: 1, remaining: 10 });
    mocks.subscription.mockResolvedValue(undefined);
    const { analyzeVideoContentWithUsage } = await import('@/lib/gemini');
    await analyzeVideoContentWithUsage('https://example.com/video.mp4', 'Question', 'admin');
    expect(mocks.route).toHaveBeenCalledWith('https://example.com/video.mp4', 'Question', 'admin');
    if (provider === 'gemini-subscription') {
      expect(mocks.deduct).not.toHaveBeenCalled();
      expect(mocks.subscription).toHaveBeenCalledExactlyOnceWith('admin', 'gemini-subscription', 'analyze_video', 'gemini-3.8-flash-n', {
        inputTokens: 1000, outputTokens: 150, cacheReadTokens: 300, durationMs: 1234,
      });
    } else {
      expect(mocks.subscription).not.toHaveBeenCalled();
      expect(mocks.deduct).toHaveBeenCalledExactlyOnceWith('admin', 'analyze_video', 'gemini-3.8-flash', 700, 150, 1234, undefined, { cacheRead: 300, cacheWrite: 0 });
    }
  });

  it('records no ledger action after an unknown Relay outcome', async () => {
    mocks.route.mockRejectedValue(new Error('relay_unknown_outcome'));
    const { analyzeVideoContentWithUsage } = await import('@/lib/gemini');
    await expect(analyzeVideoContentWithUsage('https://example.com/video.mp4', undefined, 'admin')).rejects.toThrow('relay_unknown_outcome');
    expect(mocks.deduct).not.toHaveBeenCalled();
    expect(mocks.subscription).not.toHaveBeenCalled();
  });
});
