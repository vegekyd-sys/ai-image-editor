import { describe, expect, it, vi } from 'vitest'
import { uploadAudio } from '@/lib/supabase/storage'

describe('audio storage formats', () => {
  it.each([
    ['wav', '.wav', 'audio/wav'],
    ['mp3', '.mp3', 'audio/mpeg'],
    ['pcm', '.pcm', 'audio/L16'],
    ['ogg_opus', '.ogg', 'audio/ogg; codecs=opus'],
  ] as const)('persists %s with a matching extension and MIME type', async (format, extension, contentType) => {
    const upload = vi.fn(async () => ({ error: null }))
    const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://example.com/${path}` } }))
    const from = vi.fn(() => ({ upload, getPublicUrl }))
    const supabase = { storage: { from } } as any

    const result = await uploadAudio(
      supabase,
      'user-1',
      'project-1',
      'task-1',
      2,
      new Uint8Array([1, 2, 3]),
      format,
    )

    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`task-1-2\\${extension}$`)),
      expect.any(Uint8Array),
      { contentType, upsert: true },
    )
    expect(result).toContain(extension)
  })
})
