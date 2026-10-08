import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { findFfmpeg, probeVideoFile, type VideoProbe } from './ffmpeg-runtime'
import type { RetakePlan } from './video-retake-contract'
import { retakeInspectionTimestamps } from './video-retake-inspection'

const exec = promisify(execFile)
async function withFiles<T>(files: Record<string, Buffer>, run: (dir: string, ffmpeg: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'makaron-retake-'))
  try {
    await Promise.all(Object.entries(files).map(([name, bytes]) => writeFile(join(dir, name), bytes)))
    return await run(dir, await findFfmpeg())
  } finally { await rm(dir, { recursive: true, force: true }) }
}

async function probeRetakeVideoFile(file: string): Promise<VideoProbe> {
  const meta = await probeVideoFile(file,true)
  if (!meta.frameCount && meta.fps) {
    // FFmpeg is bundled in serverless; FFprobe may be absent. Count video
    // packets without decoding so audio padding cannot invent video frames.
    const {stdout} = await exec(await findFfmpeg(),['-v','error','-protocol_whitelist','file,pipe','-i',file,
      '-map','0:v:0','-c:v','copy','-an','-progress','pipe:1','-nostats','-f','null','-'],
      {timeout:120_000,maxBuffer:1024*1024})
    const count = Array.from(stdout.matchAll(/^frame=(\d+)/gm),match=>Number(match[1])).at(-1)
    if (!count) throw new Error('Cannot count the actual source video frames.')
    meta.frameCount = count
  }
  return meta
}

