// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ backend: vi.fn(), debit: vi.fn() }));
vi.mock('@/lib/models', () => ({ getBackend: state.backend }));
vi.mock('@/lib/billing/credits', () => ({ isBillingEnabled: async () => false, deductByTokens: state.debit, deductCredits: state.debit }));
import { createTools, type AgentContext } from '@/lib/agent-tools';
import { ImageProviderRefusalError } from '@/lib/models/image-provider-refusal';
import { shouldStopAfterTerminalToolFailure } from '@/lib/agent-terminal';

beforeEach(() => {
  vi.clearAllMocks();
  state.backend.mockImplementation(id => ({ id, canHandle: () => true, generate: async () => {
    if (id === 'gpt-image-2.6-flare') throw new ImageProviderRefusalError('openai', 'moderation_blocked');
    return { image: 'data:image/png;base64,YQ==', provider: id === 'qwen-spicy' ? 'mulerouter' : 'openrouter', usage: { modelId: id, inputTokens: 1, outputTokens: 2, providerCostUsd: 0.036 } };
  } }));
});
it.each([false, undefined, true])('real Agent tool preserves NSFW=%j through recovery or direct Spicy execution', async isNsfw => {
  const ctx: AgentContext = { projectId: 'isolated-test', currentImage: '', explicitMediaIndices: [], generatedImages: [], snapshotImages: [], currentSnapshotIndex: -1, isNsfw };
  const tool = createTools(ctx, { spec: { provider: 'test', supportsImageInput: true } } as any).generate_image;
  const result = await (tool.execute as any)({ editPrompt: 'Pikachu eating an apple', benignCharacterContent: true }, {});
  expect(result.success).toBe(true);
  expect(result.contentBlocked).toBeUndefined();
  expect(ctx.isNsfw).toBe(isNsfw);
  expect(ctx.generatedImages).toHaveLength(1);
  expect(ctx.snapshotImages).toHaveLength(1);
  expect(state.debit).toHaveBeenCalledOnce();
  expect(state.backend.mock.calls.map(([id]) => id)).toEqual(isNsfw ? ['qwen-spicy'] : ['gpt-image-2.6-flare', 'gemini-2.1']);
});

it('stops the Agent turn after exhausted recovery, then allows an unrelated ordinary image on the next input', async () => {
  state.backend.mockImplementation(id => ({ id, canHandle: () => true, generate: async () => { throw new ImageProviderRefusalError('openai', 'moderation_blocked'); } }));
  const ctx: AgentContext = { projectId: 'isolated-test', currentImage: '', explicitMediaIndices: [], generatedImages: [], snapshotImages: [], currentSnapshotIndex: -1, isNsfw: false };
  const tool = createTools(ctx, { spec: { provider: 'test', supportsImageInput: true } } as any).generate_image;
  const result = await (tool.execute as any)({ editPrompt: 'Mickey Mouse in a garden', benignCharacterContent: true }, {});
  expect(result).toMatchObject({ success: false, terminal: true, errorCode: 'image_character_recovery_exhausted' });
  expect(Object.keys(result.userMessage)).toEqual(['zh', 'zh-Hant', 'en', 'ja']);
  expect(shouldStopAfterTerminalToolFailure({ toolResults: [{ toolName: 'generate_image', output: result }] })).toBe(true);
  expect(state.backend.mock.calls.map(([id]) => id)).toEqual(['gpt-image-2.6-flare', 'gemini-2.1']);
  expect(state.debit).not.toHaveBeenCalled(); expect(ctx.isNsfw).toBe(false);
  state.backend.mockClear().mockImplementation(id => ({ id, canHandle: () => true, generate: async () => ({ image: 'data:image/png;base64,YQ==', provider: 'openai' }) }));
  const ordinary = await (tool.execute as any)({ editPrompt: 'A plain red ceramic cup', benignCharacterContent: false }, {});
  expect(ordinary.success).toBe(true); expect(ordinary.terminal).toBeUndefined();
  expect(ctx.isNsfw).toBe(false); expect(state.backend.mock.calls.map(([id]) => id)).toEqual(['gpt-image-2.6-flare']);
});


it.each([false, true])('stores only the delivered model tuning, recovered=%j', async recovered => {
  if (!recovered) state.backend.mockImplementation(id => ({ id, canHandle: () => true, generate: async () => ({ image: 'data:image/png;base64,YQ==', provider: 'openai' }) }));
  const ctx: AgentContext = { projectId: 'isolated-test', currentImage: '', explicitMediaIndices: [], generatedImages: [], snapshotImages: [], currentSnapshotIndex: -1, isNsfw: false };
  const tool = createTools(ctx, { spec: { provider: 'test', supportsImageInput: true } } as any).generate_image;
  const result = await (tool.execute as any)({ editPrompt: 'Mario versus Pikachu poster', benignCharacterContent: true, imageQuality: 'high', imageReasoningEffort: 'high' }, {});
  expect(result.success).toBe(true);
  expect(ctx.generatedImageMetadata?.get(0)?.imageGeneration).toMatchObject({
    model: recovered ? 'gemini-2.1' : 'gpt-image-2.6-flare',
    imageQuality: recovered ? undefined : 'high',
    imageReasoningEffort: recovered ? undefined : 'high',
  });
  expect(ctx.isNsfw).toBe(false);
});
