import { afterEach, expect, it, vi } from 'vitest';
import { publishDesignSnapshot } from '@/lib/publish-design';
import * as workspace from '@/lib/workspace';
afterEach(() => vi.restoreAllMocks());
it('does not overwrite GUI properties or established message IDs on prepublished event replay', async () => {
  const write = vi.spyOn(workspace, 'writeFile'); const update = vi.fn();
  const eq = vi.fn().mockReturnThis();
  const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { project_id: 'project', design_path: 'code/stable.json', image_url: 'https://example.com/poster.jpg', message_id: 'original-message', sort_order: 8 } }) }) }), update, eq }) };
  const result = await publishDesignSnapshot({ supabase: client as never, userId: 'owner', projectId: 'project', snapshotId: 'stable', design: { code: 'old props', width: 100, height: 100 }, messageId: 'new-message', preserveExisting: true });
  expect(write).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  expect(result).toMatchObject({ snapshotId: 'stable', designPath: 'code/stable.json' });
});
it('links only an unassigned message on a prepublished snapshot, without rewriting its design', async () => {
  const write = vi.spyOn(workspace, 'writeFile'); const eq = vi.fn().mockReturnThis(); const update = vi.fn(() => ({ eq }));
  const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { project_id: 'project', design_path: 'code/stable.json', message_id: '' } }) }) }), update }) };
  await publishDesignSnapshot({ supabase: client as never, userId: 'owner', projectId: 'project', snapshotId: 'stable', design: { code: 'old props', width: 100, height: 100 }, messageId: 'first-message', preserveExisting: true });
  expect(update).toHaveBeenCalledWith({ message_id: 'first-message' });
  expect(eq.mock.calls).toEqual([['id', 'stable'], ['message_id', '']]); expect(write).not.toHaveBeenCalled();
});
