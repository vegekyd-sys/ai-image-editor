// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { IMAGE_MODEL_IDS } from '@/lib/models/types';
import { normalizeGenerateImageMediaIndex } from '@/lib/generate-image-input';

// Execute the actual factory in isolation: importing all unrelated Agent tools
// would also boot their SDKs and load every raw Markdown prompt in this test.
const source = readFileSync('src/lib/agent-tools.ts', 'utf8');
const parsed = ts.createSourceFile('agent-tools.ts', source, ts.ScriptTarget.Latest, true);
const factory = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createGenerateImageTool');
if (!factory) throw new Error('Missing generate_image factory');
const code = ts.transpileModule(factory.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function setup() {
  const editImage = vi.fn().mockResolvedValue({ success: true, image: 'data:image/jpeg;base64,YQ==', usedModel: 'wan2.7-image', provider: 'dashscope' });
  const deductByTokens = vi.fn().mockResolvedValue({ charged: 9, remaining: 91 });
  const requireCredits = vi.fn().mockResolvedValue({ ok: true, balance: 100 });
  const deductCredits = vi.fn().mockResolvedValue({ charged: 6, remaining: 94 });
  const getToolPrice = vi.fn().mockResolvedValue({ credits: 6, isFree: false });
  const isBillingEnabled = vi.fn().mockResolvedValue(true);
  const ctx = { preferredModel: 'wan2.7-image', userId: 'test-user', projectId: 'test-project', currentImage: '', snapshotImages: [] as string[], generatedImages: [] as string[], lastUsedModel: undefined };
  const context = vm.createContext({
    tool: (definition: unknown) => definition, z, IMAGE_MODEL_IDS,
    generateImageToolPrompt: '', normalizeGenerateImageMediaIndex,
    validateImageIndex: vi.fn(), getToolPrice, isBillingEnabled,
    resolveToolName: (_name: string, model: string) => `edit_image_${model}`,
    editImage, requireCredits, deductCredits, refreshSnapshotUrls: vi.fn(), console,
    require: (name: string) => {
      if (name === './billing/credits') return { deductByTokens };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const create = vm.runInContext(`${code}\ncreateGenerateImageTool`, context);
  return { tool: create({ ctx, runtime: { spec: { provider: 'azure' } } }), ctx, editImage, requireCredits, deductCredits, deductByTokens, getToolPrice, isBillingEnabled };
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
