// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { IMAGE_MODEL_IDS, isFalImage25, resolveImageModel, type ModelId } from '@/lib/models/types';
import { formatImageCapabilitiesForAgent, ImageCapabilityError, resolveImageModelChain as resolveModelChain } from '@/lib/image-model-capabilities';
import { normalizeGenerateImageMediaIndex } from '@/lib/generate-image-input';
import { resolveToolName } from '@/lib/billing/pricing';

// Execute the actual factory in isolation: importing all unrelated Agent tools
// would also boot their SDKs and load every raw Markdown prompt in this test.
const source = readFileSync('src/lib/agent-tools.ts', 'utf8');
const parsed = ts.createSourceFile('agent-tools.ts', source, ts.ScriptTarget.Latest, true);
const factory = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createGenerateImageTool');
if (!factory) throw new Error('Missing generate_image factory');
const code = ts.transpileModule(factory.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function setup(provider = 'azure') {
  const editImage = vi.fn().mockResolvedValue({ success: true, image: 'data:image/jpeg;base64,YQ==', usedModel: 'wan2.7-image', provider: 'dashscope' });
  const deductByTokens = vi.fn().mockResolvedValue({ charged: 9, remaining: 91 });
  const requireCredits = vi.fn().mockResolvedValue({ ok: true, balance: 100 });
  const deductCredits = vi.fn().mockResolvedValue({ charged: 6, remaining: 94 });
  const getToolPrice = vi.fn().mockResolvedValue({ credits: 6, isFree: false });
  const getTokenRate = vi.fn().mockResolvedValue({ model_id: 'gpt-image-2.5-flare', markup: 2, is_active: true });
  const isBillingEnabled = vi.fn().mockResolvedValue(true);
  const ctx = { preferredModel: 'wan2.7-image' as ModelId | undefined, userId: 'test-user', projectId: 'test-project', currentImage: '', referenceImages: [] as string[], snapshotImages: [] as string[], generatedImages: [] as string[], lastUsedModel: undefined, isNsfw: false };
  const context = vm.createContext({
    tool: (definition: unknown) => definition, z, IMAGE_MODEL_IDS, isFalImage25, resolveImageModel, resolveModelChain, getTokenRate,
    generateImageToolPrompt: '', normalizeGenerateImageMediaIndex, formatImageCapabilitiesForAgent, ImageCapabilityError,
    validateImageIndex: (images: string[], index: number) => images[index - 1] ? { idx: index - 1 } : { error: 'Invalid media index' }, getToolPrice, isBillingEnabled,
    resolveToolName,
    editImage, requireCredits, deductCredits, refreshSnapshotUrls: vi.fn(), console,
    require: (name: string) => {
      if (name === './billing/credits') return { deductByTokens };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const create = vm.runInContext(`${code}\ncreateGenerateImageTool`, context);
  return { tool: create({ ctx, runtime: { spec: { provider } } }), ctx, editImage, requireCredits, deductCredits, deductByTokens, getToolPrice, isBillingEnabled, getTokenRate };
}

describe('App Agent Wan execution and billing', () => {
  it('keeps the app selection over tool choice and charges once before publishing', async () => {
    const { tool, ctx, editImage, requireCredits, deductCredits } = setup();
    const result = await tool.execute({ editPrompt: 'A mug.', model: 'gemini' });
    expect(result.success).toBe(true);
    expect(editImage.mock.calls[0][0].preferredModel).toBe('wan2.7-image');
    expect(requireCredits).toHaveBeenCalledWith('test-user', 6);
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledWith('test-user', null, 'edit_image', 'wan2.7-image', expect.any(Number));
    expect(ctx.generatedImages).toHaveLength(1);
    expect(ctx.lastUsedModel).toBe('wan2.7-image');
  });

  it('does not call the image backend when preflight fails', async () => {
    const { tool, editImage, requireCredits, deductCredits } = setup();
    requireCredits.mockResolvedValue({ ok: false, balance: 5 });
    expect(await tool.execute({ editPrompt: 'A mug.' })).toMatchObject({ success: false, error: 'insufficient_credits' });
    expect(editImage).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('does not bill an unsuccessful result even if a model id is present', async () => {
    const { tool, editImage, deductCredits } = setup();
    editImage.mockResolvedValue({ success: false, usedModel: 'wan2.7-image', provider: 'dashscope', message: 'No image.' });
    expect((await tool.execute({ editPrompt: 'A mug.' })).success).toBe(false);
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('rejects missing Wan pricing before contacting the provider', async () => {
    const { tool, editImage, getToolPrice, deductCredits } = setup();
    getToolPrice.mockResolvedValue(null);
    expect(await tool.execute({ editPrompt: 'A mug.' })).toMatchObject({ success: false, error: 'pricing_unavailable' });
    expect(editImage).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('does not require a price when the billing kill switch is off', async () => {
    const { tool, editImage, getToolPrice, isBillingEnabled, requireCredits } = setup();
    isBillingEnabled.mockResolvedValue(false);
    getToolPrice.mockResolvedValue(null);
    expect((await tool.execute({ editPrompt: 'A mug.' })).success).toBe(true);
    expect(editImage).toHaveBeenCalledTimes(1);
    expect(getToolPrice).not.toHaveBeenCalled();
    expect(requireCredits).not.toHaveBeenCalled();
  });

  it('awaits the debit and does not swallow an accounting failure', async () => {
    const { tool, ctx, deductCredits } = setup();
    deductCredits.mockRejectedValue(new Error('Ledger unavailable'));
    await expect(tool.execute({ editPrompt: 'A mug.' })).rejects.toThrow('Ledger unavailable');
    expect(ctx.generatedImages).toHaveLength(0);
  });

  it('awaits Gemini token accounting once before publishing a multi-image result', async () => {
    const { tool, ctx, editImage, deductByTokens, deductCredits } = setup();
    editImage.mockResolvedValue({ success: true, image: 'data:image/jpeg;base64,YQ==', usedModel: 'gemini',
      usage: { modelId: 'google/gemini-3.1-flash-image-preview', inputTokens: 600, outputTokens: 1120, providerCostUsd: 0.042 } });
    let release!: () => void;
    deductByTokens.mockImplementation(() => new Promise(resolve => { release = () => resolve({ charged: 9, remaining: 91 }); }));
    const pending = tool.execute({ editPrompt: 'Both cups together.' });
    await vi.waitFor(() => expect(deductByTokens).toHaveBeenCalledTimes(1));
    expect(ctx.generatedImages).toHaveLength(0);
    release();
    expect((await pending).success).toBe(true);
    expect(deductByTokens).toHaveBeenCalledWith('test-user', 'generate_image', 'google/gemini-3.1-flash-image-preview',
      600, 1120, undefined, undefined, undefined, 0.042);
    expect(deductCredits).not.toHaveBeenCalled();
    expect(ctx.generatedImages).toHaveLength(1);
  });

  it('does not swallow a Gemini accounting failure', async () => {
    const { tool, ctx, editImage, deductByTokens } = setup();
    editImage.mockResolvedValue({ success: true, image: 'data:image/jpeg;base64,YQ==', usedModel: 'gemini',
      usage: { modelId: 'google/gemini-3.1-flash-image-preview', inputTokens: 600, outputTokens: 1120 } });
    deductByTokens.mockRejectedValue(new Error('Ledger unavailable'));
    await expect(tool.execute({ editPrompt: 'Both cups.' })).rejects.toThrow('Ledger unavailable');
    expect(ctx.generatedImages).toHaveLength(0);
  });
});

describe('App Agent Qwen Spicy operation pricing', () => {
  it.each([
    { inputCount: 0, tool: 'generate_image_qwen-spicy', credits: 3 },
    { inputCount: 1, tool: 'edit_image_qwen-spicy', credits: 8 },
    { inputCount: 2, tool: 'edit_image_qwen-spicy-2', credits: 9 },
    { inputCount: 3, tool: 'edit_image_qwen-spicy-3', credits: 10 },
  ])('quotes and charges $tool for $inputCount inputs', async ({ inputCount, tool: toolName, credits }) => {
    const { tool, ctx, editImage, getToolPrice, requireCredits, deductCredits } = setup();
    ctx.preferredModel = 'qwen-spicy';
    if (inputCount > 0) ctx.currentImage = 'data:image/jpeg;base64,YQ==';
    ctx.referenceImages = Array.from({ length: Math.max(0, inputCount - 1) }, () => 'data:image/jpeg;base64,Yg==');
    getToolPrice.mockImplementation(async (name: string) => name === toolName ? { credits, isFree: false } : null);
    editImage.mockResolvedValue({ success: true, image: 'data:image/jpeg;base64,YQ==', usedModel: 'qwen-spicy', provider: 'mulerouter' });
    expect((await tool.execute({ editPrompt: 'Edit.' })).success).toBe(true);
    expect(getToolPrice).toHaveBeenCalledWith(toolName);
    expect(requireCredits).toHaveBeenCalledWith('test-user', credits);
    expect(deductCredits).toHaveBeenCalledWith('test-user', null, toolName, 'qwen-spicy', expect.any(Number));
  });
});

describe('App Agent Image 2.5 billing', () => {
  it('checks Flare pricing for a legacy Image 2 selection even on a subscription agent', async () => {
    const { tool, ctx, getTokenRate, editImage } = setup('codex-subscription');
    ctx.preferredModel = 'openai';
    getTokenRate.mockResolvedValue(null);
    expect(await tool.execute({ editPrompt: 'Product image' })).toMatchObject({ success: false, error: 'pricing_unavailable' });
    expect(getTokenRate).toHaveBeenCalledWith('gpt-image-2.5-flare');
    expect(editImage).not.toHaveBeenCalled();
  });
  it('rejects missing exact pricing before a paid call', async () => {
    const { tool, ctx, getTokenRate, editImage } = setup();
    ctx.preferredModel = 'gpt-image-2.5-flare';
    getTokenRate.mockResolvedValue(null);
    expect(await tool.execute({ editPrompt: 'A mug.' })).toMatchObject({ success: false, error: 'pricing_unavailable' });
    expect(editImage).not.toHaveBeenCalled();
  });
  it('passes exact provider cost into the ledger before publishing', async () => {
    const { tool, ctx, editImage, deductByTokens, deductCredits } = setup();
    ctx.preferredModel = 'gpt-image-2.5-flare';
    editImage.mockResolvedValue({ success: true, image: 'data:image/jpeg;base64,YQ==', usedModel: 'gpt-image-2.5-flare', provider: 'fal', usage: { modelId: 'gpt-image-2.5-flare', inputTokens: 0, outputTokens: 0, providerCostUsd: 0.0062 } });
    expect((await tool.execute({ editPrompt: 'Cup', background: 'transparent' })).success).toBe(true);
    expect(deductByTokens).toHaveBeenCalledWith('test-user', 'generate_image', 'gpt-image-2.5-flare', 0, 0, undefined, undefined, undefined, 0.0062);
    expect(deductCredits).not.toHaveBeenCalled();
  });
});


describe('Nano Banana 2.1 Agent execution and billing', () => {
  it('rejects missing catalog pricing before generation', async () => {
    const { tool, ctx, getTokenRate, editImage } = setup();
    ctx.preferredModel = 'gemini-2.1';
    getTokenRate.mockResolvedValue(null);
    expect(await tool.execute({ editPrompt: 'Product' })).toMatchObject({ success: false, error: 'pricing_unavailable' });
    expect(getTokenRate).toHaveBeenCalledWith('google/gemini-nano-banana-2.1');
    expect(editImage).not.toHaveBeenCalled();
  });
  it('passes resolution and awaits actual supplier-cost accounting before publishing', async () => {
    const { tool, ctx, getTokenRate, editImage, deductByTokens, deductCredits, requireCredits } = setup();
    ctx.preferredModel = 'gemini-2.1';
    getTokenRate.mockResolvedValue({ model_id: 'google/gemini-nano-banana-2.1', markup: 2, is_active: true });
    editImage.mockResolvedValue({ success: true, image: 'data:image/png;base64,YQ==', usedModel: 'gemini-2.1', provider: 'openrouter', usage: { modelId: 'google/gemini-nano-banana-2.1', inputTokens: 100, outputTokens: 2520, providerCostUsd: 0.0768 } });
    expect((await tool.execute({ editPrompt: 'Product', imageResolution: '4K' })).success).toBe(true);
    expect(editImage.mock.calls[0][0]).toMatchObject({ preferredModel: 'gemini-2.1', imageResolution: '4K' });
    expect(requireCredits).toHaveBeenCalledWith('test-user', 16);
    expect(deductByTokens).toHaveBeenCalledWith('test-user', 'generate_image', 'google/gemini-nano-banana-2.1', 100, 2520, undefined, undefined, undefined, 0.0768);
    expect(deductCredits).not.toHaveBeenCalled();
    expect(ctx.generatedImages).toHaveLength(1);
  });
});


it('preflights the default Nano Banana 2.1 route and accepts its resolution', async () => {
  const {tool,ctx,getTokenRate,requireCredits,editImage}=setup();
  ctx.preferredModel=undefined;
  getTokenRate.mockResolvedValue({model_id:'google/gemini-nano-banana-2.1',markup:2,is_active:true});
  await tool.execute({editPrompt:'A forest scene',imageResolution:'2K'});
  expect(getTokenRate).toHaveBeenCalledWith('google/gemini-nano-banana-2.1');
  expect(requireCredits).toHaveBeenCalledWith('test-user',11);
  expect(editImage).toHaveBeenCalledWith(expect.objectContaining({preferredModel:undefined,imageResolution:'2K'}),expect.anything());
});


describe('Image capability Agent integration cases', () => {
  it('R01/R17: Auto quotes Flare and delivers once', async () => {
    const { tool, ctx, getTokenRate, requireCredits, editImage } = setup();
    ctx.preferredModel = undefined;
    editImage.mockResolvedValue({ success: true, image: 'image', usedModel: 'gpt-image-2.5-flare' });
    expect((await tool.execute({ editPrompt: 'A portrait.' })).success).toBe(true);
    expect(getTokenRate).toHaveBeenCalledWith('gpt-image-2.5-flare');
    expect(requireCredits).toHaveBeenCalledWith('test-user', 5);
    expect(editImage).toHaveBeenCalledTimes(1);
  });
  it('R02/R17: original 8:1 banner Auto request quotes Nano before generation', async () => {
    const { tool, ctx, getTokenRate, editImage } = setup();
    ctx.preferredModel = undefined;
    ctx.snapshotImages = ['source-V'];
    getTokenRate.mockResolvedValue({ model_id: 'google/gemini-nano-banana-2.1', markup: 2 });
    await tool.execute({ editPrompt: '用参考图里的 V 生成一张超宽横幅，比例严格 8:1。', aspectRatio: '8:1', media_index: 1 });
    expect(getTokenRate).toHaveBeenCalledWith('google/gemini-nano-banana-2.1');
    expect(editImage).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: '8:1', preferredModel: undefined }), expect.objectContaining({ currentImage: 'source-V' }));
    expect(editImage).toHaveBeenCalledTimes(1);
  });
  it('R14/R06: Agent NSFW flag overrides app preference and stays active', async () => {
    const { tool, ctx, getToolPrice, editImage } = setup();
    ctx.preferredModel = 'gpt-image-2.5-flare';
    await tool.execute({ editPrompt: 'Sensitive artwork.', isNsfw: true });
    expect(ctx.isNsfw).toBe(true);
    expect(getToolPrice).toHaveBeenCalledWith('generate_image_qwen-spicy');
    expect(editImage.mock.calls[0][0]).toMatchObject({ isNsfw: true });
    await tool.execute({ editPrompt: 'Add lighting.', isNsfw: false });
    expect(editImage.mock.calls[1][0]).toMatchObject({ isNsfw: true });
  });
  it('R13/R14/R17: locked Flare incompatible with 8:1 returns structured alternatives without billing', async () => {
    const { tool, ctx, editImage, getTokenRate, requireCredits, deductCredits } = setup();
    ctx.preferredModel = 'gpt-image-2.5-flare';
    const result = await tool.execute({ editPrompt: 'Banner.', model: 'gemini-2.1', aspectRatio: '8:1', imageResolution: '4K' });
    expect(result).toMatchObject({ success: false, error: 'unsupported_image_capability', compatibleModels: ['gemini-2.1'] });
    expect(editImage).not.toHaveBeenCalled();
    expect(getTokenRate).not.toHaveBeenCalled();
    expect(requireCredits).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
  });
  it('R15: media index zero remains text-to-image, uploaded and timeline references are counted', async () => {
    const { tool, ctx, editImage, getTokenRate } = setup();
    ctx.preferredModel = undefined;
    await tool.execute({ editPrompt: 'Draw.', media_index: 0 });
    expect(editImage.mock.calls[0][1].currentImage).toBeUndefined();
    ctx.preferredModel = 'gemini-2.1';
    ctx.snapshotImages = ['base', 'timeline-reference'];
    ctx.referenceImages = Array.from({ length: 13 }, () => 'uploaded-reference');
    getTokenRate.mockClear();
    const result = await tool.execute({ editPrompt: 'Combine.', media_index: 1, reference_media_indices: [2] });
    expect(result).toMatchObject({ success: false, error: 'unsupported_image_capability' });
    expect(getTokenRate).not.toHaveBeenCalled();
    expect(editImage).toHaveBeenCalledTimes(1);
  });
});
