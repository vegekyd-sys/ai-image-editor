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
  const remotion = read('src/lib/prompts/remotion-composition.md')
  const ffmpegSkill = read('src/skills/video-ffmpeg-lab/SKILL.md')
  const agentTs = read('src/lib/agent.ts')
  const agentContext = read('src/lib/agent-context.ts')
  const editor = read('src/components/Editor.tsx')
  const agentRoute = read('src/app/api/agent/route.ts')
  const designHarness = read('src/lib/design-harness.ts')

  it('keeps the core agent prompt as a lightweight router', () => {
    expect(agent.length).toBeLessThan(8_000)
    expect(agent).toContain("read_file('prompts/image.md')")
    expect(agent).toContain("read_file('prompts/animate.md')")
    expect(agent).toContain('`skills/video-ffmpeg-lab/SKILL.md`')
    expect(agent).toContain('Default tool: `generate_image`')
    expect(agent).toContain('Default tool: `generate_animation`')
    expect(agent).toContain('Default tool: `run_code` with `runtime: "node"`')
    expect(agent).toContain('Default tool: `run_code` with `runtime: "composition"`')
    expect(agent).toContain('prompts/remotion-composition.md')
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

  it('separates generic coding, Remotion composition, and node media outputs', () => {
    expect(coding).toContain('Generic Coding (run_code)')
    expect(coding).toContain('runtime: "composition"')
    expect(coding).toContain('legacy alias for `runtime: "composition"`')
    expect(coding).toContain('Node Media Runtime')
    expect(coding).toContain('For direct requests such as "split this video into two videos", return those URLs and stop')
    expect(coding).toContain('Intermediate chunks for long-video workflows stay as workspace outputs, not timeline snapshots')
    expect(coding).toContain('pass those 1-based indices in the `run_code` tool input as `media_refs`')
    expect(coding).toContain('Ordinary splice of two existing timeline videos: `runtime: "composition"`, not node.')
    expect(coding).toContain('Do not use node/FFmpeg for ordinary editable timeline splicing of two existing videos')
    expect(coding).toContain('[Current Composition]')
    expect(coding).toContain('[Current composition pointer]')
    expect(coding).toContain('code_path')
    expect(coding).not.toContain('[Current design code]')
    expect(coding).not.toContain('[Current Remotion composition code]')
    expect(coding).not.toContain('### Video Designs')
    expect(coding).not.toContain('花字')
    expect(coding).not.toContain('Think like a music video director')
    expect(remotion).toContain('Remotion Composition')
    expect(remotion).toContain('Editable Fields')
    expect(remotion).toContain('trimBefore')
    expect(remotion).toContain('<Sequence>')
    expect(remotion).toContain('put two existing timeline videos together')
    expect(remotion).toContain('Do not leave `<<<media_N>>>` placeholders inside `props.clipA`')
    expect(remotion).toContain('composition draft')
    expect(remotion).toContain('Visual verification is required for transitions, subtitles')
    expect(remotion).toContain('function Composition(props)')
    expect(remotion).not.toContain('function Design(props)')
    expect(coding).not.toContain('ALL`run_code` output')
    expect(coding).not.toContain('ALL** `run_code` output')
    expect(agentTs).toContain('\\`type: "files"\\` outputs are already saved workspace files')
    expect(agentTs).toContain("z.enum(['composition', 'design', 'node'])")
    expect(agentTs).toContain('not individual binary outputs from type:"files"')
    expect(agentTs).toContain('mediaResult.type === \'video\'')
  })

  it('keeps agent-visible media context on composition terminology', () => {
    expect(agentContext).toContain("isComposition ? 'composition' : 'image'")
    expect(agentContext).toContain('[composition code: ')
    expect(agentContext).toContain('[COMPOSITION MODE]')
    expect(agentContext).toContain('[Current Composition]')
    expect(agentContext).toContain('[Composition Editable State]')
    expect(agentContext).toContain('runtime: "composition"')
    expect(agentContext).toContain('code_path')
    expect(agentContext).toContain('normalizeLegacyCompositionDescription')
    expect(agentContext).toContain("normalizeLegacyCompositionDescription(s.description, '[Remotion composition]')")
    expect(agentContext).not.toContain('[code: ')
    expect(agentContext).not.toContain('[DESIGN MODE]')
    expect(agentContext).not.toContain('[Current Design]')
    expect(agentContext).not.toContain('[Design Editable State]')

    expect(agentTs).toContain('[Current composition pointer]')
    expect(agentTs).toContain('currentDesignPath')
    expect(agentTs).toContain('code_path')
    expect(agentTs).toContain('Capture a screenshot of a Remotion composition')
    expect(agentTs).toContain('Patch failed: no base composition')
    expect(agentTs).toContain('Composition ready')
    expect(agentTs).toContain('Draft is not saved yet')
    expect(agentTs).toContain('publish: false')
    expect(agentTs).toContain('call preview_frame before telling the user it is complete')
    expect(agentTs).toContain('resolveMediaMarkersInValue')
    expect(designHarness).toContain('unresolved Media Index placeholder')
    expect(agentTs).not.toContain('[Current Remotion composition code')
    expect(agentTs).not.toContain('[Current design code')
    expect(agentTs).not.toContain('Capture a screenshot of a design')
    expect(agentTs).not.toContain('No design found')
    expect(agentTs).not.toContain('Design ready')

    expect(editor).toContain("isComposition ? 'composition' : 'image'")
    expect(editor).toContain("normalizeLegacyCompositionDescription(s.description, '[composition]')")
    expect(editor).toContain('current Remotion composition via run_code patch')
    expect(editor).not.toContain("description: designDesc || '[design]'")
    expect(editor).not.toContain('current design via run_code patch')

    expect(agentRoute).toContain('latest Remotion composition code')
    expect(agentRoute).not.toContain('latest design code')
  })

  it('keeps generic image/layout routing away from Remotion design terminology', () => {
    expect(agent).toContain('layout/mockup image generation')
    expect(agent).toContain('generic layout/mockup/image tasks')
    expect(generateImageTool).toContain('layout/mockup images')
    expect(generateImageTool).toContain('multi-turn layout/mockup image tasks')
    expect(image).toContain('images, videos, Remotion compositions, and node media work')
    expect(coding).toContain('generic layout/mockup/image tasks')
    expect(agent).not.toContain('design/layout generation')
    expect(generateImageTool).not.toContain('design/layout images')
    expect(generateImageTool).not.toContain('multi-turn design tasks')

    expect(designHarness).toContain('Composition rejected')
    expect(designHarness).toContain('Composition compile error')
    expect(designHarness).not.toContain('Design rejected')
    expect(designHarness).not.toContain('Design compile error')
  })

  it('documents the new long-video FFmpeg state machine', () => {
    const required = [
      'Long-video state machine',
      'probe_source',
      'split_source',
      'generate_chunks',
      'collect_outputs',
      'assemble_outputs',
      'publish_final',
      'Do not run the same split again',
      'Never publish source chunks as timeline snapshots',
      'do not start a second `run_code` just to re-open a file from the previous temp directory',
      'return both URLs from the first `type: "files"` run and stop',
      'the `run_code` tool call must include those 1-based indices as `media_refs`',
      'use Remotion composition instead',
      'do not spend a separate `run_code` call only to probe before a simple split',
      'inputFiles[0].duration',
      'explicit user-stated cut points',
      'if (inputFiles.length < 2)',
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
