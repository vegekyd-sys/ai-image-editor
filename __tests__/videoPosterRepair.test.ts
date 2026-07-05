import { describe, expect, it } from 'vitest'
import { needsVideoPosterRepair } from '@/lib/video-poster-repair'

describe('video poster repair', () => {
  it('repairs missing placeholders and video-like image urls', () => {
    expect(needsVideoPosterRepair(null)).toBe(true)
    expect(needsVideoPosterRepair('')).toBe(true)
    expect(needsVideoPosterRepair('/video-placeholder.png')).toBe(true)
    expect(needsVideoPosterRepair('https://cdn.makaron.app/storage/v1/object/public/images/user/project/videos/snap.mp4')).toBe(true)
    expect(needsVideoPosterRepair('https://cdn.makaron.app/storage/v1/object/public/images/user/project/posters/snap.jpg')).toBe(false)
  })
})
