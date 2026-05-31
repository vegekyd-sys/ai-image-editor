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

  it('requires script confirmation before video provider submission', () => {
    const agent = read('src/lib/prompts/agent.md')
    const agentTs = read('src/lib/agent.ts')

    expect(agent).toContain('video rendering always has a script review gate')
    expect(agent).toContain('Do not call `generate_animation` in that same turn')
    expect(agent).toContain('Only call `generate_animation` after the user confirms')
    expect(agent).not.toContain('Do not add a review loop')

    expect(agentTs).toContain('Use this tool only after the user has confirmed a video script')
    expect(agentTs).toContain('Never call it in the same turn where you first write the script')
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
