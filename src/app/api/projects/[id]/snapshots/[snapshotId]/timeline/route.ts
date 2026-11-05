import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/service';
import { TimelineError } from '@/lib/timeline/reducer';
import { applyTimelineTxToFile, loadTimelineFile } from '@/lib/timeline/server';
import { TimelineOpSchema } from '@/lib/timeline/types';

type RouteContext = { params: Promise<{ id: string; snapshotId: string }> };

const TxSchema = z.object({
  txId: z.string().min(1).max(80).optional(),
  baseRevision: z.number().int().min(0),
  ops: z.array(TimelineOpSchema).min(1).max(500),
});

async function authorize(projectId: string, snapshotId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const admin = getSupabaseAdmin();
  const { data: project } = await admin.from('projects').select('user_id').eq('id', projectId).maybeSingle<{ user_id: string | null }>();
  if (!project?.user_id || project.user_id !== user.id) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  const { data: snapshot } = await admin.from('snapshots').select('design_path').eq('id', snapshotId).eq('project_id', projectId)
    .maybeSingle<{ design_path: string | null }>();
  if (!snapshot?.design_path) return { error: NextResponse.json({ error: 'Timeline video not found' }, { status: 404 }) };
  return { admin, userId: project.user_id, designPath: snapshot.design_path };
}

/** Current timeline doc (used to resync after a conflict). */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id, snapshotId } = await context.params;
  const auth = await authorize(id, snapshotId);
  if ('error' in auth) return auth.error;
  const loaded = await loadTimelineFile(auth.admin, auth.userId, auth.designPath);
  if (!loaded) return NextResponse.json({ error: 'Timeline video not found' }, { status: 404 });
  return NextResponse.json({ timeline: loaded.doc });
}

/** Apply one user transaction with element-level rebase; returns the new doc. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id, snapshotId } = await context.params;
  const auth = await authorize(id, snapshotId);
  if ('error' in auth) return auth.error;
  const parsed = TxSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid timeline transaction' }, { status: 400 });
  try {
    const result = await applyTimelineTxToFile(auth.admin, auth.userId, auth.designPath, parsed.data);
    await auth.admin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', id);
    return NextResponse.json({ ok: true, revision: result.doc.revision, timeline: result.doc, changed: result.changed });
  } catch (error) {
    if (error instanceof TimelineError) {
      const loaded = await loadTimelineFile(auth.admin, auth.userId, auth.designPath).catch(() => null);
      return NextResponse.json({ error: error.message, code: error.code, clipIds: error.clipIds, timeline: loaded?.doc }, { status: 409 });
    }
    console.error('[timeline-tx]', JSON.stringify({ projectId: id, snapshotId, message: error instanceof Error ? error.message : String(error) }));
    return NextResponse.json({ error: 'Timeline changes could not be saved' }, { status: 500 });
  }
}
