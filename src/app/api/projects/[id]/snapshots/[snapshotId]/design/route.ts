import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/service';
import {
  createPersistedEditableDesign,
  mergePersistedEditableProps,
} from '@/lib/editor/editable-persistence';
import * as workspace from '@/lib/workspace';

type RouteContext = {
  params: Promise<{ id: string; snapshotId: string }>;
};

function safeRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id: projectId, snapshotId } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: project } = await admin
    .from('projects')
    .select('user_id')
    .eq('id', projectId)
    .maybeSingle<{ user_id: string | null }>();
  if (!project?.user_id || project.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: snapshot } = await admin
    .from('snapshots')
    .select('design_path')
    .eq('id', snapshotId)
    .eq('project_id', projectId)
    .maybeSingle<{ design_path: string | null }>();
  if (!snapshot?.design_path) {
    return NextResponse.json({ error: 'Composition not found' }, { status: 404 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    let persisted: ReturnType<typeof createPersistedEditableDesign> & {
      __makaronEditableRevision?: number;
    };

    if (body.design !== undefined) {
      persisted = createPersistedEditableDesign(body.design);
    } else {
      const revision = safeRevision(body.revision);
      if (!revision) {
        return NextResponse.json({ error: 'Invalid revision' }, { status: 400 });
      }
      const currentFile = await workspace.readFile(snapshot.design_path, admin, project.user_id);
      if (!currentFile) {
        return NextResponse.json({ error: 'Composition not found' }, { status: 404 });
      }
      const currentValue = JSON.parse(currentFile.content) as Record<string, unknown>;
      const currentRevision = safeRevision(currentValue.__makaronEditableRevision) || 0;
      if (revision < currentRevision) {
        return NextResponse.json({ ok: true, staleIgnored: true });
      }
      persisted = mergePersistedEditableProps(currentValue, body.props, revision);
    }

    const result = await workspace.writeFile(
      snapshot.design_path,
      JSON.stringify(persisted),
      admin,
      project.user_id,
      'application/json',
    );
    if (!result.success) {
      throw new Error(result.error || 'Workspace write failed');
    }

    await admin
      .from('projects')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', projectId);

    return NextResponse.json({ ok: true, designPath: snapshot.design_path });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[design-persistence]', JSON.stringify({
      projectId,
      snapshotId,
      designPath: snapshot.design_path,
      message,
    }));
    return NextResponse.json({ error: 'Composition changes could not be saved' }, { status: 500 });
  }
}

