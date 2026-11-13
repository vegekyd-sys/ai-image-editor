import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { buildDesignsMap } from '@/lib/editor/timeline-derivations';

const mocks = vi.hoisted(() => ({ client: {} as any }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => mocks.client }));
vi.mock('@/lib/supabase/storage', () => ({ uploadImage: vi.fn(), getOptimizedUrl: (url: string) => url, getThumbnailUrl: (url: string) => url }));
vi.mock('@/lib/imageCache', () => ({ cacheProjectData: vi.fn(), getCachedProjectData: vi.fn() }));
vi.mock('@/lib/editor/loaded-design-manifest', () => ({ normalizeLoadedDesignManifest: (design: unknown) => design }));
vi.mock('@/lib/audio-url-resolver', () => ({ resolveAudioUrlsInCode: async (code: string) => ({ code, changed: false }) }));
vi.mock('@/lib/video-url-resolver', () => ({ resolveVideoUrlsInCode: async (code: string) => ({ code, changed: false }) }));
import { useProject } from '@/hooks/useProject';

afterEach(() => vi.unstubAllGlobals());
it('delivers late design hydration without mutating the poster snapshots React already received', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  mocks.client = {
    from: (table: string) => {
      const data = table === 'projects' ? { title: 'Layers', timeline_version: 2, user_id: 'owner', is_public: false }
        : table === 'snapshots' ? [{ id: 'design-snapshot', image_url: 'https://example.com/poster.jpg', design_path: 'code/design.json', tips: [] }] : [];
      const query: any = { select: () => query, eq: () => query, in: () => query, order: async () => ({ data }), maybeSingle: async () => ({ data }) };
      return query;
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/design.json' } }) }) },
  };
  const { result } = renderHook(() => useProject('project', 'owner'));
  const onHydrated = vi.fn();
  const initial = await result.current.loadProject(onHydrated);
  expect(initial.snapshots[0].design).toBeUndefined();
  expect(buildDesignsMap(initial.snapshots, null).size).toBe(0);
  const design = { code: 'function Composition() { return null }', width: 1024, height: 1024, props: { title: 'WORLD', _layerState: { order: ['title'], deleted: [] } } };
  finish(Response.json(design));
  await waitFor(() => expect(onHydrated).toHaveBeenCalledTimes(1));
  expect(initial.snapshots[0].design).toBeUndefined();
  const hydrated = onHydrated.mock.calls[0][0];
  expect(hydrated[0]).not.toBe(initial.snapshots[0]);
  expect(buildDesignsMap(hydrated, null).get(0)).toEqual(design);
});
