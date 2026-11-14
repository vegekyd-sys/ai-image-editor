import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('uploaded image handoff', () => {
  beforeEach(() => { sessionStorage.clear(); vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('enters a project and survives reload even when IndexedDB never opens', async () => {
    const open = vi.fn(() => ({}))
    vi.stubGlobal('indexedDB', { open })
    const images = ['https://cdn.makaron.app/source.png']
    const cache = await import('@/lib/imageCache')
    await cache.stagePendingProjectImages('new-project', images)
    expect(open).toHaveBeenCalled()
    expect(cache.getPendingProjectImagesSync('new-project')).toEqual(images)

    // A reload clears module memory; compact permanent URLs remain available
    // without needing the blocked disk cache to recover first.
    vi.resetModules()
    const reopened = await import('@/lib/imageCache')
    expect(reopened.getPendingProjectImagesSync('new-project')).toEqual(images)
    await expect(reopened.getPendingProjectImages('new-project')).resolves.toEqual(images)
    expect(reopened.getPendingProjectImagesSync('other-project')).toBeNull()
  }, 1000)

  it('keeps binary legacy media out of sessionStorage', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('Disk unavailable') } })
    const cache = await import('@/lib/imageCache')
    const payload = 'data:image/png;base64,binary-legacy-media'
    await cache.stagePendingProjectImages('legacy-project', [payload])
    expect(sessionStorage.getItem('makaron:pending-project-images')).not.toContain(payload)
    expect(cache.getPendingProjectImagesSync('legacy-project')).toEqual([payload])
  })
})
