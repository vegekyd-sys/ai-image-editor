import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractPhotoMetadata } from '@/lib/image/metadata'

vi.mock('exifr', () => ({ default: { parse: vi.fn(async () => undefined) } }))
afterEach(() => { vi.unstubAllGlobals() })

describe('photo metadata fallback upload', () => {
  it('does not upload PNG artwork again when there is no photo EXIF', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(extractPhotoMetadata(new File(['png'], 'artwork.png', { type: 'image/png' }))).resolves.toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps the existing small-photo fallback and bounds its request', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ metadata: { takenAt: '2026-11-14T10:00:00Z' } })))
    vi.stubGlobal('fetch', fetcher)
    await expect(extractPhotoMetadata(new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' }))).resolves.toMatchObject({ takenAt: '2026-11-14T10:00:00Z' })
    expect(fetcher).toHaveBeenCalledWith('/api/photo-metadata', expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }))
  })

  it('avoids oversized fallback requests that the host rejects with 413', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(extractPhotoMetadata(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'photo.heic', { type: 'image/heic' }))).resolves.toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
