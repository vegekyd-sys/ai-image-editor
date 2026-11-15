import { afterEach, describe, expect, it, vi } from 'vitest';
import * as workspace from '@/lib/workspace';

function fixture(read: () => Promise<{ data: unknown[] | null; error: unknown }>) {
  const scopes: string[] = [];
  const patterns: string[] = [];
  const order = vi.fn(read);
  const upload = vi.fn();
  const upsert = vi.fn();
  const client = {
    from: () => {
      const query = { select: () => query, or: (scope: string) => { scopes.push(scope); return query; },
        like: (_field: string, pattern: string) => { patterns.push(pattern); return query; }, order, upsert };
      return query;
    },
    storage: { from: () => ({ upload }) },
  };
  return { client, scopes, patterns, order, upload, upsert };
}

const row = { path: 'skills/recovered-list/SKILL.md', content_type: 'text/markdown', size_bytes: 100,
  storage_url: 'https://example.com/recovered-list.md', updated_at: '2026-11-15T00:00:00Z' };
const skillMd = '---\nname: recovered-list\ndescription: A user-installed skill.\n---\nDo the selected task.';

afterEach(() => { workspace.clearWorkspaceCache(); vi.unstubAllGlobals(); });

describe('workspace list failure recovery', () => {
  it('retries a statement timeout once while preserving owner, globals and path scope', async () => {
    let attempt = 0;
    const f = fixture(async () => attempt++ === 0
      ? { data: null, error: { code: '57014' } }
      : { data: [row], error: null });
    const files = await workspace.listFiles('skills/*/SKILL.md', f.client, 'list-owner');
    expect(f.order).toHaveBeenCalledTimes(2);
    expect(f.scopes).toEqual(['user_id.eq.list-owner,user_id.is.null', 'user_id.eq.list-owner,user_id.is.null']);
    expect(f.patterns).toEqual(['skills/%/SKILL.md', 'skills/%/SKILL.md']);
    expect(files).toContainEqual(expect.objectContaining({ path: row.path }));
  });

  it('does not cache a failed read as an empty workspace', async () => {
    let unavailable = true;
    const f = fixture(async () => unavailable
      ? { data: null, error: { code: '57014', message: 'statement timeout' } }
      : { data: [row], error: null });
    await expect(workspace.listFiles('skills/*/SKILL.md', f.client, 'list-owner'))
      .rejects.toMatchObject({ code: 'WORKSPACE_LIST_UNAVAILABLE' });
    expect(f.order).toHaveBeenCalledTimes(2);
    unavailable = false;
    expect(await workspace.listFiles('skills/*/SKILL.md', f.client, 'list-owner'))
      .toContainEqual(expect.objectContaining({ path: row.path }));
    expect(f.order).toHaveBeenCalledTimes(3);
  });

  it('does not return or cache a built-in-only skills catalog after a database failure', async () => {
    let unavailable = true;
    const f = fixture(async () => unavailable
      ? { data: null, error: { code: '57014' } }
      : { data: [row], error: null });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(skillMd)));
    await expect(workspace.getAllSkills(f.client, 'list-owner')).rejects.toMatchObject({ code: 'WORKSPACE_LIST_UNAVAILABLE' });
    unavailable = false;
    expect((await workspace.getAllSkills(f.client, 'list-owner')).some(s => s.name === 'recovered-list')).toBe(true);
  });

  it('stops skill installation before any write when name discovery fails', async () => {
    const f = fixture(async () => ({ data: null, error: { code: '57014' } }));
    await expect(workspace.installSkill({ skillMd, assets: [], supabase: f.client, userId: 'list-owner' }))
      .rejects.toMatchObject({ code: 'WORKSPACE_LIST_UNAVAILABLE' });
    expect(f.order).toHaveBeenCalledTimes(2);
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it('does not retry permission errors', async () => {
    const f = fixture(async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }));
    await expect(workspace.getAllSkills(f.client, 'list-owner')).rejects.toMatchObject({ code: 'WORKSPACE_LIST_UNAVAILABLE' });
    expect(f.order).toHaveBeenCalledTimes(1);
  });

  it('retries a thrown network failure but still bounds attempts', async () => {
    const f = fixture(async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }); });
    await expect(workspace.getAllSkills(f.client, 'list-owner')).rejects.toMatchObject({ code: 'WORKSPACE_LIST_UNAVAILABLE' });
    expect(f.order).toHaveBeenCalledTimes(2);
  });

  it('keeps a genuinely empty user workspace valid', async () => {
    const f = fixture(async () => ({ data: [], error: null }));
    expect((await workspace.getAllSkills(f.client, 'list-owner')).length).toBeGreaterThan(0);
    expect(f.order).toHaveBeenCalledTimes(1);
  });
});
