import { open, stat } from 'fs/promises'
import type { Sandbox } from '@vercel/sandbox'

// SDK 1.x retains both the inputs and the complete gzip request body.
// Two independently compressed batches can overlap without holding a whole video.
const BATCH_BYTES = 16 * 1024 * 1024
const UPLOAD_CONCURRENCY = 2

interface InputSlice {
  local: string
  remote: string
  offset: number
  length: number
  version: { ino: number; size: number; mtimeMs: number }
}

export interface SandboxInputUpload {
  batches: InputSlice[][]
  partCounts: number[]
  totalBytes: number
}

export async function planSandboxInputUpload(files: { local: string; remote: string }[]): Promise<SandboxInputUpload> {
  const batches: InputSlice[][] = [[]]
  const partCounts: number[] = []
  let batchBytes = 0
  let totalBytes = 0
  for (const file of files) {
    const version = await stat(file.local)
    const { size } = version
    const parts = Math.max(1, Math.ceil(size / BATCH_BYTES))
    partCounts.push(parts)
    totalBytes += size
    for (let part = 0; part < parts; part++) {
      const offset = part * BATCH_BYTES
      const length = Math.min(size - offset, BATCH_BYTES)
      if (batchBytes + length > BATCH_BYTES) {
        batches.push([])
        batchBytes = 0
      }
      batches[batches.length - 1].push({
        local: file.local,
        remote: parts === 1 ? file.remote : `${file.remote}.part-${part}`,
        offset,
        length,
        version,
      })
      batchBytes += length
    }
  }
  return { batches, partCounts, totalBytes }
}

async function readSlice(slice: InputSlice): Promise<Buffer> {
  const handle = await open(slice.local, 'r')
  try {
    const buffer = Buffer.allocUnsafe(slice.length)
    let read = 0
    while (read < buffer.length) {
      const { bytesRead } = await handle.read(buffer, read, buffer.length - read, slice.offset + read)
      if (!bytesRead) throw new Error('Sandbox input was truncated during upload')
      read += bytesRead
    }
    const current = await handle.stat()
    if (current.ino !== slice.version.ino || current.size !== slice.version.size || current.mtimeMs !== slice.version.mtimeMs) {
      throw new Error('Sandbox input changed during upload')
    }
    return buffer
  } finally {
    await handle.close()
  }
}

export async function uploadMediaSandboxInputs(
  sandbox: Pick<Sandbox, 'writeFiles'>,
  plan: SandboxInputUpload,
  setupFiles: { path: string; content: string }[],
): Promise<void> {
  let next = 0
  const controller = new AbortController()
  async function upload() {
    while (next < plan.batches.length && !controller.signal.aborted) {
      const index = next++
      const files: { path: string; content: Buffer | string }[] = []
      for (const slice of plan.batches[index]) {
        files.push({ path: slice.remote, content: await readSlice(slice) })
      }
      if (index === 0) files.push(...setupFiles)
      await sandbox.writeFiles(files, { signal: controller.signal })
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
