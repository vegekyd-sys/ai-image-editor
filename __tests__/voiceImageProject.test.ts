// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ project: vi.fn(), snapshot: vi.fn(), upload: vi.fn(), remove: vi.fn(), deleteProject: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => table === 'projects' ? {
      insert: db.project,
      delete: () => ({ eq: (_field: string, id: string) => ({ eq: (_user: string, owner: string) => db.deleteProject(id, owner) }) }),
    } : { insert: db.snapshot },
    storage: { from: () => ({
      upload: db.upload, remove: db.remove,
      getPublicUrl: (path: string) => ({ data: { publicUrl: 'https://cdn.example/' + path } }),
    }) },
  }),
}));

import { saveVoiceImageProject } from '@/lib/voice-image-project';

beforeEach(() => {
  vi.resetAllMocks();
  for (const fn of Object.values(db)) fn.mockResolvedValue({ error: null });
});

it('saves original bytes, matching extension, cover and snapshot under the billed owner', async () => {
  const url = await saveVoiceImageProject('owner', 'data:image/jpeg;base64,AQID');
  const project = db.project.mock.calls[0][0];
  const snapshot = db.snapshot.mock.calls[0][0];
  const path = `owner/${project.id}/snapshot-${snapshot.id}.jpg`;
  expect(db.upload).toHaveBeenCalledWith(path, Uint8Array.from([1, 2, 3]), expect.objectContaining({ contentType: 'image/jpeg' }));
  expect(url).toBe('https://cdn.example/' + path);
  expect(project).toMatchObject({ user_id: 'owner', title: 'Voice 图片', cover_url: url, timeline_version: 2 });
  expect(snapshot).toMatchObject({ project_id: project.id, image_url: url, sort_order: 0 });
  expect(db.remove).not.toHaveBeenCalled();
});

it('cleans up this upload and project if the timeline insert fails', async () => {
  db.snapshot.mockResolvedValue({ error: new Error('write failed') });
  await expect(saveVoiceImageProject('owner', 'data:image/png;base64,AQID')).rejects.toThrow('write failed');
  expect(db.deleteProject).toHaveBeenCalledWith(db.project.mock.calls[0][0].id, 'owner');
  expect(db.remove).toHaveBeenCalledWith([db.upload.mock.calls[0][0]]);
});
