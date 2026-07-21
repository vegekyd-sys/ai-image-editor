import { existsSync } from 'fs'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { Sandbox } from '@vercel/sandbox'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MEDIA_SANDBOX_RUNNER_SOURCE,
  runNodeMediaCodeInVercelSandbox,
  shouldUseVercelMediaSandbox,
} from '@/lib/media-sandbox-vercel'

vi.mock('@vercel/sandbox', () => ({
  Sandbox: { create: vi.fn() },
}))

const tempDirs: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(tempDirs.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('isolated Agent Node runtime', () => {
  it('uses Vercel Sandbox automatically in Vercel and when a snapshot is configured', () => {
    expect(shouldUseVercelMediaSandbox({ VERCEL: '1' })).toBe(true)
    expect(shouldUseVercelMediaSandbox({ VERCEL_OIDC_TOKEN: 'token' })).toBe(true)
    expect(shouldUseVercelMediaSandbox({ MEDIA_SANDBOX_SNAPSHOT_ID: 'snap_media' })).toBe(true)
    expect(shouldUseVercelMediaSandbox({ REMOTION_SNAPSHOT_ID: 'snap_remotion' })).toBe(true)
  })

  it('keeps an explicit local escape hatch for development and tests', () => {
    expect(shouldUseVercelMediaSandbox({})).toBe(false)
    expect(shouldUseVercelMediaSandbox({
      VERCEL: '1',
      MEDIA_SANDBOX_EXECUTOR: 'local',
    })).toBe(false)
    expect(shouldUseVercelMediaSandbox({ MEDIA_SANDBOX_EXECUTOR: 'vercel' })).toBe(true)
  })

  it('uses standard Node and installs missing npm packages inside the disposable Sandbox', () => {
    expect(MEDIA_SANDBOX_RUNNER_SOURCE).toContain("const {createRequire} = require('module')")
    expect(MEDIA_SANDBOX_RUNNER_SOURCE).toContain("npm', ['install'")
    expect(MEDIA_SANDBOX_RUNNER_SOURCE).toContain('return entryRequire(id)')
    expect(MEDIA_SANDBOX_RUNNER_SOURCE).not.toContain('ALLOWED_MEDIA_PACKAGES')
    expect(MEDIA_SANDBOX_RUNNER_SOURCE).not.toContain('BLOCKED_NODE_MODULES')
  })

  it('materializes isolated outputs back into the server workspace', async () => {
    const localOutputDir = await mkdtemp(path.join(tmpdir(), 'media-sandbox-vercel-test-'))
    tempDirs.push(localOutputDir)
    const remoteOutput = '/vercel/sandbox/agent-outputs/demo.mp4'
    const outputBody = Buffer.from('mock-mp4-body')
    const fakeSandbox = {
      sandboxId: 'sb_test',
      mkDir: vi.fn(async () => {}),
      writeFiles: vi.fn(async () => {}),
      runCommand: vi.fn(async () => ({
        exitCode: 0,
        stderr: async () => '',
      })),
      readFileToBuffer: vi.fn(async ({ path: filePath }: { path: string }) => {
        if (filePath === '/vercel/sandbox/agent-result.json') {
          return Buffer.from(JSON.stringify({
            result: { type: 'video', path: remoteOutput, contentType: 'video/mp4' },
            outputs: [{ path: remoteOutput, relativePath: 'demo.mp4' }],
          }))
        }
        if (filePath === remoteOutput) return outputBody
        return null
      }),
      stop: vi.fn(async () => {}),
    }
    vi.mocked(Sandbox.create).mockResolvedValue(fakeSandbox as never)

    const execution = await runNodeMediaCodeInVercelSandbox({
      code: 'return {type: "video", path: outputDir + "/demo.mp4"}',
      compiledCode: 'return {type: "video", path: outputDir + "/demo.mp4"}',
      inputFiles: [],
      mediaItems: [],
      mediaRefs: [],
      workspacePaths: [],
      localOutputDir,
      projectId: 'project-test',
      userId: 'user-test',
      timeoutMs: 10_000,
    })

    const localPath = path.join(localOutputDir, 'demo.mp4')
    expect(execution.sandboxId).toBe('sb_test')
    expect(execution.result).toMatchObject({ type: 'video', path: localPath })
    expect(existsSync(localPath)).toBe(true)
    expect(await readFile(localPath)).toEqual(outputBody)
    expect(fakeSandbox.stop).toHaveBeenCalled()
  })
})
