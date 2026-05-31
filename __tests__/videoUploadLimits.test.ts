import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '..')

function read(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8')
}

describe('video upload duration limits', () => {
  it('keeps browser upload creation strictly capped at 15 seconds', () => {
    const source = read('src/lib/video-upload.ts')

    expect(source).toContain('export const MAX_DURATION = 15')
    expect(source).toContain('export const MAX_ACCEPTED_DURATION = MAX_DURATION')
    expect(source).not.toContain('MAX_DURATION_TOLERANCE')
    expect(source).not.toContain('metadata tolerance')
  })

  it('keeps project-create video metadata validation strictly capped at 15 seconds', () => {
    const source = read('src/app/api/projects/create/route.ts')

    expect(source).toContain('const MAX_VIDEO_DURATION = 15')
    expect(source).not.toContain('MAX_VIDEO_DURATION_TOLERANCE')
    expect(source).not.toContain('metadata tolerance')
    expect(source).toContain('providedMeta.duration > MAX_VIDEO_DURATION')
  })

  it('does not tell users that over-15s upload padding is accepted', () => {
    const zh = read('src/lib/locales/zh.ts')
    const en = read('src/lib/locales/en.ts')

    expect(zh).not.toContain('metadata 误差')
    expect(en).not.toContain('metadata padding accepted')
  })
})
