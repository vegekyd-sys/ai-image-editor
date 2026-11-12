// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/models', () => ({ getBackend: vi.fn() }));
import { getBackend } from '@/lib/models';
import { generateImage } from '@/lib/model-router';
import { ImageProviderRefusalError } from '@/lib/models/image-provider-refusal';
import type { GenerateImageRequest } from '@/lib/models/types';

const generate = vi.fn();
const usage = { modelId: 'unchanged-supplier-model', inputTokens: 10, outputTokens: 20, providerCostUsd: 0.05 };
beforeEach(() => {
  generate.mockReset().mockResolvedValue({ image: 'data:image/png;base64,unchanged', provider: 'original-supplier', usage });
  vi.mocked(getBackend).mockReset().mockImplementation(id => ({ id, canHandle: () => true, generate }));
});

const cases: [Partial<GenerateImageRequest>, string][] = [
  [{}, 'gpt-image-2.6-flare'],
  [{ image: 'https://example.com/base.png' }, 'gpt-image-2.6-flare'],
  [{ references: [{ url: 'https://example.com/ref.png', role: 'color reference' }] }, 'gpt-image-2.6-flare'],
  [{ background: 'transparent' }, 'gpt-image-2.6-flare'],
  [{ outputFormat: 'jpeg' }, 'gpt-image-2.6-flare'],
  [{ outputFormat: 'gif', frameCount: 6 }, 'gpt-image-2.6-flare'],
  [{ outputFormat: 'svg' }, 'gpt-image-2.6-flare'],
  [{ imageQuality: 'high', imageReasoningEffort: 'high' }, 'gpt-image-2.6-flare'],
  [{ aspectRatio: '8:1' }, 'gemini-2.1'],
  [{ model: 'gemini' }, 'gemini'],
  [{ model: 'wan2.7-image' }, 'wan2.7-image'],
  [{ isNsfw: true }, 'qwen-spicy'],
];
it.each(cases)('keeps ordinary %j on its original route with one submission and unchanged usage', async (options, model) => {
  const authorize = vi.fn();
  const request = Object.freeze({ prompt: 'A red ceramic cup', ...options, beforeImageRecovery: authorize });
  const result = await generateImage(request);
  expect(getBackend).toHaveBeenCalledExactlyOnceWith(model);
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ...options, prompt: request.prompt, model }));
  expect(generate.mock.calls[0][0].signal).toBeUndefined();
  expect(authorize).not.toHaveBeenCalled();
  expect(result.usage).toBe(usage);
  expect(result.provider).toBe('original-supplier');
  expect(result.fallbackUsed).toBe(false);
  expect(result.recovery).toBeUndefined();
  expect(result.contentBlocked).toBeUndefined();
});
it.each([undefined, false])('does not treat ordinary refusals as character requests (%j)', async benignCharacterContent => {
  generate.mockRejectedValue(new ImageProviderRefusalError('openai', 'moderation_blocked'));
  await expect(generateImage({ prompt: 'A red ceramic cup', benignCharacterContent })).rejects.toBeInstanceOf(ImageProviderRefusalError);
  expect(generate).toHaveBeenCalledOnce();
  expect(getBackend).toHaveBeenCalledExactlyOnceWith('gpt-image-2.6-flare');
});
