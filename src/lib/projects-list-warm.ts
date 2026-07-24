'use client';

import { cacheProjectsList, getCachedProjectsListSync } from '@/lib/imageCache';
import { createClient } from '@/lib/supabase/client';

const VIDEO_PLACEHOLDER_IMAGE = '/video-placeholder.png';

type ProjectRow = {
  id: string;
  title: string;
  cover_url: string | null;
  updated_at: string;
  created_at: string;
};

type CachedProject = ProjectRow & {
  snapshots?: Array<{ id: string; image_url: string; sort_order: number }>;
  hasVideo?: boolean;
};

function isDisplayCover(url: string | null): url is string {
  return Boolean(url && url !== VIDEO_PLACEHOLDER_IMAGE && !url.endsWith(VIDEO_PLACEHOLDER_IMAGE));
}

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

    // Navigation warmup stays intentionally thin: one projects query gives us
    // stable cover_url thumbnails without competing with homepage interaction
    // or downloading every snapshot/video badge up front.
    const cachedProjects = (getCachedProjectsListSync(userId) ?? []) as CachedProject[];
    const cachedMap = new Map(cachedProjects.map((project) => [project.id, project]));
    const projects = (projectRows as ProjectRow[]).flatMap((project) => {
      const cached = cachedMap.get(project.id);
      const cachedIsFresh = cached?.updated_at === project.updated_at
        && Boolean(cached.snapshots?.length)
        && cached.snapshots!.every((snapshot) => !snapshot.id.startsWith('cover:'));
      const snapshots = cachedIsFresh
        ? cached!.snapshots!
        : isDisplayCover(project.cover_url)
          ? [{ id: `cover:${project.id}`, image_url: project.cover_url, sort_order: 0 }]
          : cached?.snapshots ?? [];
      if (snapshots.length === 0) return [];
      return [{ ...project, snapshots, hasVideo: cached?.hasVideo }];
    });

    cacheProjectsList(userId, projects);
  }).catch(() => {
    // Warmup failures should never block navigation.
  }).finally(() => {
    inFlight.delete(userId);
  });

  inFlight.set(userId, task);
  return task;
}
