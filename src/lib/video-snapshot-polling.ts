import type { VideoMeta } from '@/types'

export const DEFAULT_VIDEO_SNAPSHOT_POLL_INTERVAL_MS = 4_000
export const H3_MAX_FAST_POLL_INTERVAL_MS = 500
export const H3_MAX_FAST_POLL_WINDOW_MS = 10_000

type ProcessingVideoSnapshot = {
  videoMeta?: Pick<VideoMeta, 'taskId' | 'createdAt'>
}

export function getVideoSnapshotPollIntervalMs(
  snapshots: ProcessingVideoSnapshot[],
  nowMs = Date.now(),
  fallbackStartedAtMs = nowMs,
): number {
  const hasFreshH3MaxTask = snapshots.some(({ videoMeta }) => {
    if (!videoMeta?.taskId?.startsWith('fal-h3max-')) return false
    const parsedCreatedAt = videoMeta.createdAt ? Date.parse(videoMeta.createdAt) : Number.NaN
    const createdAtMs = Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : fallbackStartedAtMs
    return nowMs - createdAtMs < H3_MAX_FAST_POLL_WINDOW_MS
  })

  return hasFreshH3MaxTask
    ? H3_MAX_FAST_POLL_INTERVAL_MS
    : DEFAULT_VIDEO_SNAPSHOT_POLL_INTERVAL_MS
}
