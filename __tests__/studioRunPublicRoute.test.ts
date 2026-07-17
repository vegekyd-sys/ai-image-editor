import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockProjectMaybeSingle = vi.fn();
const mockListRuns = vi.fn();
const mockReadFile = vi.fn();

const admin = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: mockProjectMaybeSingle,
  })),
};

vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mockAuthenticateRequest }));
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => admin }));
vi.mock('@/lib/workspace', () => ({ readFile: mockReadFile }));
vi.mock('@/lib/studio-run', () => ({
  summarizeStudioRun: (run: { id: string; artifacts?: Record<string, { path: string }> }) => ({
    runId: run.id,
    stages: Object.entries(run.artifacts || {}).map(([id, ref]) => ({ id, artifactPath: ref.path })),
  }),
  WorkspaceStudioRunStore: class {
    listRuns = mockListRuns;
  },
}));

function request(): NextRequest {
  return new Request('https://www.makaron.app/api/projects/project-1/studio-runs') as NextRequest;
}

describe('public Studio Run route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ error: new Response('Unauthorized', { status: 401 }) });
    mockListRuns.mockResolvedValue([]);
  });

  it('allows anonymous read-only access to a public project', async () => {
    mockProjectMaybeSingle.mockResolvedValue({
      data: { id: 'project-1', user_id: 'owner-1', is_public: true },
      error: null,
    });
    const { GET } = await import('@/app/api/projects/[id]/studio-runs/route');

    const response = await GET(request(), { params: Promise.resolve({ id: 'project-1' }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runs: [], artifacts: {}, access: 'public-readonly' });
    expect(mockListRuns).toHaveBeenCalledWith('project-1');
  });

  it('removes internal paths and checksums from public delivery details', async () => {
    mockProjectMaybeSingle.mockResolvedValue({
      data: { id: 'project-1', user_id: 'owner-1', is_public: true },
      error: null,
    });
    mockListRuns.mockResolvedValue([{
      id: 'run-1',
      artifacts: { delivery: { path: 'project-1/studio-runs/run-1/delivery.json' } },
    }]);
    mockReadFile.mockResolvedValue({
      content: JSON.stringify({
        outputPath: 'project-1/media/final.mp4',
        editableSourcePath: 'project-1/drafts/latest-composition.json',
        sha256: 'private-checksum',
      }),
    });
    const { GET } = await import('@/app/api/projects/[id]/studio-runs/route');

    const response = await GET(request(), { params: Promise.resolve({ id: 'project-1' }) });
    const data = await response.json();

    expect(data.artifacts['stage:delivery']).toEqual({
      outputPath: 'final.mp4',
      editableSourcePath: 'latest-composition.json',
    });
    expect(JSON.stringify(data)).not.toContain('project-1/studio-runs');
  });

  it('rejects anonymous access to a private project', async () => {
    mockProjectMaybeSingle.mockResolvedValue({
      data: { id: 'project-1', user_id: 'owner-1', is_public: false },
      error: null,
    });
    const { GET } = await import('@/app/api/projects/[id]/studio-runs/route');

    const response = await GET(request(), { params: Promise.resolve({ id: 'project-1' }) });

    expect(response.status).toBe(401);
    expect(mockListRuns).not.toHaveBeenCalled();
  });

  it('preserves owner access to a private project', async () => {
    mockAuthenticateRequest.mockResolvedValue({
      auth: { userId: 'owner-1', supabase: {} },
    });
    mockProjectMaybeSingle.mockResolvedValue({
      data: { id: 'project-1', user_id: 'owner-1', is_public: false },
      error: null,
    });
    const { GET } = await import('@/app/api/projects/[id]/studio-runs/route');

    const response = await GET(request(), { params: Promise.resolve({ id: 'project-1' }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runs: [], artifacts: {}, access: 'owner' });
    expect(mockListRuns).toHaveBeenCalledWith('project-1');
  });
});
