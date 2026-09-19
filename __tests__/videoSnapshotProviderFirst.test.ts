import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import {
  DEFAULT_VIDEO_SNAPSHOT_POLL_INTERVAL_MS,
  H3_MAX_FAST_POLL_INTERVAL_MS,
  H3_MAX_FAST_POLL_WINDOW_MS,
  getVideoSnapshotPollIntervalMs,
} from '@/lib/video-snapshot-polling'

const root = path.resolve(__dirname, '..')

describe('provider-first video snapshot playback', () => {
  it('returns an already completed provider URL while persistence runs in the background', () => {
    const source = readFileSync(path.join(root, 'src/app/api/video-snapshot/[snapshotId]/route.ts'), 'utf8')
    expect(source).toContain("return NextResponse.json({ status: 'completed', videoUrl: videoMeta.videoUrl, snapshotId")
    expect(source).not.toContain("Provider URL still in DB — persist hasn't finished yet, tell caller to keep polling")
  })

  it('polls fresh fal H3 Max snapshots every 500ms for the first ten seconds', () => {
    const createdAtMs = Date.parse('2026-09-02T00:00:00.000Z')
    const snapshots = [{
      videoMeta: {
        taskId: 'fal-h3max-request-123',
        createdAt: new Date(createdAtMs).toISOString(),
      },
    }]

    expect(getVideoSnapshotPollIntervalMs(snapshots, createdAtMs + H3_MAX_FAST_POLL_WINDOW_MS - 1))
      .toBe(H3_MAX_FAST_POLL_INTERVAL_MS)
    expect(getVideoSnapshotPollIntervalMs(snapshots, createdAtMs + H3_MAX_FAST_POLL_WINDOW_MS))
      .toBe(DEFAULT_VIDEO_SNAPSHOT_POLL_INTERVAL_MS)
  })

  it('keeps the existing four-second cadence for other providers', () => {
    expect(getVideoSnapshotPollIntervalMs([{
      videoMeta: { taskId: 'xai-task-123', createdAt: new Date().toISOString() },
    }])).toBe(DEFAULT_VIDEO_SNAPSHOT_POLL_INTERVAL_MS)
  })
})
