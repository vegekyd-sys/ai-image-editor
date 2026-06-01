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

  it('keeps built-in image skill triggers visible before the image guide is read', () => {
    const agent = read('src/lib/prompts/agent.md')
    const tool = read('src/lib/prompts/generate_image_tool.md')
    const image = read('src/lib/prompts/image.md')

    expect(agent).toContain('prompts/enhance.md')
    expect(agent).toContain('skill: "enhance"')
    expect(agent).toContain('prompts/creative.md')
    expect(agent).toContain('skill: "creative"')
    expect(agent).toContain('prompts/wild.md')
    expect(agent).toContain('skill: "wild"')
    expect(agent).toContain('prompts/captions.md')
    expect(agent).toContain('skill: "captions"')

    expect(tool).toContain('read only that one skill prompt file once')
    expect(tool).toContain('Do not read `prompts/image.md` just to route the skill')
    expect(tool).not.toContain('prompts/enhance.md')
    expect(image).toContain('backend no longer injects the full template automatically')
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

  it('keeps single video generation capped at 15s and routes longer requests to the director skill', () => {
    const agent = read('src/lib/prompts/agent.md')
    const animate = read('src/lib/prompts/animate.md')
    const agentTs = read('src/lib/agent.ts')

    expect(agent).toContain('a single video-generation script/call must be 15 seconds or less')
    expect(agent).toContain('If the user asks for 30s')
    expect(agent).toContain('Use `skills/long-video-director/SKILL.md`')
    expect(agent).toContain('[Active skill: long-video-director]')

    expect(animate).toContain('Every normal script sent to a video generation model must be **15 seconds or less**')
    expect(animate).toContain('do **not** write one long script')

    expect(agentTs).toContain('Single-call total duration: 5-15 seconds')
    expect(agentTs).toContain('Total duration must be 15 seconds or less')
  })

  it('keeps Seedance as the default video model unless user or app selects Kling', () => {
    const agent = read('src/lib/prompts/agent.md')
    const agentTs = read('src/lib/agent.ts')

    expect(agent).toContain('usually SeeDance')
    expect(agent).toContain('prefer Kling')
    expect(agentTs).toContain("ctx.videoModel || 'seedance'")
    expect(agentTs).toContain('Default: seedance')
  })

  it('routes long video work through the long-video-director skill before short video scripts', () => {
    const agent = read('src/lib/prompts/agent.md')
    const agentTs = read('src/lib/agent.ts')
    const skill = read('src/skills/long-video-director/SKILL.md')

    expect(agent).toContain('skills/long-video-director/SKILL.md')
    expect(agent).toContain('visual anchors')
    expect(agent).toContain('continue that workflow even when the latest user message does not repeat `[Active skill: long-video-director]`')
    expect(agent).toContain('discuss and approve the story first')
    expect(agent).toContain('Do not jump straight from an initial long-video request to full segment scripts')
    expect(agent).toContain('final asset-ref preflight')
    expect(agent).toContain('Do not dump the whole long-video package in one response')

    expect(skill).toContain('Video generation models do **not** know what happened in the previous segment')
    expect(skill).toContain('Each video generation call can produce at most 15 seconds')
    expect(skill).toContain('Do not dump a full long-video package in one response')
    expect(skill).toContain('story first, then approved anchors, then director storyboard panels for every segment, then segment/seam scripts, then optional real generation')
    expect(agent).toContain('then generate one OpenAI storyboard image for each segment')
    expect(agent).toContain('Do not bring up Remotion during the long-video workflow')
    expect(skill).toContain('Timeline')
    expect(skill).toContain('CUI')
    expect(skill).toContain('Asset Inventory')
    expect(skill).toContain('Story Discussion')
    expect(skill).toContain('2-3 distinct story directions')
    expect(skill).toContain('Do not write `Shot N (Xs):` scripts in the first story-direction response')
    expect(skill).toContain('Segment Outline And Storyboard Requirements')
    expect(skill).toContain('Final Preflight Before Submission')
    expect(skill).toContain('Generate or extract the needed anchor images first')
    expect(skill).toContain('Do not write segment scripts before the anchor images are visible and approved')
    expect(skill).toContain('Generate storyboard images with `generate_image` using `model: "openai"`')
    expect(skill).toContain('After every storyboard image generation, call `analyze_image` before script writing')
    expect(skill).toContain('Do not create one full-video storyboard sheet')
    expect(skill).toContain('Do not ask for visible PART dividers')
    expect(skill).toContain('One image per segment is still required, but that image may contain multiple shot panels')
    expect(skill).toContain('shot number, duration, framing, camera movement, and transition or seam note')
    expect(skill).toContain('CUI must repeat the same shot number, duration, framing, camera movement, and transition information as text')
    expect(skill).toContain('storyboard: <<<media_7>>>（S02分镜图）')
    expect(agentTs).toContain('active long-video-director workflow is generating director storyboard images')
    expect(read('src/lib/prompts/generate_image_tool.md')).toContain('director storyboard images required by `long-video-director`')
    expect(skill).toContain('review them like a director')
    expect(skill).toContain('If an approved asset is important but not referenced in a segment script, that is a blocking error')
    expect(skill).toContain('every segment must list the exact `<<<media_N>>>` refs')
    expect(skill).toContain('Segment')
    expect(skill).toContain('Seam')
    expect(skill).toContain('Fewer segments are better for consistency')
    expect(skill).toContain('30s should usually be 2 x 15s')
    expect(skill).toContain('reusable visual reference sheet')
    expect(skill).toContain('Infer which visual facts must stay stable')
    expect(skill).toContain('Character card template')
    expect(skill).toContain('Scene card template')
    expect(skill).toContain('Prop card template')
    expect(skill).toContain('Title at top: [asset name] / [project title] / character reference')
    expect(skill).toContain('Top label: [asset name] / [project title] / scene reference')
    expect(skill).toContain('Top label: [asset name] / [project title] / prop reference')
    expect(skill).not.toContain('Chinese name')
    expect(skill).not.toContain('romanized name')
    expect(skill).not.toContain('State anchor template')
    expect(skill).not.toContain('Style anchor template')
    expect(skill).not.toContain('V character identity anchor')
    expect(skill).toContain('front / side / back turnaround')
    expect(skill).toContain('referenceSheetType')
    expect(skill).toContain('anchor image limit')
    expect(skill).toContain('Shot N (Xs):')
    expect(skill).toContain('total duration budget')
    expect(skill).toContain('Do not parallel-generate dependent anchors')
    expect(skill).toContain('check visual compatibility')
    expect(skill).toContain('prompts/animate.md')
    expect(skill).toContain('skills/video-ffmpeg-lab/SKILL.md')
  })

})
