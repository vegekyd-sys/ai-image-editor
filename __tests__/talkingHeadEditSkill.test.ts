import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

describe('talking-head editing skill', () => {
  const skill = read('src/skills/talking-head/SKILL.md')

  it('reuses the existing editing and packaging skills', () => {
    expect(skill).toContain('skills/video-ffmpeg-lab/SKILL.md')
    expect(skill).toContain('skills/content-repurpose/SKILL.md')
    expect(skill).toContain('skills/tiktok-video/SKILL.md')
    expect(skill).toContain('Do not create a parallel editing stack')
  })

  it('uses the existing ASR line and word timestamps', () => {
    expect(skill).toContain('utterances[].startMs/endMs')
    expect(skill).toContain('utterances[].words[].startMs/endMs')
    expect(skill).toContain('full transcript artifact')
    expect(skill).toContain('Do not retranscribe')
  })

  it('keeps ASR audio-only and avoids naive repeated-character cuts', () => {
    expect(skill).toContain('mono 16 kHz audio derivative')
    expect(skill).toContain('never submit the original video as the ASR')
    expect(skill).toContain('简简单单')
    expect(skill).toContain('character matching alone')
  })

  it('maps transcript-anchored B-roll through the retained source ranges', () => {
    expect(skill).toContain('buildSourceToOutputMap')
    expect(skill).toContain('sourceTimeToOutputTime')
    expect(skill).toContain('keepSourceAudio: true')
    expect(skill).toContain('muted: true')
    expect(skill).toContain('report it as orphaned')
  })
})
