// @vitest-environment node
// Regression for project 68d9bb7c (2026-11-24): the Agent called write_file({ path: "<...>.mp4", content: "<slug>" })
// on a finished run_code MP4, overwrote it with 23 bytes of text, then published it; the canvas showed "video link expired".
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/workspace', async importOriginal => ({ ...await importOriginal<any>(), readFile: state.read, writeFile: state.write }));

import { createTools, type AgentContext } from '@/lib/agent-tools';

const MP4_PATH = 'proj-1/media/1795510874173-final-v3.mp4';
const MP4_URL = `https://cdn.example.com/storage/v1/object/public/images/owner/workspace/${MP4_PATH}`;
let ctx: AgentContext;
let headLength = '23';

function supabaseStub() {
  return {
    from: (table: string) => {
      const query: any = {
        select: () => query, eq: () => query, like: () => query, order: () => query, limit: () => query,
        in: () => Promise.resolve({ data: table === 'workspace_files' ? [{ path: MP4_PATH, content_type: 'video/mp4', storage_url: MP4_URL, updated_at: '2026-11-24T09:01:36Z' }] : [], error: null }),
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      return query;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  headLength = '23';
  state.write.mockResolvedValue({ success: true, storageUrl: MP4_URL });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': headLength } })));
  ctx = {
    projectId: 'proj-1', userId: 'owner', currentImage: '', generatedImages: [], snapshotImages: [],
    explicitMediaIndices: [], currentSnapshotIndex: 0, supabase: supabaseStub() as any,
  } as AgentContext;
});
afterEach(() => vi.unstubAllGlobals());

const writeFileTool = () => (createTools(ctx, { spec: { provider: 'test', supportsImageInput: true } } as any).write_file.execute as any);

it('refuses to overwrite a workspace MP4 with text content', async () => {
  const result = await writeFileTool()({ name: 'final', path: MP4_PATH, content: 'final-slug', publish: true }, {});
  expect(result.success).toBe(false);
  expect(result.message).toContain('cannot create or replace binary media');
  expect(result.message).toContain('fromWorkspaceOutputs: true');
  expect(state.write).not.toHaveBeenCalled();
});

it('still allows ordinary text files', async () => {
  const result = await writeFileTool()({ path: 'proj-1/notes/plan.md', content: '# plan' }, {});
  expect(result.success).toBe(true);
  expect(state.write).toHaveBeenCalledWith('proj-1/notes/plan.md', '# plan', expect.anything(), 'owner');
});

it('routes workspacePaths without fromWorkspaceOutputs to publishing instead of a "provide a path" error', async () => {
  const result = await writeFileTool()({ name: 'final', mediaType: 'video', publish: true, workspacePaths: [MP4_PATH] }, {});
  expect(result.message).not.toContain('Provide a path');
  expect(state.write).not.toHaveBeenCalled();
});

it('refuses to publish a "video" that is only a few bytes', async () => {
  const result = await writeFileTool()({ fromWorkspaceOutputs: true, mediaType: 'video', workspacePaths: [MP4_PATH] }, {});
  expect(result.success).toBe(false);
  expect(result.message).toContain('only 23 bytes');
});
