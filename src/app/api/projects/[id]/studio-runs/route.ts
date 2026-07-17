import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase/service';
import { summarizeStudioRun, WorkspaceStudioRunStore } from '@/lib/studio-run';
import * as workspace from '@/lib/workspace';

type ProjectAccess = {
  id: string;
  user_id: string | null;
  is_public: boolean | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fileName(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.split('/').pop() || value;
}

function publicArtifact(stage: string, value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (stage === 'assets' && Array.isArray(value.assets)) {
    return {
      ...value,
      assets: value.assets.map(asset => isRecord(asset) ? { ...asset, path: fileName(asset.path) } : asset),
    };
  }
  if (stage === 'composition') {
    return { ...value, designPath: fileName(value.designPath) };
  }
  if (stage === 'delivery') {
    const delivery = { ...value };
    delete delivery.sha256;
    return {
      ...delivery,
      outputPath: fileName(value.outputPath),
      editableSourcePath: fileName(value.editableSourcePath),
    };
  }
  return value;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const admin = getSupabaseAdmin();
  const authResult = await authenticateRequest(req);
  const authUserId = 'auth' in authResult ? authResult.auth.userId : null;
  const hasBearerAuth = req.headers.get('authorization')?.startsWith('Bearer ') ?? false;

  const { data: project } = await admin
    .from('projects')
    .select('id, user_id, is_public')
    .eq('id', projectId)
    .maybeSingle<ProjectAccess>();
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (hasBearerAuth && 'error' in authResult) return authResult.error;

  const isOwner = !!authUserId && authUserId === project.user_id;
  if (project.is_public !== true && !isOwner) {
    return 'error' in authResult
      ? authResult.error
      : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!project.user_id) return NextResponse.json({ error: 'Project owner not found' }, { status: 404 });

  const store = new WorkspaceStudioRunStore(admin, project.user_id);
  const runs = await store.listRuns(projectId);
  const latestRun = runs[0];
  const artifactEntries = await Promise.all(Object.entries(latestRun?.artifacts || {}).map(async ([stage, ref]) => {
    if (!ref?.path) return null;
    const file = await workspace.readFile(ref.path, admin, project.user_id!);
    if (!file) return null;
    try {
      const artifact = JSON.parse(file.content);
      return [isOwner ? ref.path : `stage:${stage}`, isOwner ? artifact : publicArtifact(stage, artifact)] as const;
    } catch {
      return null;
    }
  }));

  return NextResponse.json({
    runs: runs.slice(0, 10).map(run => {
      const summary = summarizeStudioRun(run);
      if (isOwner) return summary;
      return {
        ...summary,
        stages: summary.stages.map(stage => ({
          ...stage,
          artifactPath: stage.artifactPath ? `stage:${stage.id}` : undefined,
        })),
      };
    }),
    artifacts: Object.fromEntries(artifactEntries.filter((entry): entry is NonNullable<typeof entry> => !!entry)),
    access: isOwner ? 'owner' : 'public-readonly',
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
