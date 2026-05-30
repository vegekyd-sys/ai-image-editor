import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { validateVideoScript } from '@/lib/video-harness'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8')

describe('agent media scenario matrix', () => {
  const agent = read('src/lib/prompts/agent.md')
  const image = read('src/lib/prompts/image.md')
  const generateImageTool = read('src/lib/prompts/generate_image_tool.md')
  const animate = read('src/lib/prompts/animate.md')
  const coding = read('src/lib/prompts/agent-coding.md')
  const ffmpegSkill = read('src/skills/video-ffmpeg-lab/SKILL.md')
  const agentTs = read('src/lib/agent.ts')

  it('keeps the core agent prompt as a lightweight router', () => {
    expect(agent.length).toBeLessThan(8_000)
    expect(agent).toContain("read_file('prompts/image.md')")
    expect(agent).toContain("read_file('prompts/animate.md')")
    expect(agent).toContain('`skills/video-ffmpeg-lab/SKILL.md`')
    expect(agent).toContain('Default tool: `generate_image`')
    expect(agent).toContain('Default tool: `generate_animation`')
    expect(agent).toContain('Default tool: `run_code` with `runtime: "node"`')
    expect(agent).toContain('Default tool: `run_code` with `runtime: "design"`')
    expect(agent).toContain('Use `generate_music` only when the user asks')
  })

  it('preserves old image scenarios in the dedicated image guide', () => {
    const required = [
      'Snapshot Index',
      'reference_media_indices',
      'useOriginalAsReference=true',
      'Red Annotations',
      "skill='enhance'",
      "skill='creative'",
      "skill='wild'",
      "skill='captions'",
      "model: 'qwen'",
      "model: 'openai'",
      'Context Mode',
      'Keep every person',
      'Do NOT add any text, watermarks, or borders',
      'Reference Image Uploaded by User',
    ]

    for (const marker of required) {
      expect(image).toContain(marker)
    }
  })

  it('keeps generate_image tool description short while pointing to the full image guide', () => {
    expect(generateImageTool.length).toBeLessThan(2_500)
    expect(generateImageTool).toContain("read_file('prompts/image.md')")
    expect(generateImageTool).toContain('media_index')
    expect(generateImageTool).toContain('reference_media_indices')
    expect(generateImageTool).toContain('`image_refs` is only for external workspace URLs')
    expect(generateImageTool).toContain("Context Mode for `model='openai'`")
  })

  it('keeps video generation default on SeeDance while allowing cheaper Kling', () => {
    expect(agent).toContain('Default video model follows the app selection, usually SeeDance')
    expect(animate).toContain('usually SeeDance')
    expect(animate).toContain('prefer Kling only when duration and capability allow it')
    expect(ffmpegSkill).toContain('| SeeDance | 15s | 15.5s | Default video model')
    expect(ffmpegSkill).toContain('| Kling | 10s | 10.5s | Cheaper option')
    expect(ffmpegSkill).not.toContain('Cheaper/default')
  })

  it('separates design draft semantics from node media outputs', () => {
    expect(coding).toContain('Design runtime (`runtime: "design"` or omitted)')
    expect(coding).toContain('Node media runtime (`runtime: "node"`)')
    expect(coding).toContain('For direct file tasks like "split this video into two videos", `type: "files"` is the final answer')
    expect(coding).toContain('Intermediate chunks for long-video generation workflows should be saved and described, but not published')
    expect(coding).not.toContain('ALL`run_code` output')
    expect(coding).not.toContain('ALL** `run_code` output')
    expect(agentTs).toContain('\\`type: "files"\\` outputs are already saved workspace files')
    expect(agentTs).toContain('not individual binary outputs from type:"files"')
    expect(agentTs).toContain('mediaResult.type === \'video\'')
  })

  it('documents the new long-video FFmpeg state machine', () => {
    const required = [
      'Long-video state machine',
      'probe_source',
      'split_source',
      'generate_chunks',
      'collect_outputs',
      'concat_outputs',
      'publish_final',
      'Do not run the same split again',
      'Never publish source chunks as timeline snapshots',
      'do not start a second `run_code` just to re-open a file from the previous temp directory',
      'return both URLs from the first `type: "files"` run and stop',
    ]

    for (const marker of required) {
      expect(ffmpegSkill).toContain(marker)
    }
  })
})

describe('video script harness old and new scenarios', () => {
  it('old photo-to-video scenario requires media markers', () => {
    expect(validateVideoScript({
      prompt: 'Make a dreamy slow zoom video.',
      imageCount: 2,
    })).toContain('MUST use <<<media_1>>>')
  })

  it('old multi-image video scenario rejects out-of-range markers', () => {
    expect(validateVideoScript({
      prompt: 'Shot 1: use <<<media_3>>>.',
      imageCount: 2,
    })).toContain('only 2 items')
  })

  it('old external reference video scenario rejects URLs embedded in prompt text', () => {
    expect(validateVideoScript({
      prompt: 'Use https://example.com/source.mp4 as motion reference.',
      imageCount: 0,
    })).toContain('video_ref_url')
  })

  it('old workspace asset scenario rejects duplicate image_refs from Media Index', () => {
    expect(validateVideoScript({
      prompt: 'Animate <<<media_1>>>.',
      imageCount: 1,
      imageUrls: ['https://cdn.example.com/a.jpg'],
      imageRefs: ['https://cdn.example.com/a.jpg'],
    })).toContain('already <<<media_1>>>')
  })

  it('new SeeDance video edit scenario rejects base mode and asks for feature mode', () => {
    expect(validateVideoScript({
      prompt: 'Restyle <<<media_1>>>.',
      imageCount: 1,
      videoRefUrl: 'https://cdn.example.com/source.mp4',
      videoRefType: 'base',
      model: 'seedance',
    })).toContain('base mode')
  })

  it('new Kling motion-control scenario accepts video_ref_url without media markers', () => {
    expect(validateVideoScript({
      prompt: 'Motion transfer',
      imageCount: 1,
      videoRefUrl: 'https://cdn.example.com/motion.mp4',
      motionControl: true,
      model: 'kling',
    })).toBeNull()
  })
})
