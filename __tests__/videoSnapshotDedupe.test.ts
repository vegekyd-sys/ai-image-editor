import { describe, expect, it } from 'vitest'
import { appendSnapshotDedupeVideo, dedupeVideoSnapshots } from '@/lib/video-snapshot-dedupe'
import type { Snapshot } from '@/types'

function videoSnapshot(id: string, url: string, duration?: number): Snapshot {
  return {
    id,
    image: '',
    messageId: '',
    tips: [],
    type: 'video',
    videoMeta: {
      taskId: `task-${id}`,
      videoUrl: url,
      providerUrl: url,
      prompt: 'video',
      sourceSnapshotIds: [],
      sourceUrls: [url],
      status: 'completed',
      duration: duration ?? null,
      model: 'upload',
      createdAt: new Date(0).toISOString(),
    },
  }
}

describe('video snapshot timeline dedupe', () => {
  it('dedupes videos by normalized URL across query and hash variants', () => {
    const snapshots = [
      videoSnapshot('a', 'https://cdn.example.com/final.mp4?v=old#t=0.1', 20),
      videoSnapshot('b', 'https://cdn.example.com/final.mp4?v=new#t=0.2', 15),
      videoSnapshot('c', 'https://cdn.example.com/other.mp4', 5),
    ]

    const deduped = dedupeVideoSnapshots(snapshots)

    expect(deduped.map(s => s.id)).toEqual(['a', 'c'])
  })

  it('merges duplicate video metadata when appending an already-known result', () => {
    const existing = videoSnapshot('a', 'https://cdn.example.com/final.mp4?v=old', 20)
    const incoming = videoSnapshot('b', 'https://cdn.example.com/final.mp4?v=new#t=0.1', 15)
    incoming.description = 'fixed duration'

    const merged = appendSnapshotDedupeVideo([existing], incoming)

    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('a')
    expect(merged[0].description).toBe('fixed duration')
    expect(merged[0].videoMeta?.duration).toBe(15)
    expect(merged[0].videoMeta?.videoUrl).toBe('https://cdn.example.com/final.mp4?v=new#t=0.1')
  })
})