export async function inspectRetakeSource(source: Buffer): Promise<VideoProbe> {
  return withFiles({ 'source.mp4': source }, async dir => {
    const meta = await probeRetakeVideoFile(join(dir, 'source.mp4'))
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

/** The container can outlast its video track because of audio padding. */
async function lastSourceFrameTime(file: string, fps: number): Promise<number> {
  const meta = await probeRetakeVideoFile(file)
  const video = (meta.streams as Array<{ codec_type?: string; duration?: string }> | undefined)?.find(stream => stream.codec_type === 'video')
  const videoDuration = Number(video?.duration)
  const duration = videoDuration > 0 ? videoDuration : meta.frameCount ? meta.frameCount / fps : meta.duration
  if (!duration) throw new Error('Cannot measure the last video frame.')
  // Round down so a millisecond timestamp never seeks past the final frame.
  return Math.max(0, Math.floor((duration - 1 / fps) * 1000) / 1000)
}

const stillFilter = "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuvj420p"

async function extractSourceStill(dir: string, ffmpeg: string, time: number, output: string, duration: number) {
  await exec(ffmpeg, ['-v','error','-y','-protocol_whitelist','file,pipe','-ss',String(time),
    '-i',join(dir,'source.mp4'),'-frames:v','1','-vf',stillFilter,'-q:v','3','-threads','1',output],
    {timeout:120_000,maxBuffer:1024*1024})
  try { return {image:await readFile(output),time} } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || time < duration - 2) throw error
  }
  // Serverless may have FFmpeg without FFprobe: container duration includes
  // audio padding. Decode only the tail and keep its last actual video frame.
  const {stderr} = await exec(ffmpeg,['-v','info','-y','-protocol_whitelist','file,pipe','-sseof','-2','-copyts',
    '-i',join(dir,'source.mp4'),'-map','0:v:0','-an','-vf',stillFilter+',showinfo',
    '-fps_mode','passthrough','-q:v','3','-threads','1','-f','image2','-update','1',output],
    {timeout:120_000,maxBuffer:2*1024*1024})
  const samples = Array.from(stderr.matchAll(/pts_time:([\d.-]+)/g),match=>Number(match[1]))
  const actualTime = samples.at(-1)
  if (actualTime == null || !Number.isFinite(actualTime) || actualTime < 0 || actualTime > time + .1) {
    throw new Error('Cannot locate the actual source tail frame.')
  }
  return {image:await readFile(output),time:Number(actualTime.toFixed(3))}
}

/** Download once and extract the entire inspection sheet from one local source. */
export async function extractRetakeInspectionFrames(source: Buffer, plan: RetakePlan, fps: number) {
  return withFiles({ 'source.mp4': source }, async (dir, ffmpeg) => {
    const last = await lastSourceFrameTime(join(dir, 'source.mp4'), fps)
    const timestamps = [...new Set(retakeInspectionTimestamps(plan, fps).map(time => Math.min(time, last)))]
    const sampled = await Promise.all(timestamps.map((time,index) =>
      extractSourceStill(dir,ffmpeg,time,join(dir,`inspection-${index}.jpg`),plan.sourceDuration)))
    return {timestamps:sampled.map(frame=>frame.time),frames:sampled.map(frame=>frame.image)}
  })
}

/** A source-led still for the Agent's Retake camera/content keyframe edit. */
export async function extractRetakeSourceFrame(source: Buffer, time: number): Promise<Buffer> {
  return withFiles({ 'source.mp4': source }, async (dir, ffmpeg) => {
    const output = join(dir, 'frame.jpg')
    const meta = await probeRetakeVideoFile(join(dir, 'source.mp4'))
    const last = await lastSourceFrameTime(join(dir, 'source.mp4'), meta.fps || 30)
    const sampleTime = Math.min(time, last)
    return (await extractSourceStill(dir,ffmpeg,sampleTime,output,meta.duration!)).image
  })
}

/** New H3 outputs represent only the selection; legacy jobs retain context anchors. */
export async function extractRetakeBoundaryFrames(source: Buffer, plan: RetakePlan, fps: number): Promise<{ start: Buffer; end: Buffer }> {
  if (!Number.isFinite(fps) || fps < 1) throw new Error('Boundary frames require a measured source frame rate.')
  return withFiles({ 'source.mp4': source }, async (dir, ffmpeg) => {
    const start = plan.outputMode === 'selection' ? Math.round(plan.start * fps) / fps : plan.contextStart
    const end = plan.outputMode === 'selection' ? (Math.round(plan.end * fps) - 1) / fps : plan.contextEnd - 1 / fps
    const last = await lastSourceFrameTime(join(dir, 'source.mp4'), fps)
    const frames = await Promise.all([Math.min(start,last),Math.min(Math.max(start,end),last)].map((time,index)=>
      extractSourceStill(dir,ffmpeg,time,join(dir,`boundary-${index}.jpg`),plan.sourceDuration)))
    return {start:frames[0].image,end:frames[1].image}
  })
}

/** Replace only selected frames. The original complete audio bed is mapped once. */
export async function assembleRetake(source: Buffer, patch: Buffer, plan: RetakePlan): Promise<{ bytes: Buffer; meta: VideoProbe }> {
  return withFiles({ 'source.mp4': source, 'patch.mp4': patch }, async (dir, ffmpeg) => {
    const [meta, generated] = await Promise.all([probeRetakeVideoFile(join(dir, 'source.mp4')), probeRetakeVideoFile(join(dir, 'patch.mp4'))])
    if (!meta.fps || !meta.width || !meta.height || !meta.duration || !generated.duration) throw new Error('Cannot measure Retake output.')
    const fps = meta.fps, startFrame = Math.round(plan.start * fps), endFrame = Math.round(plan.end * fps)
    const totalFrames = Math.round(meta.duration * fps), replacementFrames = endFrame - startFrame
    if (replacementFrames <= 0) throw new Error('Retake interval is shorter than one source frame.')
    const contextLength = plan.contextEnd - plan.contextStart
    const fittedDuration = contextLength
    const offset = plan.patchOffset
    const scale = `scale=${meta.width}:${meta.height}:force_original_aspect_ratio=decrease,pad=${meta.width}:${meta.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`
    // Selection output: fit the entire generated action, retaining its actual
    // first/last frames even when provider audio outlasts the video track.
    const generatedFrames = generated.frameCount || Math.round(generated.duration * (generated.fps || fps))
    const selectionPatch = replacementFrames === 1
      ? `[1:v]${scale},trim=end_frame=1,setpts=PTS-STARTPTS[p]`
      : replacementFrames === 2
      ? `[1:v]${scale},split=2[pf][pl];[pf]trim=end_frame=1,setpts=PTS-STARTPTS[pfirst];[pl]trim=start_frame=${generatedFrames - 1},trim=end_frame=1,setpts=PTS-STARTPTS[plast];[pfirst][plast]concat=n=2:v=1:a=0,setpts=N/(${fps}*TB)[p]`
      : `[1:v]${scale},split=3[pf][pm][pl];[pf]trim=end_frame=1,setpts=PTS-STARTPTS[pfirst];[pm]setpts=${(replacementFrames - 1) / fps / Math.max(1, generatedFrames - 1)}*N/TB,fps=${fps},trim=start_frame=1:end_frame=${replacementFrames - 1},setpts=PTS-STARTPTS[pmid];[pl]trim=start_frame=${generatedFrames - 1},trim=end_frame=1,setpts=PTS-STARTPTS[plast];[pfirst][pmid][plast]concat=n=3:v=1:a=0,setpts=N/(${fps}*TB)[p]`
    const graph = [
      plan.outputMode === 'selection' ? selectionPatch : `[1:v]setpts=${fittedDuration / generated.duration}*(PTS-STARTPTS),fps=${fps},${scale},trim=start=${offset},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${replacementFrames},setpts=PTS-STARTPTS[p]`,
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
