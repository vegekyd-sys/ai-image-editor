// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
const state = vi.hoisted(() => ({ backend: vi.fn(), debit: vi.fn(), read: vi.fn(), write: vi.fn(), latest: {} as any, output: '' }));
vi.mock('@/lib/models', () => ({ getBackend: state.backend }));
vi.mock('@/lib/workspace', async importOriginal => ({ ...await importOriginal<any>(), readFile: state.read, writeFile: state.write }));
vi.mock('@/lib/billing/credits', () => ({ isBillingEnabled: async () => false, deductByTokens: state.debit, deductCredits: state.debit }));
import { createTools, type AgentContext } from '@/lib/agent-tools';
const data = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
const saved = new Map<string, string | Buffer>();
let ctx: AgentContext;
beforeEach(async () => {
  vi.clearAllMocks(); saved.clear();
  const original = data(await sharp({ create: { width: 30, height: 40, channels: 4, background: '#00224488' } }).png().toBuffer());
  state.output = data(await sharp({ create: { width: 30, height: 40, channels: 4, background: '#ff0066ff' } }).png().toBuffer());
  state.latest = { code: 'original', width: 600, height: 900, editables: [{ id: 'baby', type: 'image', propKey: 'asset', label: 'Baby' }], props: { asset: original, _pos_baby: { x: 15, y: 31 }, _scale_baby: { w: .6, h: .6 }, other: 'untouched' } };
  state.read.mockImplementation(async (path: string) => ({ content: path === 'code/source.json' ? JSON.stringify(state.latest) : saved.get(path) }));
  state.write.mockImplementation(async (path: string, content: string | Buffer) => { saved.set(path, content); return { success: true, storageUrl: `https://example.com/${path}` }; });
  state.backend.mockImplementation(id => ({ id, canHandle: () => true, generate: async () => ({ image: state.output, provider: 'test', usage: { modelId: id, inputTokens: 1, outputTokens: 2, providerCostUsd: .01 } }) }));
  ctx = { projectId: 'owned-project', userId: 'owner', currentImage: '', generatedImages: [], snapshotImages: [], explicitMediaIndices: [], currentSnapshotIndex: 0, selectedElement: { snapshotId: 'source', fieldId: 'baby' },
    supabase: { from: (table: string) => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'projects' ? { user_id: 'owner' } : { design_path: 'code/source.json' } }) }; return query; } } };
});
const tools = () => createTools(ctx, { spec: { provider: 'test', supportsImageInput: true } } as any);
const call = async (name: string, args: any = {}) => (tools()[name].execute as any)(args, {});
it('moves/scales selected elements without submitting or charging an image', async () => {
  const result = await call('edit_element', { operation: { kind: 'transform', dx: 20, scaleX: 2 } });
  expect(result.success).toBe(true);
  const design = JSON.parse(saved.get(result.design_path) as string);
  expect(design.props).toMatchObject({ _pos_baby: { x: 35, y: 31 }, _scale_baby: { w: 1.2, h: 1.2 }, other: 'untouched' });
  expect(state.backend).not.toHaveBeenCalled(); expect(state.debit).not.toHaveBeenCalled();
});
it('rejects missing or uninspected selection before billing/provider submission', async () => {
  expect((await call('edit_element', { operation: { kind: 'content', prompt: 'bigger hat' } })).success).toBe(false);
  ctx.selectedElement = undefined;
  expect((await call('edit_element', { operation: { kind: 'transform', dx: 10 } })).success).toBe(false);
  expect(state.backend).not.toHaveBeenCalled(); expect(state.debit).not.toHaveBeenCalled();
});
it('sends the original asset as an actual provider input and retains GUI changes made during generation', async () => {
  const original = state.latest.props.asset;
  await call('inspect_element');
  const provider = vi.fn(async (request: any) => {
    expect(request.references.map((r: any) => r.url)).toContain(original);
    expect(request.references[0].url).toContain('-input.png');
    state.latest.props._pos_baby = { x: 99, y: -14 };
    state.latest.props._scale_baby = { w: .3, h: .4 };
    return { image: state.output, provider: 'test', usage: { modelId: 'gpt-image-2.6-flare', inputTokens: 1, outputTokens: 2, providerCostUsd: .01 } };
  });
  state.backend.mockImplementation(id => ({ id, canHandle: () => true, generate: provider }));
  const result = await call('edit_element', { operation: { kind: 'content', prompt: 'bigger hat', region: { x: 1, y: 1, width: 20, height: 20 } } });
  expect(result.success).toBe(true); expect(provider).toHaveBeenCalledOnce(); expect(state.debit).toHaveBeenCalledOnce();
  const design = JSON.parse(saved.get(result.design_path) as string);
  expect(design.props).toMatchObject({ _pos_baby: { x: 99, y: -14 }, _scale_baby: { w: .3, h: .4 }, other: 'untouched' });
  expect(design.props.asset).toMatch(/element-edits/);
  expect(design.props._editHistory.entries.at(-1).kind).toBe('media');
  expect(ctx.generatedImages).toHaveLength(0); // A private replacement never pollutes the timeline.
});
