import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { summarizeStudioRun, WorkspaceStudioRunStore } from '@/lib/studio-run';
import * as workspace from '@/lib/workspace';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { userId, supabase } = authResult.auth;
  const { id: projectId } = await params;

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const store = new WorkspaceStudioRunStore(supabase, userId);
  const runs = await store.listRuns(projectId);
  const latestRun = runs[0];
  const artifactEntries = await Promise.all(Object.values(latestRun?.artifacts || {}).map(async ref => {
    if (!ref?.path) return null;
    const file = await workspace.readFile(ref.path, supabase, userId);
    if (!file) return null;
    try {
      return [ref.path, JSON.parse(file.content)] as const;
    } catch {
      return null;
    }
  }));

  return NextResponse.json({
    runs: runs.slice(0, 10).map(run => summarizeStudioRun(run)),
    artifacts: Object.fromEntries(artifactEntries.filter((entry): entry is NonNullable<typeof entry> => !!entry)),
  });
}
