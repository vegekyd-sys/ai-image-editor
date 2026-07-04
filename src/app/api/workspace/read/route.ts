import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/service';
import { readFile } from '@/lib/workspace';

export async function GET(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get('path');
    if (!path) {
      return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      const projectId = req.nextUrl.searchParams.get('projectId');
      if (!projectId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const admin = getSupabaseAdmin();
      const { data: project } = await admin
        .from('projects')
        .select('user_id, is_public')
        .eq('id', projectId)
        .maybeSingle<{ user_id: string | null; is_public: boolean | null }>();

      if (!project?.is_public || !project.user_id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { data: snapshot } = await admin
        .from('snapshots')
        .select('id')
        .eq('project_id', projectId)
        .eq('design_path', path)
        .maybeSingle<{ id: string }>();

      if (!snapshot) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      const result = await readFile(path, admin, project.user_id);
      if (!result) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      return NextResponse.json({ content: result.content, contentType: result.contentType });
    }

    const result = await readFile(path, supabase, userId);
    if (!result) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    return NextResponse.json({ content: result.content, contentType: result.contentType });
  } catch (err) {
    console.error('[workspace/read]', err);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
