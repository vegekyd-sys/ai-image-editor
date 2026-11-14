import { describe, expect, it, vi } from 'vitest';
import { resolveAgentTurnInput } from '@/lib/agent-turn-input';

function setup(rows: Array<{ id: string; image_url: string }>) {
  const eq = vi.fn(), filter = vi.fn();
  const query = { select: () => query, eq: (...args: unknown[]) => { eq(...args); return query; }, in: (...args: unknown[]) => { filter(...args); return query; }, limit: async () => ({ data: rows }) };
  const from = vi.fn(() => query);
  return { supabase: { from } as never, from, eq, filter };
}
describe('media-only Agent turns', () => {
  it.each(['zh', 'zh-Hant', 'ja', 'en'] as const)('accepts verified newly uploaded images without inventing a user edit in %s', async locale => {
    const db = setup([{ id: 'new-image', image_url: 'https://cdn.makaron.app/source.png' }]);
    const result = await resolveAgentTurnInput({ ...db, prompt: '', locale, projectId: 'owned-project', turnMediaSnapshotIds: ['new-image'] });
    expect(result.mediaOnly).toBe(true);
    expect(result.prompt.length).toBeGreaterThan(30);
    expect(result.imageUrls).toEqual(['https://cdn.makaron.app/source.png']);
    expect(db.eq).toHaveBeenCalledWith('project_id', 'owned-project');
    expect(db.filter).toHaveBeenCalledWith('id', ['new-image']);
  });
  it('keeps normal text exact and leaves ordinary request admission unchanged', async () => {
    const db = setup([]);
    expect(await resolveAgentTurnInput({ ...db, prompt: '  把帽子放大  ', locale: 'zh', projectId: 'owned' })).toMatchObject({ prompt: '  把帽子放大  ', mediaOnly: false });
    expect(db.from).not.toHaveBeenCalled();
  });
  it('rejects empty, deleted or foreign-project media instead of trusting a claimed attachment count', async () => {
    const db = setup([]);
    for (const ids of [undefined, [], ['missing']]) {
      expect(await resolveAgentTurnInput({ ...db, prompt: '  ', locale: 'zh', projectId: 'owned', turnMediaSnapshotIds: ids })).toMatchObject({ prompt: '', mediaOnly: false });
    }
  });
});
