import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '..')

function read(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8')
}

describe('MiniMax H3 provider parity', () => {
  it('routes the provider task prefix through every video lifecycle surface', () => {
    for (const rel of [
      'src/app/api/agent/run/[id]/route.ts',
      'src/app/api/animate/[taskId]/route.ts',
      'src/app/api/cron/video-poll/route.ts',
      'src/app/api/video-snapshot/[snapshotId]/route.ts',
      'src/hooks/useProject.ts',
      'src/lib/skills/get-video-status.ts',
    ]) {
      expect(read(rel), rel).toContain('minimax-h3-')
    }
  })

  it('discloses MiniMax as an AI processor in every locale and the privacy policy', () => {
    for (const rel of [
      'src/lib/locales/zh.ts',
      'src/lib/locales/zh-Hant.ts',
      'src/lib/locales/ja.ts',
      'src/lib/locales/en.ts',
    ]) {
      expect(read(rel), rel).toMatch(/MiniMax/)
    }
    const privacy = read('src/app/privacy/page.tsx')
    expect(privacy).toContain('MiniMax')
  })

  it('documents the H3 CLI model, resolution, duration, and reference limits', () => {
    for (const rel of [
      'packages/makaron-cli/README.md',
      'packages/makaron-cli/SKILL.md',
      'packages/makaron-cli/skills/makaron/SKILL.md',
    ]) {
      const doc = read(rel)
      expect(doc, rel).toContain('minimax-h3')
      expect(doc, rel).toContain('2k')
      expect(doc, rel).toContain('4-15s')
      expect(doc, rel).toContain('up to 9 image')
      expect(doc, rel).toContain('up to 3 video')
      expect(doc, rel).toContain('up to 3 audio')
    }

    const cli = read('packages/makaron-cli/bin/makaron.mjs')
    expect(cli).toContain('MINIMAX_H3_MIN_VIDEO_SIDE = 256')
    expect(cli).toContain('MINIMAX_H3_MAX_VIDEO_SIDE = 5760')
    expect(cli).toContain('minSide: MINIMAX_H3_MIN_VIDEO_SIDE')
    expect(cli).toContain("allowedExtensions: ['mp4', 'mov']")
  })
})
