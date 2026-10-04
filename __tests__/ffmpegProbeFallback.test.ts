import { beforeEach, expect, it, vi } from 'vitest'
const { exec } = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock('child_process', () => ({ execFile: exec, default: { execFile: exec } }))
vi.mock('util', () => {
  const promisify = (fn: (...args: any[]) => unknown) => (...args: unknown[]) => new Promise((resolve, reject) => fn(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr })))
  return { promisify, default: { promisify } }
})
import { probeVideoFile } from '@/lib/ffmpeg-runtime'
beforeEach(() => { exec.mockReset() })
it('measures video and audio headers without decoding when ffprobe is absent', async () => {
  exec.mockImplementation((binary: string, args: string[], _options: unknown, callback: (error: Error | null, stdout?: string, stderr?: string) => void) => {
    if (binary === 'ffprobe') return callback(new Error('ENOENT'))
    if (args[0] === '-version') return callback(null, '', '')
    const stderr = 'Duration: 00:00:10.08, start: 0.000000\nStream #0:0: Video: h264 (High), yuv420p(progressive), 854x480, 24 fps\nStream #0:1: Audio: aac (LC), 48000 Hz';
    callback(Object.assign(new Error('No output specified'), { stderr }), '', stderr)
  })
  expect(await probeVideoFile('/tmp/source.mp4')).toMatchObject({ duration: 10.08, width: 854, height: 480, fps: 24, audioCodec: 'aac' })
  expect(exec).toHaveBeenLastCalledWith('ffmpeg', ['-hide_banner', '-i', '/tmp/source.mp4'], expect.any(Object), expect.any(Function))
})
