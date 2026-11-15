// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
const h = vi.hoisted(() => ({ files: new Map<string, string>(), tables: new Map<string, Map<string, any>>(), debits: new Map<string, any>(), submit: vi.fn(), query: vi.fn(), read: vi.fn(), rate: vi.fn(), rpc: vi.fn(), render: vi.fn(), fit: vi.fn(), faces: vi.fn(), failPublish: false }));
function query(table: string) {
  let op = 'select', value: any, filters: [string, any][] = [];
  const rows = h.tables.get(table)!;
  const exec = () => {
    const matches = [...rows.values()].filter(row => filters.every(([key, val]) => row[key] === val));
    if (op === 'insert' || op === 'upsert') {
      const key = table === 'workspace_files' ? `${value.user_id}:${value.path}` : value.id;
      if (op === 'insert' && rows.has(key)) return { data: null, error: { code: '23505' } };
      if (table === 'snapshots' && h.failPublish) return { data: null, error: { code: 'failure' } };
      rows.set(key, { ...rows.get(key), ...value }); return { data: [value], error: null };
    }
    if (op === 'update') matches.forEach(row => Object.assign(row, value));
    if (op === 'delete') for (const [key, row] of rows) if (matches.includes(row)) rows.delete(key);
    return { data: matches, error: null };
  };
  const chain: any = { select: () => chain, eq: (key: string, val: any) => { filters.push([key, val]); return chain; },
    insert: (val: any) => { op = 'insert'; value = val; return chain; }, upsert: (val: any) => { op = 'upsert'; value = val; return chain; },
    update: (val: any) => { op = 'update'; value = val; return chain; }, delete: () => { op = 'delete'; return chain; },
    maybeSingle: async () => { const r = exec(); return { ...r, data: r.data?.[0] ?? null }; },
    then: (resolve: any, reject: any) => Promise.resolve(exec()).then(resolve, reject) };
  return chain;
}
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({ from: query, rpc: h.rpc, storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.com/${path}` } }) }) } }) }));
vi.mock('@/lib/workspace', () => ({ readFile: async (path: string) => h.files.has(path) ? { content: h.files.get(path) } : null,
  writeFile: async (path: string, body: string, _admin: unknown, userId: string) => { h.files.set(path, body); h.tables.get('workspace_files')!.set(`${userId}:${path}`, { user_id: userId, path, storage_url: `https://example.com/${path}`, updated_at: new Date().toISOString() }); return { success: true, storageUrl: `https://example.com/${path}` }; } }));
vi.mock('@/lib/provider-image-preflight', () => ({ readProviderImage: h.read }));
vi.mock('@/lib/layerize-provider', async (original) => ({ ...await original<any>(), submitLayerize: h.submit, queryLayerize: h.query }));
vi.mock('@/lib/billing/token-rates', async original => ({ ...await original<any>(), getTokenRate: h.rate }));
vi.mock('@/lib/billing/credits', () => ({ isBillingEnabled: async () => true, requireCredits: async () => ({ ok: true, balance: 1000 }) }));
vi.mock('@/lib/remotion-server', () => ({ renderDesignFrame: h.render }));
vi.mock('@/lib/layerize-text-fit', () => ({layerizeMatchingFaces:h.faces,fitLayerizeText:h.fit}));
import { startLayerize, getLayerize } from '@/lib/layerize';
import { LayerizeProviderError } from '@/lib/layerize-provider';
const projectId = '11111111-1111-4111-8111-111111111111', jobId = '22222222-2222-4222-8222-222222222222';
const owner = { projectId, userId: 'owner', origin: 'https://www.makaron.app', attribution: { source: 'cli' as const, projectId } };
const input = { imageUrl: 'https://example.com/source.png', maxOutputs: 6, quality: '1K' as const };
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => new Response(h.files.get(url.pathname.split('/workspace/')[1]) || '{}')));
  vi.stubEnv('EVOLINK_API_KEY', 'test-private-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-signing-key');
  h.files.clear(); h.tables.clear(); h.debits.clear(); h.failPublish = false;
  for (const table of ['projects', 'workspace_files', 'snapshots', 'mcp_video_reservations']) h.tables.set(table, new Map());
  h.tables.get('projects')!.set(projectId, { id: projectId, user_id: 'owner' });
  h.submit.mockReset().mockResolvedValue({ id: 'task-original', model: 'doubao-seedream-5.5-layerize', status: 'processing' });
  h.query.mockReset().mockResolvedValue({ id: 'task-original', model: 'doubao-seedream-5.5-layerize', status: 'completed', result_data: [
    { z_index: 0, url: 'base', background: 'opaque' }, { z_index: 1, url: 'layer', background: 'transparent', bounding_box: { absolute: [5, 8, 25, 28] } },
  ] });
  const base = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const layer = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#ff000000' } }).png().toBuffer();
  h.read.mockReset().mockImplementation(async (url: string) => url === 'layer' ? layer : base);
  h.rate.mockReset().mockResolvedValue({ model_id: 'seedream-5.5-layerize', markup: 2 });
  h.render.mockReset().mockResolvedValue(Buffer.from('poster'));
  h.faces.mockReset().mockResolvedValue([]); h.fit.mockReset().mockResolvedValue(null);
  h.rpc.mockReset().mockImplementation(async (name, args) => {
    if (name === 'reserve_mcp_video' && !h.debits.has(args.p_id)) h.debits.set(args.p_id, args);
    return { data: name === 'next_sort_order' ? 3 : {}, error: null };
  });
});
describe('Layerize lifecycle and billing ownership', () => {
  it('one paid POST and one actual-output debit across duplicate submissions and concurrent polls', async () => {
    await startLayerize(owner, jobId, input); await startLayerize(owner, jobId, input);
    await Promise.all([getLayerize(owner, jobId), getLayerize(owner, jobId)]);
    const result = await getLayerize(owner, jobId);
    expect(result).toMatchObject({ status: 'completed', credits: 8, snapshotId: jobId, projectUrl: `https://www.makaron.app/projects/${projectId}?snapshot=${jobId}` });
    expect(h.submit).toHaveBeenCalledTimes(1); expect(h.render).not.toHaveBeenCalled();
    expect(h.debits.size).toBe(1);
    expect(h.debits.get(jobId)).toMatchObject({ p_model: 'seedream-5.5-layerize', p_source: 'cli', p_project_id: projectId, p_quote: { credits: 8, supplierCostUsd: .0384 } });
    expect(h.rpc.mock.calls.filter(([name]) => name === 'finish_mcp_video_submission').every(([, args]) => args.p_state === 'completed')).toBe(true);
    expect(h.tables.get('snapshots')!.get(jobId).image_url).toContain('/poster.jpg');
  });
  it('completed query preserves edits and does not rerender or bill again', async () => {
    await startLayerize(owner, jobId, input); const first = await getLayerize(owner, jobId);
    const path = first.designPath!; const design = JSON.parse(h.files.get(path)!);
    design.props._pos_layer_1 = { x: 50, y: 30 }; h.files.set(path, JSON.stringify(design));
    const result = await getLayerize(owner, jobId);
    expect(result.design?.props?._pos_layer_1).toEqual({ x: 50, y: 30 });
    expect(h.render).not.toHaveBeenCalled(); expect(h.debits.size).toBe(1);
  });
  it('failed or uncertain provider jobs never auto resubmit or debit', async () => {
    h.submit.mockRejectedValue(new LayerizeProviderError('unknown', true));
    expect((await startLayerize(owner, jobId, input)).status).toBe('uncertain');
    await startLayerize(owner, jobId, input); await getLayerize(owner, jobId);
    expect(h.submit).toHaveBeenCalledTimes(1); expect(h.debits.size).toBe(0);
  });
  it('confirmed failed task has no product charge', async () => {
    await startLayerize(owner, jobId, input); h.query.mockResolvedValue({ id: 'task-original', status: 'failed' });
    expect((await getLayerize(owner, jobId)).status).toBe('failed'); expect(h.debits.size).toBe(0);
  });
  it('ends a completed background-only result without polling, publishing or charging again', async () => {
    await startLayerize(owner, jobId, input);
    h.query.mockResolvedValue({ id: 'task-original', status: 'completed', result_data: [
      { z_index: 0, url: 'base', background: 'opaque' },
    ] });
    const first = await getLayerize(owner, jobId);
    expect(first).toMatchObject({ status: 'failed', taskId: 'task-original' });
    expect(first.message).toContain('No editable design was published');
    expect((await getLayerize(owner, jobId)).status).toBe('failed');
    expect((await startLayerize(owner, jobId, input)).status).toBe('failed');
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.debits.size).toBe(0);
    expect(h.tables.get('snapshots')!.size).toBe(0);
  });
  it('rejects foreign owners, parameter conflicts and missing pricing before any new POST', async () => {
    await expect(startLayerize({ ...owner, userId: 'foreign' }, jobId, input)).rejects.toThrow('not accessible');
    h.rate.mockResolvedValue(null);
    await expect(startLayerize(owner, jobId, input)).rejects.toThrow('pricing'); expect(h.submit).not.toHaveBeenCalled();
    h.rate.mockResolvedValue({ model_id: 'seedream-5.5-layerize', markup: 2 });
    await startLayerize(owner, jobId, input);
    await expect(startLayerize(owner, jobId, { ...input, maxOutputs: 7 })).rejects.toThrow('different parameters');
    expect(h.submit).toHaveBeenCalledTimes(1);
  });
  it('publication failure releases lease for recovery, keeps provider receipt and idempotent debit', async () => {
    await startLayerize(owner, jobId, input); h.failPublish = true;
    expect((await getLayerize(owner, jobId)).status).toBe('processing');
    h.failPublish = false;
    expect((await getLayerize(owner, jobId)).status).toBe('completed');
    expect(h.submit).toHaveBeenCalledTimes(1); expect(h.debits.size).toBe(1);
  });
  it('unknown job does not look like an indefinitely preparing job', async () => {
    await expect(getLayerize(owner, jobId)).rejects.toThrow('not found');
  });
  it('rejects edited workspace receipts before trusting provider IDs or markup', async () => {
    await startLayerize(owner, jobId, input);
    const path = `${projectId}/layerize/${jobId}/job.json`;
    const tampered = JSON.parse(h.files.get(path)!); tampered.markup = .001;
    h.files.set(path, JSON.stringify(tampered));
    await expect(getLayerize(owner, jobId)).rejects.toThrow('integrity check failed');
    expect(h.query).not.toHaveBeenCalled(); expect(h.debits.size).toBe(0);
  });
  it('does not trust an unrelated user-created snapshot as proof of billing', async () => {
    await startLayerize(owner, jobId, input);
    h.tables.get('snapshots')!.set(jobId, { id: jobId, project_id: projectId, design_path: 'code/unrelated.json' });
    const result = await getLayerize(owner, jobId);
    expect(result.status).toBe('processing'); expect(result.message).toContain('no matching settled task');
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it('refuses to submit a settled ID when its workspace receipt was removed', async () => {
    h.tables.get('mcp_video_reservations')!.set(jobId, { id: jobId });
    await expect(startLayerize(owner, jobId, input)).rejects.toThrow('receipt reconciliation');
    expect(h.submit).not.toHaveBeenCalled();
  });
  it('a late query error cannot regress an already completed receipt', async () => {
    await startLayerize(owner, jobId, input);
    const completedTask = await h.query(); let rejectLate: (error: Error) => void = () => {};
    let started = false;
    h.query.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLate = reject; started = true; })).mockResolvedValue(completedTask);
    const late = getLayerize(owner, jobId); await vi.waitFor(() => expect(started).toBe(true));
    expect((await getLayerize(owner, jobId)).status).toBe('completed');
    rejectLate(new Error('late transport failure'));
    expect((await late).status).toBe('completed');
    expect((await getLayerize(owner, jobId)).status).toBe('completed');
    expect(h.debits.size).toBe(1);
  });

});
it('publishes editable OCR text with original glyph pixels without waiting for a font render', async () => {
  const pixels = await sharp({create:{width:20,height:20,channels:4,background:'#ffffff00'}}).composite([{input:await sharp({create:{width:14,height:14,channels:4,background:'#ffffff'}}).png().toBuffer(),left:3,top:3}]).png().toBuffer();
  const base = await sharp({create:{width:100,height:80,channels:3,background:'#ffffff'}}).png().toBuffer();
  h.read.mockImplementation(async (url: string) => url === 'layer' ? pixels : base);
  const task = await h.query();
  task.result_data[1].text_recognition = {lines:[{bounding_box:{absolute:[5,8,25,28]},runs:[{text:'HELLO',style:{similar_font_family:'Arial',foreground_color:'#000000'}}]}]};
  h.query.mockReset().mockResolvedValue(task);
  await startLayerize(owner, jobId, {...input,editableText:true});
  const result=await getLayerize(owner,jobId);
  expect(result.status, result.message).toBe('completed'); expect(h.render).not.toHaveBeenCalled();
  expect(result.design?.editables?.some(field=>field.type==='text')).toBe(true);
  expect(h.faces).not.toHaveBeenCalled(); expect(h.fit).not.toHaveBeenCalled();
  expect((result.design?.props?._layerizeTextFonts as any)?.status).toBe('pending');
});
