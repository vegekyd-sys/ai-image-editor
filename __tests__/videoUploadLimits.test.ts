import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '..')

function read(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8')
}

describe('video upload duration limits', () => {
  it('allows long uploads for Agent-side FFmpeg preparation', () => {
    const source = read('src/lib/video-upload.ts')

    expect(source).toContain('export const MAX_DURATION = 900')
    expect(source).toContain('export const MAX_DURATION_TOLERANCE = 1')
    expect(source).toContain('export const MAX_ACCEPTED_DURATION = MAX_DURATION + MAX_DURATION_TOLERANCE')
    expect(source).toContain('Model reference-video limits stay in generate_animation/create-video')
  })

  it('keeps project-create upload validation aligned with the FFmpeg upload window', () => {
    const source = read('src/app/api/projects/create/route.ts')

    expect(source).toContain('const MAX_VIDEO_DURATION = 900')
    expect(source).toContain('const MAX_VIDEO_DURATION_TOLERANCE = 1')
    expect(source).toContain('providedMeta.duration > MAX_VIDEO_DURATION + MAX_VIDEO_DURATION_TOLERANCE')
    expect(source).toContain('metadata tolerance')
  })

  it('keeps model-facing copy focused on provider limits rather than upload padding', () => {
    const zh = read('src/lib/locales/zh.ts')
    const en = read('src/lib/locales/en.ts')

    expect(zh).not.toContain('metadata 误差')
    expect(en).not.toContain('metadata padding accepted')
  })

  it('does not direct-upload videos above the Storage object limit', () => {
    const source = read('src/lib/video-upload.ts')

    expect(source).toContain('const STORAGE_UPLOAD_MAX_SIZE = 50 * 1024 * 1024')
    expect(source).toContain('const DIRECT_UPLOAD_MAX_SIZE = 48 * 1024 * 1024')
    expect(source).toContain('TRANSCODE_TARGET_SIZE')
    expect(source).toContain('videoBitrate')
    expect(source).toContain('Video upload too large after processing')
  })
})
