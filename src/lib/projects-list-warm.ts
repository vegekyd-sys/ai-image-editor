'use client';

import { cacheProjectsList, getCachedProjectsListSync } from '@/lib/imageCache';
import { fetchProjectGalleryPage, mergeProjectGalleryPage, type GalleryProject } from '@/lib/project-gallery';

const inFlight = new Map<string, Promise<void>>();

export function warmProjectsListCache(userId: string): Promise<void> {
  const existing = inFlight.get(userId);
  if (existing) return existing;

  // Only warm the first small page. Media existence, counts and badges use
  // the gallery contract; never cache a guessed empty snapshot list.
  const task = fetchProjectGalleryPage().then(page => {
    const cached = (getCachedProjectsListSync(userId) ?? []) as GalleryProject[];
    cacheProjectsList(userId, page.nextCursor === null
      ? page.projects
      : mergeProjectGalleryPage(cached, page));
  }).catch(() => {
    // Keep the previous cache when any required gallery query fails.
  }).finally(() => {
    inFlight.delete(userId);
  });

  inFlight.set(userId, task);
  return task;
}
