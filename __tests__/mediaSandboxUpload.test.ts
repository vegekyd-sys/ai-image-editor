import { mkdtemp, readFile, rm, truncate, writeFile } from 'fs/promises'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, expect, it, vi } from 'vitest'
import { ASSEMBLE_SANDBOX_INPUTS, planSandboxInputUpload, uploadMediaSandboxInputs } from '@/lib/media-sandbox-upload'

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
  const plan = await planSandboxInputUpload(inputs, [{ path: 'runner', content: 'source' }], dir)
  const writeFiles = vi.fn(async () => {})
  await uploadMediaSandboxInputs({ writeFiles }, plan)
  expect(plan.splitFiles).toBe(0)
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
  const inputs = ['r'.repeat(254), 'workspace'].map(name => ({ local, remote: path.join(dir, name) }))
  // The emoji crosses the proposed UTF-16 slice boundary.
  const text = 'a'.repeat(limit / 4 - 1) + '🧪' + 'x'.repeat(limit)
  const contextPath = path.join(dir, 'context.json')
  const plan = await planSandboxInputUpload(inputs, [{ path: contextPath, content: text }], dir)
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
      await Promise.all(files.map(file => writeFile(file.path, file.content)))
      active--
    },
  }, plan)
  expect(peak).toBe(2)
  expect(plan.splitFiles).toBe(3)
  execFileSync(process.execPath, ['-e', ASSEMBLE_SANDBOX_INPUTS, dir, '3'])
  expect((await readFile(contextPath, 'utf8')) === text).toBe(true)
  for (const { remote } of inputs) expect((await readFile(remote)).equals(data)).toBe(true)
})

it('rejects a changed source before executing the agent with partial bytes', async () => {
  const dir = await inputDir()
  const local = path.join(dir, 'video')
  await writeFile(local, 'original')
  const plan = await planSandboxInputUpload([{ local, remote: 'input' }], [], dir)
  await truncate(local, 2)
  const writeFiles = vi.fn(async () => {})
  await expect(uploadMediaSandboxInputs({ writeFiles }, plan)).rejects.toThrow('truncated')
  expect(writeFiles).not.toHaveBeenCalled()
})
