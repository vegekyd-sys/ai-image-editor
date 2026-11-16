import { open, stat } from 'fs/promises'
import type { Stats } from 'fs'
import type { Sandbox } from '@vercel/sandbox'

// SDK 1.x buffers the complete compressed request before making the POST.
const BATCH_BYTES = 16 * 1024 * 1024
const UPLOAD_CONCURRENCY = 2
const READ_CONCURRENCY = 8

export class SandboxInputChangedError extends Error {}

function handleSourceError(error: NodeJS.ErrnoException): never {
  if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new SandboxInputChangedError('Sandbox input is no longer available')
  throw error
}

function checkVersion(current: Stats, expected: Stats) {
  if (current.ino !== expected.ino || current.size !== expected.size || current.mtimeMs !== expected.mtimeMs) {
    throw new SandboxInputChangedError('Sandbox input changed during upload')
  }
}

interface FileSlice {
  local: string
  version: Stats
  offset: number
  length: number
}

interface UploadEntry {
  path: string
  content: string | FileSlice
}

export async function planSandboxInputUpload(
  inputs: { local: string; remote: string }[],
  setup: { path: string; content: string }[],
  stagingDir: string,
) {
  const batches: UploadEntry[][] = [[]]
  let batchBytes = 0
  let inputBytes = 0
  let setupBytes = 0
  let splitFiles = 0

  function add(path: string, content: string | FileSlice) {
    const bytes = typeof content === 'string' ? Buffer.byteLength(content) : content.length
    if (batchBytes + bytes > BATCH_BYTES) {
      batches.push([])
      batchBytes = 0
    }
    batches[batches.length - 1].push({ path, content })
    batchBytes += bytes
  }

  function addFile(target: string, slices: (string | FileSlice)[]) {
    if (slices.length === 1) {
      add(target, slices[0])
      return
    }
    const prefix = stagingDir + '/.makaron-part-' + splitFiles++
    slices.forEach((slice, i) => add(prefix + '.' + i, slice))
    add(prefix + '.json', JSON.stringify({ target, count: slices.length }))
  }

  const versions = await Promise.all(inputs.map(input => stat(input.local).catch(handleSourceError)))
  inputs.forEach(({ local, remote }, i) => {
    const version = versions[i]
    inputBytes += version.size
    const count = Math.max(1, Math.ceil(version.size / BATCH_BYTES))
    addFile(remote, Array.from({ length: count }, (_, part) => {
      const offset = part * BATCH_BYTES
      return { local, version, offset, length: Math.min(BATCH_BYTES, version.size - offset) }
    }))
  })
  for (const file of setup) {
    // Inline media can make the JSON context itself larger than the media files.
    const bytes = Buffer.byteLength(file.content)
    setupBytes += bytes
    if (bytes <= BATCH_BYTES) {
      add(file.path, file.content)
      continue
    }
    const slices: string[] = []
    for (let offset = 0; offset < file.content.length;) {
      let end = Math.min(file.content.length, offset + BATCH_BYTES / 4)
      const last = file.content.charCodeAt(end - 1)
      if (end < file.content.length && last >= 0xd800 && last <= 0xdbff) end--
      slices.push(file.content.slice(offset, end))
      offset = end
    }
    addFile(file.path, slices)
  }
  async function verifyLocalInputs() {
    await Promise.all(inputs.map(async (input, i) => {
      const current = await stat(input.local).catch(handleSourceError)
      checkVersion(current, versions[i])
    }))
  }
  return { batches, splitFiles, inputBytes, setupBytes, verifyLocalInputs }
}

async function readSlice(slice: FileSlice): Promise<Buffer> {
  const handle = await open(slice.local, 'r').catch(handleSourceError)
  try {
    const buffer = Buffer.allocUnsafe(slice.length)
    let read = 0
    while (read < buffer.length) {
      const { bytesRead } = await handle.read(buffer, read, buffer.length - read, slice.offset + read)
      if (!bytesRead) throw new SandboxInputChangedError('Sandbox input was truncated during upload')
      read += bytesRead
    }
    checkVersion(await handle.stat(), slice.version)
    return buffer
  } finally {
    await handle.close()
  }
}

export async function uploadMediaSandboxInputs(
  sandbox: Pick<Sandbox, 'writeFiles'>,
  plan: Awaited<ReturnType<typeof planSandboxInputUpload>>,
  onFirstBatch?: (phase: 'input_batch_read' | 'input_batch_written') => void,
) {
  let next = 0
  const controller = new AbortController()
  async function upload() {
    while (next < plan.batches.length && !controller.signal.aborted) {
      const index = next++
      const entries = plan.batches[index]
      const files: { path: string; content: string | Buffer }[] = []
      for (let offset = 0; offset < entries.length; offset += READ_CONCURRENCY) {
        const group = entries.slice(offset, offset + READ_CONCURRENCY)
        files.push(...await Promise.all(group.map(async ({ path, content }) => ({
          path,
          content: typeof content === 'string' ? content : await readSlice(content),
        }))))
      }
      if (index === 0 && plan.batches.length > 1) onFirstBatch?.('input_batch_read')
      await sandbox.writeFiles(files, { signal: controller.signal })
      if (index === 0 && plan.batches.length > 1) onFirstBatch?.('input_batch_written')
    }
  }
  const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, plan.batches.length) }, upload)
  try {
    await Promise.all(workers)
  } catch (error) {
    controller.abort()
    await Promise.allSettled(workers)
    throw error
  }
}

// Runs before starting the Agent command or its timeout. Intermediate names
// are independent of the original basename and disappear before Agent code runs.
export const ASSEMBLE_SANDBOX_INPUTS = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const {pipeline} = require('node:stream/promises');
async function assemble(dir) {
  const manifests = (await fs.promises.readdir(dir)).filter(name => /^\.makaron-part-\d+\.json$/.test(name));
  if (manifests.length !== Number(process.argv[2])) throw new Error('Missing input manifest');
  for (const name of manifests) {
    const manifest = path.join(dir, name);
    const {target, count} = JSON.parse(await fs.promises.readFile(manifest, 'utf8'));
    for (let i = 0; i < count; i++) {
      const chunk = manifest.slice(0, -5) + '.' + i;
      await pipeline(fs.createReadStream(chunk), fs.createWriteStream(target, {flags: i === 0 ? 'w' : 'a'}));
      await fs.promises.unlink(chunk);
    }
    await fs.promises.unlink(manifest);
  }
}
assemble(process.argv[1]).catch(() => { process.exitCode = 1 });
`
