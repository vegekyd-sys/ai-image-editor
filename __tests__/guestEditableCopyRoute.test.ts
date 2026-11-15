import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({
  user: { id: 'visitor' } as { id: string } | null,
  source: { user_id: 'author', is_public: true, title: 'Source', timeline_version: 2 },
  insert: vi.fn(), upload: vi.fn(), remove: vi.fn(), readFile: vi.fn(),
  snapshots: [{ id: 'source-snapshot', image_url: '/poster.png', sort_order: 0, type: 'design', design_path: 'code/source.json', video_meta: null, description: null, metadata: null }],
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user } }) },
  from: (table: string) => ({ insert: (rows: unknown) => state.insert(table, rows) }),
  storage: { from: () => ({ upload: state.upload, remove: state.remove }) },
}) }));
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({ from: (table: string) => {
  const query = { select: () => query, eq: () => query,
    maybeSingle: async () => ({ data: state.source }),
    order: async () => ({ data: table === 'project_animations' ? [{ video_url: '/finished.mp4', status: 'completed', prompt: '', snapshot_urls: [] }] : state.snapshots }),
  }; return query;
} }) }));
vi.mock('@/lib/workspace', () => ({ readFile: state.readFile }));
import { POST } from '@/app/api/projects/[id]/copy/route';
const code = 'function Scene() { return null; }';
function copy(designs: unknown = {}) {
  return POST(new NextRequest('http://localhost/api/projects/source/copy', { method: 'POST', body: JSON.stringify({ designs }) }), { params: Promise.resolve({ id: 'source' }) });
}
beforeEach(() => {
  vi.clearAllMocks(); state.user = { id: 'visitor' }; state.source.is_public = true; state.source.timeline_version = 2;
  state.insert.mockResolvedValue({ error: null }); state.upload.mockResolvedValue({ error: null });
  state.readFile.mockResolvedValue({ content: JSON.stringify({ code, width: 800, height: 600, props: { title: 'Original' } }) });
});
describe('public project copy access and isolation', () => {
  it('requires authentication before reading or writing artifacts', async () => {
    state.user = null;
    expect((await copy()).status).toBe(401);
    expect(state.readFile).not.toHaveBeenCalled(); expect(state.insert).not.toHaveBeenCalled();
  });
  it('denies another user private source before workspace reads', async () => {
    state.source.is_public = false;
    expect((await copy()).status).toBe(404);
    expect(state.readFile).not.toHaveBeenCalled(); expect(state.upload).not.toHaveBeenCalled();
  });
  it('rejects snapshot IDs that do not belong to the source', async () => {
    expect((await copy({ foreign: { code } })).status).toBe(400);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it('rejects replacement code instead of accepting a stale or forged source', async () => {
    expect((await copy({ 'source-snapshot': { code: 'other code' } })).status).toBe(409);
    expect(state.upload).not.toHaveBeenCalled(); expect(state.insert).not.toHaveBeenCalled();
  });
  it('preserves completed legacy videos with new identities and no active jobs', async () => {
    state.source.timeline_version = 1;
    const response = await copy();
    expect(response.status).toBe(200);
    const { projectId } = await response.json();
    expect(state.insert.mock.calls[2]).toEqual(['project_animations', [expect.objectContaining({ project_id: projectId, video_url: '/finished.mp4', piapi_task_id: null, status: 'completed' })]]);
  });
  it('creates private visitor-owned rows and separate workspace files without source writes', async () => {
    const response = await copy({ 'source-snapshot': { code, props: { title: 'Guest', _pos_title: { x: 12, y: 10 } } } });
    expect(response.status).toBe(200);
    const { projectId } = await response.json();
    expect(projectId).not.toBe('source');
    expect(state.insert.mock.calls[0]).toEqual(['projects', expect.objectContaining({ id: projectId, user_id: 'visitor', is_public: false })]);
    expect(state.insert.mock.calls[1][1][0]).toMatchObject({ project_id: projectId, message_id: null });
    const [path, content] = state.upload.mock.calls[0];
    expect(path).toMatch(/^visitor\/workspace\/code\//); expect(path).not.toContain('source.json');
    expect(JSON.parse(content).props).toMatchObject({ title: 'Guest', _pos_title: { x: 12, y: 10 } });
    expect(state.remove).not.toHaveBeenCalled();
  });
});
