import { describe, expect, it, vi } from 'vitest'
import { extractPhotoMetadata } from '@/lib/image/metadata'

describe('anonymous photo metadata staging', () => {
  it('does not call the authenticated server fallback before login', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const file = new File(['not-an-exif-image'], 'skill-input.png', { type: 'image/png' })

    await expect(extractPhotoMetadata(file, { allowServerFallback: false })).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
