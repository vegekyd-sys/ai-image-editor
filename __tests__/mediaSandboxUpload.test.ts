import { mkdtemp, rm, truncate, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, expect, it, vi } from 'vitest'
import { planSandboxInputUpload, uploadMediaSandboxInputs } from '@/lib/media-sandbox-upload'

const dirs: string[] = []
async function inputDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'media-staging-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

it('retains the single SDK write for small files, empty files and runner setup', async () => {
  const dir = await inputDir()
  const inputs = ['small', 'empty'].map(name => ({ local: path.join(dir, name), remote: name }))
  await writeFile(inputs[0].local, 'abc')
  await writeFile(inputs[1].local, '')
  const plan = await planSandboxInputUpload(inputs)
  const writeFiles = vi.fn(async () => {})
  await uploadMediaSandboxInputs({ writeFiles }, plan, [{ path: 'runner', content: 'source' }])
  expect(plan.partCounts).toEqual([1, 1])
  expect(writeFiles).toHaveBeenCalledTimes(1)
  expect(writeFiles).toHaveBeenCalledWith([
    { path: 'small', content: Buffer.from('abc') },
    { path: 'empty', content: Buffer.alloc(0) },
    { path: 'runner', content: 'source' },
  ], expect.anything())
})

it('preserves every byte and input alias across bounded, overlapping writes', async () => {
  const dir = await inputDir()
  const local = path.join(dir, 'video')
  const limit = 16 * 1024 * 1024
  const data = Buffer.alloc(limit + 4, 123)
  data.write('tail', limit)
  await writeFile(local, data)
  const inputs = ['ref', 'workspace'].map(remote => ({ local, remote }))
  const plan = await planSandboxInputUpload(inputs)
  const parts = new Map<string, Uint8Array | string>()
  let active = 0
  let peak = 0
  let releaseFirst!: () => void
  const overlap = new Promise<void>(resolve => { releaseFirst = resolve })
  await uploadMediaSandboxInputs({
    async writeFiles(files) {
      active++
      peak = Math.max(peak, active)
      if (active === 2) releaseFirst()
      await overlap
      expect(files.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0)).toBeLessThanOrEqual(limit)
      for (const file of files) parts.set(file.path, file.content)
      active--
    },
  }, plan, [])
  expect(peak).toBe(2)
  expect(plan.partCounts).toEqual([2, 2])
  for (const { remote } of inputs) {
    expect(Buffer.compare(Buffer.concat([
      parts.get(remote + '.part-0') as Uint8Array,
      parts.get(remote + '.part-1') as Uint8Array,
    ]), data)).toBe(0)
  }
})

it('rejects a changed source before executing the agent with partial bytes', async () => {
  const dir = await inputDir()
  const local = path.join(dir, 'video')
  await writeFile(local, 'original')
  const plan = await planSandboxInputUpload([{ local, remote: 'input' }])
  await truncate(local, 2)
  const writeFiles = vi.fn(async () => {})
  await expect(uploadMediaSandboxInputs({ writeFiles }, plan, [])).rejects.toThrow('truncated')
  expect(writeFiles).not.toHaveBeenCalled()
})
