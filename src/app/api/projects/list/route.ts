import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';

/**
 * GET /api/projects/list — List user's projects with snapshot counts.
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await authenticateRequest(req);
    if ('error' in authResult) return authResult.error;
    const { userId, supabase } = authResult.auth;

    const { data: projects } = await supabase
      .from('projects')
      .select('id, title, cover_url, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (!projects?.length) {
      return NextResponse.json({ projects: [] });
    }

    // Get snapshot counts per project
    const projectIds = projects.map(p => p.id);
    const { data: snapCounts } = await supabase
      .from('snapshots')
      .select('project_id')
      .in('project_id', projectIds);

    const countMap = new Map<string, number>();
    for (const s of snapCounts ?? []) {
      countMap.set(s.project_id, (countMap.get(s.project_id) || 0) + 1);
    }

    const result = projects.map(p => ({
      id: p.id,
      title: p.title || 'Untitled',
      coverUrl: p.cover_url,
      snapshotCount: countMap.get(p.id) || 0,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      url: `https://www.makaron.app/projects/${p.id}`,
    }));

    return NextResponse.json({ projects: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
