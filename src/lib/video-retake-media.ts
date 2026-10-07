import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { findFfmpeg, probeVideoFile, type VideoProbe } from './ffmpeg-runtime'
import type { RetakePlan } from './video-retake-contract'

const exec = promisify(execFile)
async function withFiles<T>(files: Record<string, Buffer>, run: (dir: string, ffmpeg: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'makaron-retake-'))
  try {
    await Promise.all(Object.entries(files).map(([name, bytes]) => writeFile(join(dir, name), bytes)))
    return await run(dir, await findFfmpeg())
  } finally { await rm(dir, { recursive: true, force: true }) }
}

export async function inspectRetakeSource(source: Buffer): Promise<VideoProbe> {
  return withFiles({ 'source.mp4': source }, async dir => {
    const meta = await probeVideoFile(join(dir, 'source.mp4'), true)
    if (!meta.duration || !meta.width || !meta.height || !meta.fps) throw new Error('Cannot measure the source video.')
    if (meta.duration > 120 || meta.fps < 1 || meta.fps > 60) throw new Error('Retake supports source videos up to 120 seconds and 60 fps.')
    return meta
  })
}

export async function extractRetakeContext(source: Buffer, plan: RetakePlan): Promise<Buffer> {
  return withFiles({ 'source.mp4': source }, async (dir, ffmpeg) => {
    const output = join(dir, 'context.mp4')
    // Accurate decode-based cut; scaling avoids provider reference size limits.
    await exec(ffmpeg, ['-v', 'error', '-y', '-protocol_whitelist', 'file,pipe', '-i', join(dir, 'source.mp4'), '-ss', String(plan.contextStart),
      '-t', String(plan.contextEnd - plan.contextStart), '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "fps=30,scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output],
      { timeout: 120_000, maxBuffer: 1024 * 1024 })
    return readFile(output)
  })
}

/** Replace only selected frames. The original complete audio bed is mapped once. */
export async function assembleRetake(source: Buffer, patch: Buffer, plan: RetakePlan): Promise<{ bytes: Buffer; meta: VideoProbe }> {
  return withFiles({ 'source.mp4': source, 'patch.mp4': patch }, async (dir, ffmpeg) => {
    const [meta, generated] = await Promise.all([probeVideoFile(join(dir, 'source.mp4'), true), probeVideoFile(join(dir, 'patch.mp4'), true)])
    if (!meta.fps || !meta.width || !meta.height || !meta.duration || !generated.duration) throw new Error('Cannot measure Retake output.')
    const fps = meta.fps, startFrame = Math.round(plan.start * fps), endFrame = Math.round(plan.end * fps)
    const totalFrames = Math.round(meta.duration * fps), replacementFrames = endFrame - startFrame
    if (replacementFrames <= 0) throw new Error('Retake interval is shorter than one source frame.')
    const contextLength = plan.contextEnd - plan.contextStart
    // LTX may return the whole contextual clip or only the retaken interval.
    const selectedOnly = plan.model === 'ltx-2.3-retake' && Math.abs(generated.duration - (plan.end - plan.start)) < 2 / fps
      && Math.abs(contextLength - (plan.end - plan.start)) > 2 / fps
    if (plan.model === 'ltx-2.3-retake' && !selectedOnly && Math.abs(generated.duration - contextLength) > .3) {
      throw new Error('LTX returned an unexpected duration; retain this task for delivery reconciliation.')
    }
    const fittedDuration = selectedOnly ? plan.end - plan.start : contextLength
    const offset = selectedOnly ? 0 : plan.patchOffset
    const scale = `scale=${meta.width}:${meta.height}:force_original_aspect_ratio=decrease,pad=${meta.width}:${meta.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`
    const graph = [
      `[1:v]setpts=${fittedDuration / generated.duration}*(PTS-STARTPTS),fps=${fps},${scale},trim=start=${offset},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${replacementFrames},setpts=PTS-STARTPTS[p]`,
    ]
    const legs: string[] = []
    if (startFrame > 0) { graph.push(`[0:v]fps=${fps},trim=end_frame=${startFrame},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[b]`); legs.push('[b]') }
    legs.push('[p]')
    if (endFrame < totalFrames) { graph.push(`[0:v]fps=${fps},trim=start_frame=${endFrame}:end_frame=${totalFrames},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[a]`); legs.push('[a]') }
    graph.push(`${legs.join('')}concat=n=${legs.length}:v=1:a=0[v]`)
    const output = join(dir, 'final.mp4')
    await exec(ffmpeg, ['-v', 'error', '-y', '-protocol_whitelist', 'file,pipe', '-i', join(dir, 'source.mp4'), '-protocol_whitelist', 'file,pipe', '-i', join(dir, 'patch.mp4'),
      '-filter_complex', graph.join(';'), '-map', '[v]', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-r', String(fps), '-fps_mode', 'cfr', '-c:a', 'copy', '-t', String(meta.duration), '-movflags', '+faststart', output],
      { timeout: 180_000, maxBuffer: 1024 * 1024 })
    const finalMeta = await probeVideoFile(output)
    if (!finalMeta.duration || Math.abs(finalMeta.duration - meta.duration) > Math.max(.1, 2 / fps)
      || finalMeta.width !== meta.width || finalMeta.height !== meta.height || (meta.audioCodec && !finalMeta.audioCodec)) {
      throw new Error('Retake delivery failed duration, dimensions or original-audio verification.')
    }
    return { bytes: await readFile(output), meta: finalMeta }
  })
}
