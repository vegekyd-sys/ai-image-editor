import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'
import { afterEach, describe, expect, it } from 'vitest'
import { findFfmpeg, probeVideoFile } from '@/lib/ffmpeg-runtime'
import {
  providerVideoBufferNeedsSdrToneMap,
  providerVideoNeedsSdrToneMap,
  shouldInspectProviderVideoColor,
  transcodeVideoBufferToSdrMp4,
} from '@/lib/provider-video-reference'

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('provider video color normalization', () => {
  it('inspects MP4 references instead of relying on MOV extensions', () => {
    expect(shouldInspectProviderVideoColor('https://cdn.example.com/reference.mp4')).toBe(true)
    expect(shouldInspectProviderVideoColor('https://cdn.example.com/reference', 'video/mp4')).toBe(true)
    expect(shouldInspectProviderVideoColor('https://cdn.example.com/provider-inputs/normalized.mp4')).toBe(false)
    expect(shouldInspectProviderVideoColor('https://cdn.example.com/reference.jpg', 'image/jpeg')).toBe(false)
  })

  it('recognizes the HDR metadata emitted by iPhone HLG and Dolby Vision video', () => {
    expect(providerVideoNeedsSdrToneMap({
      colorTransfer: 'arib-std-b67',
      colorPrimaries: 'bt2020',
      colorSpace: 'bt2020nc',
    })).toBe(true)
    expect(providerVideoNeedsSdrToneMap({ colorTransfer: 'smpte2084' })).toBe(true)
    expect(providerVideoNeedsSdrToneMap({ hasDolbyVision: true })).toBe(true)
    expect(providerVideoNeedsSdrToneMap({
      colorTransfer: 'bt709',
      colorPrimaries: 'bt2020',
      colorSpace: 'bt2020nc',
      pixelFormat: 'yuv420p',
    })).toBe(false)
    expect(providerVideoNeedsSdrToneMap({
      colorTransfer: 'bt709',
      colorPrimaries: 'bt709',
      colorSpace: 'bt709',
    })).toBe(false)
  })

  it('tone maps HLG into explicitly tagged SDR BT.709', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'provider-video-test-'))
    temporaryDirectories.push(dir)
    const input = path.join(dir, 'input-hlg.mp4')
    const output = path.join(dir, 'output-sdr.mp4')
    const ffmpeg = await findFfmpeg()
    await execFileAsync(ffmpeg, [
      '-hide_banner',
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=white:s=64x64:d=0.4:r=5',
      '-vf', 'setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-color_primaries', 'bt2020',
      '-color_trc', 'arib-std-b67',
      '-colorspace', 'bt2020nc',
      '-an',
      input,
    ], { timeout: 30_000 })

    const inputBuffer = await fs.readFile(input)
    expect(await providerVideoBufferNeedsSdrToneMap(inputBuffer)).toBe(true)
    const converted = await transcodeVideoBufferToSdrMp4(inputBuffer)
    await fs.writeFile(output, converted)
    const probe = await probeVideoFile(output)
    const video = (probe.streams || []).find((stream) => {
      return typeof stream === 'object'
        && stream !== null
        && (stream as { codec_type?: unknown }).codec_type === 'video'
    }) as {
      color_transfer?: string
      color_primaries?: string
      color_space?: string
      pix_fmt?: string
    }

    expect(video.color_transfer).toBe('bt709')
    expect(video.color_primaries).toBe('bt709')
    expect(video.color_space).toBe('bt709')
    expect(video.pix_fmt).toBe('yuv420p')
  })
})
