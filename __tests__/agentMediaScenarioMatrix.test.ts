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
  const remotionDirectorContract = read('src/skills/_shared/remotion-director-contract.md')
  const ffmpegSkill = read('src/skills/video-ffmpeg-lab/SKILL.md')
  const agentTs = read('src/lib/agent.ts')
  const agentContext = read('src/lib/agent-context.ts')
  const editor = read('src/components/Editor.tsx')
  const agentDualWriter = read('src/lib/agentDualWriter.ts')
  const useProject = read('src/hooks/useProject.ts')
  const agentRoute = read('src/app/api/agent/route.ts')
  const designHarness = read('src/lib/design-harness.ts')
  const mediaAspect = read('src/lib/media-aspect.ts')
  const compositionDuration = read('src/lib/composition-duration.ts')
  const animateRoute = read('src/app/api/animate/route.ts')
  const videoSnapshotRoute = read('src/app/api/video-snapshot/route.ts')
  const mcpServer = read('src/mcp/server.ts')
  const cli = read('packages/makaron-cli/bin/makaron.mjs')

  it('keeps the core agent prompt as a lightweight router', () => {
    expect(agent.length).toBeLessThan(10_000)
    expect(agent).toContain("read_file('prompts/image.md')")
    expect(agent).toContain("read_file('prompts/animate.md')")
    expect(agent).toContain('`skills/video-ffmpeg-lab/SKILL.md`')
    expect(agent).toContain('Default tool: `generate_image`')
    expect(agent).toContain('Default tool: `generate_animation`')
    expect(agent).toContain('Default tool: `run_code` with `runtime: "node"`')
    expect(agent).toContain('Default tool: `run_code` with `runtime: "composition"`')
    expect(agent).toContain('call `transcribe_audio` first')
    expect(agent).toContain('prompts/remotion-composition.md')
    expect(agent).toContain('skills/_shared/remotion-director-contract.md')
    expect(agent).toContain('Use `generate_music` only when the user asks')
    expect(agentTs).toContain('helper components must receive values through their own parameters')
  })

  it('applies the Remotion director contract to all composition work', () => {
    expect(remotion).toContain('Director Contract')
    expect(remotion).toContain('Every editable Remotion composition must be planned as a video')
    expect(remotion).toContain('skills/_shared/remotion-director-contract.md')
    expect(remotion).toContain('Director layer: purpose, audience, core message')
    expect(remotion).toContain('Composition layer: `function Composition(props)`')
    expect(coding).toContain('skills/_shared/remotion-director-contract.md')
    expect(remotionDirectorContract).toContain('Director Layer vs Composition Layer')
    expect(remotionDirectorContract).toContain('The director layer decides what the viewer experiences over time')
    expect(remotionDirectorContract).toContain('The Remotion composition layer implements that direction')
    expect(remotionDirectorContract).toContain('Do not let the implementation layer invent the creative structure by accident')
    expect(remotionDirectorContract).toContain('Do not default to hero sections, card grids')
    expect(remotionDirectorContract).toContain('The final plan must map cleanly to `<Sequence>` ranges')
    expect(remotionDirectorContract).toContain('skills/_shared/remotion-video-director/references/remotion-patterns.md')
  })

  it('preserves old image scenarios in the dedicated image guide', () => {
    const required = [
      'Snapshot Index',
      'reference_media_indices',
      'Restore From Original Snapshot',
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
    expect(generateImageTool).toContain('`image_refs` is only for workspace asset provider URLs')
    expect(generateImageTool).toContain("Context Mode for `model='openai'`")
  })

  it('prevents Remotion helper components from reading outer props', () => {
    expect(remotion).toContain('Only `Composition(props)` may read `props` directly')
    expect(remotion).toContain('Helper components must receive every value they use as function parameters')
    expect(remotion).toContain('never reference outer `props`')
  })

  it('keeps video generation default on SeeDance Fast while separating standard SeeDance', () => {
    expect(agent).toContain('Default video model follows the app selection, usually SeeDance 2.0 Fast')
    expect(animate).toContain('usually SeeDance 2.0 Fast')
    expect(animate).toContain('Treat `seedance-fast` and standard `seedance` as separate models')
    expect(ffmpegSkill).toContain('| SeeDance | 15s | 15.5s | <=50MB; width/height 300-6000px')
    expect(ffmpegSkill).toContain('Default video model, higher quality')
    expect(ffmpegSkill).toContain('| Kling | 15s | 10.5s | <=200MB; resolution <=2K')
    expect(ffmpegSkill).toContain('Cheaper option, supports base video edit')
    expect(ffmpegSkill).toContain('call `transcribe_audio` before `run_code`')
    expect(ffmpegSkill).not.toContain('Cheaper/default')
  })

  it('keeps native SeeDance text-to-video reachable without generating an intermediate image', () => {
    expect(agent).toContain('SeeDance supports native text-to-video')
    expect(agent).toContain('Do not generate an intermediate image first')
    expect(animate).toContain('zero images means native SeeDance text-to-video')
    expect(animate).toContain('do not call `generate_image` first')
    expect(agentTs).toContain("videoRoute.provider !== 'seedance'")
    expect(animateRoute).toContain("videoRoute.provider !== 'seedance'")
    expect(videoSnapshotRoute).toContain("videoRoute.provider !== 'seedance'")
    expect(mcpServer).toContain("default([]).describe('Optional public image URLs")
    expect(cli).toContain('const isSeedanceModel =')
    expect(cli).toContain('!images.length && !video && !isSeedanceModel')
  })

  it('separates generic coding, Remotion composition, and node media outputs', () => {
    expect(coding).toContain('Generic Coding (run_code)')
    expect(coding).toContain('runtime: "composition"')
    expect(coding).toContain('legacy alias for `runtime: "composition"`')
    expect(coding).toContain('Node Media Runtime')
    expect(coding).toContain('For direct user-facing MP4 requests such as "split this video into two videos"')
    expect(coding).toContain('immediately publish the exported MP4s with `write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: N })`')
    expect(coding).toContain('Intermediate chunks for long-video model-preparation workflows stay as workspace outputs')
    expect(coding).toContain('pass those 1-based indices in the `run_code` tool input as `media_refs`')
    expect(coding).toContain('Two 9:16 videos spliced together must return a 9:16 canvas')
    expect(coding).toContain('Ordinary splice of two existing timeline videos: `runtime: "composition"`, not node.')
    expect(coding).toContain('Do not use node/FFmpeg for ordinary editable timeline splicing of two existing videos')
    expect(coding).toContain('Do not switch from composition to node/FFmpeg as a fallback for ordinary timeline splicing')
    expect(coding).toContain('Failed or imperfect Remotion preview for ordinary splice: patch composition, not node fallback.')
    expect(coding).toContain('[Current Composition]')
    expect(coding).toContain('[Current composition pointer]')
    expect(coding).toContain('code_path')
    expect(coding).not.toContain('[Current design code]')
    expect(coding).not.toContain('[Current Remotion composition code]')
    expect(coding).not.toContain('### Video Designs')
    expect(coding).not.toContain('花字')
    expect(coding).not.toContain('Think like a music video director')
    expect(remotion).toContain('Remotion Composition')
    expect(remotion).toContain('Canvas Aspect Contract')
    expect(remotion).toContain('derive the Remotion canvas from the selected Media Index video dimensions')
    expect(remotion).toContain('Never place 9:16 timeline videos into a 16:9 canvas')
    expect(remotion).toContain('width: 1080')
    expect(remotion).toContain('height: 1920')
    expect(remotion).toContain('Editable Fields')
    expect(remotion).toContain('trimBefore')
    expect(remotion).toContain('<Sequence>')
    expect(remotion).toContain('put two existing timeline videos together')
    expect(remotion).toContain('Do not fall back to FFmpeg/node for ordinary timeline splicing')
    expect(remotion).toContain('Do not leave `<<<media_N>>>` placeholders inside `props.clipA`')
    expect(remotion).toContain('composition draft')
    expect(remotion).toContain('Visual verification is required for transitions, subtitles')
    expect(remotion).toContain('If `preview_frame` returns an image or no explicit textual error')
    expect(remotion).toContain('Do not tell the user a clip is 18s while returning a 20s animation')
    expect(remotion).toContain('function Composition(props)')
    expect(remotion).not.toContain('function Design(props)')
    expect(coding).not.toContain('ALL`run_code` output')
    expect(coding).not.toContain('ALL** `run_code` output')
    expect(agentTs).toContain('\\`type: "files"\\` outputs are already saved workspace files')
    expect(agentTs).toContain("z.enum(['composition', 'design', 'node'])")
    expect(agentTs).toContain('validateCompositionMediaAspect')
    expect(agentTs).toContain('Composition rejected: selected timeline video(s)')
    expect(agentTs).toContain('9:16 sources must return a 9:16 canvas')
    expect(agentTs).toContain('not individual binary outputs from type:"files"')
    expect(agentTs).toContain('Never use node as a fallback for ordinary editable timeline splicing')
    expect(agentTs).toContain('mediaResult.type === \'video\'')
    expect(agentTs).toContain('transcribe_audio')
    expect(agentTs).toContain('transcribeWithVolcengineAsr')
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
    expect(agentContext).toContain('formatVideoMediaSpec(videoMeta)')
    expect(agentContext).toContain('formatTranscriptMediaHint(videoMeta)')
    expect(agentContext).toContain('[ASR transcript cached:')
    expect(agentContext).toContain('videoSpec ? `video, ${videoSpec}`')
    expect(agentContext).toContain("return s.type === 'video' && videoUrl ? videoUrl : (s.image_url || '')")
    expect(agentDualWriter).toContain("case 'preview_frame_captured'")
    expect(agentDualWriter).toContain('messageId: this.currentMessageId')
    expect(useProject).toContain(".eq('type', 'preview_frame_captured')")
    expect(useProject).toContain('previewImagesByMessage')
    expect(agentContext).toContain("normalizeLegacyCompositionDescription(s.description, '[Remotion composition]')")
    expect(agentContext).not.toContain('[code: ')
    expect(agentContext).not.toContain('[DESIGN MODE]')
    expect(agentContext).not.toContain('[Current Design]')
    expect(agentContext).not.toContain('[Design Editable State]')

    expect(agentTs).toContain('[Current composition pointer]')
    expect(agentTs).toContain('currentDesignPath')
    expect(agentTs).toContain('code_path')
    expect(agentTs).toContain('Capture a visual frame at a specific frame number or timestamp')
    expect(agentTs).toContain('raw uploaded/generated videos are extracted with FFmpeg')
    expect(agentTs).toContain('Patch failed: no base composition')
    expect(agentTs).toContain('Composition ready')
    expect(agentTs).toContain('Draft is not saved yet')
    expect(agentTs).toContain('publish: false')
    expect(agentTs).toContain('call preview_frame before telling the user it is complete')
    expect(agentTs).toContain('animation.durationInSeconds matches the final frame count')
    expect(agentTs).toContain('normalizeCompositionAnimation')
    expect(compositionDuration).toContain('inferCompositionTotalFrames')
    expect(agentTs).toContain('resolveMediaMarkersInValue')
    expect(designHarness).toContain('unresolved Media Index placeholder')
    expect(agentTs).not.toContain('[Current Remotion composition code')
    expect(agentTs).not.toContain('[Current design code')
    expect(agentTs).not.toContain('Capture a screenshot of a design')
    expect(agentTs).not.toContain('No design found')
    expect(agentTs).not.toContain('Design ready')

    expect(editor).toContain("isComposition ? 'composition' : 'image'")
    expect(editor).toContain("normalizeLegacyCompositionDescription(s.description, '[composition]')")
    expect(editor).toContain('formatVideoMediaSpec(s.videoMeta)')
    expect(editor).toContain('current Remotion composition via run_code patch')
    expect(agentDualWriter).toContain("description: designDesc || '[composition]'")
    expect(editor).not.toContain("description: designDesc || '[design]'")
    expect(agentDualWriter).not.toContain("description: designDesc || '[design]'")
    expect(editor).not.toContain('current design via run_code patch')

    expect(agentRoute).toContain('latest Remotion composition code')
    expect(agentRoute).not.toContain('latest design code')

    expect(mediaAspect).toContain('formatAspectRatio')
    expect(mediaAspect).toContain('formatVideoMediaSpec')
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
      'Never publish source chunks for model-preparation workflows as timeline snapshots',
      'Direct user-facing split/trim/export requests are different: publish those MP4 deliverables to the timeline',
      'Do not start a second `run_code` just to re-open a file from the previous temp directory',
      'export both from the first `type: "files"` run and publish both to the timeline with `fromWorkspaceOutputs`',
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

  it('new Grok video scenario accepts one image and rejects multi-image references', () => {
    expect(validateVideoScript({
      prompt: 'Shot 1 (1s): Animate <<<media_1>>> with a slow push-in.',
      imageCount: 1,
      model: 'grok',
      duration: 1,
    })).toBeNull()

    expect(validateVideoScript({
      prompt: 'Shot 1 (1s): Blend <<<media_1>>> and <<<media_2>>>.',
      imageCount: 2,
      model: 'grok',
      duration: 1,
    })).toContain('supports at most 1 reference image')
  })
})
