'use client';

import { cacheProjectsList } from '@/lib/imageCache';
import { createClient } from '@/lib/supabase/client';

type ProjectRow = {
  id: string;
  title: string;
  cover_url: string | null;
  updated_at: string;
  created_at: string;
};

type SnapshotRow = {
  id: string;
  project_id: string;
  image_url: string;
  sort_order: number;
};

const inFlight = new Map<string, Promise<void>>();

export function warmProjectsListCache(userId: string): Promise<void> {
  const existing = inFlight.get(userId);
  if (existing) return existing;

  const task = Promise.resolve().then(async () => {
    const supabase = createClient();
    const { data: projectRows, error } = await supabase
      .from('projects')
      .select('id, title, cover_url, updated_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !projectRows) return;
    if (projectRows.length === 0) {
      cacheProjectsList(userId, []);
      return;
    }

    const projectIds = (projectRows as ProjectRow[]).map((project) => project.id);
    const snapshotMap = new Map<string, SnapshotRow[]>();
    const batches: string[][] = [];
    for (let i = 0; i < projectIds.length; i += 30) batches.push(projectIds.slice(i, i + 30));

    const [snapshotResults, animResult, videoSnapResult] = await Promise.all([
      Promise.all(batches.map((batch) =>
        supabase
          .from('snapshots')
          .select('id, project_id, image_url, sort_order')
          .in('project_id', batch)
          .order('sort_order', { ascending: true })
          .limit(3000)
      )),
      supabase
        .from('project_animations')
        .select('project_id')
        .in('project_id', projectIds)
        .eq('status', 'completed'),
      supabase
        .from('snapshots')
        .select('project_id')
        .in('project_id', projectIds)
        .eq('type', 'video'),
    ]);

    for (const { data } of snapshotResults) {
      for (const snapshot of (data ?? []) as SnapshotRow[]) {
        const list = snapshotMap.get(snapshot.project_id) ?? [];
        list.push(snapshot);
        snapshotMap.set(snapshot.project_id, list);
      }
    }

    const videoProjectIds = new Set<string>();
    for (const row of animResult.data ?? []) videoProjectIds.add(row.project_id);
    for (const row of videoSnapResult.data ?? []) videoProjectIds.add(row.project_id);

    const projects = (projectRows as ProjectRow[])
      .map((project) => ({
        ...project,
        snapshots: snapshotMap.get(project.id) ?? [],
        hasVideo: videoProjectIds.has(project.id),
      }))
      .filter((project) => project.snapshots.length > 0);

    cacheProjectsList(userId, projects);
  }).catch(() => {
    // Warmup failures should never block navigation.
  }).finally(() => {
    inFlight.delete(userId);
  });

  inFlight.set(userId, task);
  return task;
}
