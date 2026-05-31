import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '..')

function read(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8')
}

describe('agent prompt policy guards', () => {
  it('keeps image work on generate_image unless editable runtime is explicit', () => {
    const agent = read('src/lib/prompts/agent.md')
    const agentTs = read('src/lib/agent.ts')

    expect(agent).toContain('Default tool: `generate_image`')
    expect(agent).toContain('Static charts, infographics, posters, and marketing images go to `generate_image`')
    expect(agentTs).toContain('Use ONLY for video/animation or when user explicitly requests an editable template')
  })

  it('requires script confirmation before video provider submission unless direct-submit is explicit', () => {
    const agent = read('src/lib/prompts/agent.md')
    const agentTs = read('src/lib/agent.ts')

    expect(agent).toContain('video rendering has a script review gate unless the user explicitly asks to submit/render without confirmation')
    expect(agent).toContain('Only call `generate_animation` after the user confirms')
    expect(agent).toContain('Direct-submit exception')
    expect(agent).toContain('直接提交渲染')
    expect(agent).toContain('不要问我确认')
    expect(agent).not.toContain('Do not add a review loop')
    expect(agent).not.toContain('even if the user says "直接提交" or "不要确认"')

    expect(agentTs).toContain('explicitly authorizes direct submission without confirmation')
    expect(agentTs).toContain('直接提交渲染')
  })

  it('keeps Seedance as the default video model unless user or app selects Kling', () => {
    const agent = read('src/lib/prompts/agent.md')
    const agentTs = read('src/lib/agent.ts')

    expect(agent).toContain('usually SeeDance')
    expect(agent).toContain('prefer Kling')
    expect(agentTs).toContain("ctx.videoModel || 'seedance'")
    expect(agentTs).toContain('Default: seedance')
  })
})
