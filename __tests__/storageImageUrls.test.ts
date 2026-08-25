import { describe, expect, it } from 'vitest'
import {
  getOptimizedUrl,
  getOriginFormatThumbnailUrl,
  getThumbnailUrl,
} from '@/lib/supabase/storage'

describe('Supabase image URLs', () => {
  const path = '/storage/v1/object/public/images/user/project/source.jpg'

  it.each([
    `http://127.0.0.1:55321${path}`,
    `http://localhost:55321${path}`,
    `http://[::1]:55321${path}`,
  ])('keeps local Storage object URLs renderable: %s', url => {
    expect(getOptimizedUrl(url)).toBe(url)
    expect(getThumbnailUrl(url)).toBe(url)
    expect(getOriginFormatThumbnailUrl(url)).toBe(url)
  })

  it('uses hosted Supabase image transformations outside local E2E', () => {
    const url = `https://example.supabase.co${path}`
    expect(getOptimizedUrl(url)).toBe(
      'https://example.supabase.co/storage/v1/render/image/public/images/user/project/source.jpg?width=2000&quality=95',
    )
    expect(getThumbnailUrl(url, 400, 70, 533, 'contain')).toBe(
      'https://example.supabase.co/storage/v1/render/image/public/images/user/project/source.jpg?width=400&quality=70&height=533&resize=contain',
    )
  })
})
