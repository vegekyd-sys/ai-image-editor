import { describe, expect, it } from 'vitest'
import { existsSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as workspace from '@/lib/workspace'
import { runNodeMediaCode } from '@/lib/media-sandbox'
import { filterWorkspaceFilesForAgentScope } from '@/lib/agent-workspace-scope'

function createFakeSupabase() {
  const rows: Array<Record<string, unknown>> = []
  const uploads: Array<{ storagePath: string; body: string | Buffer; contentType?: string }> = []

  const workspaceQuery = () => {
    let likePattern = ''
    const query = {
      select: () => query,
      or: () => query,
      like: (_column: string, pattern: string) => {
        likePattern = pattern
        return query
      },
      order: async () => ({
        data: rows.filter(row => {
          if (!likePattern) return true
          const regex = new RegExp(`^${likePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`)
          return regex.test(String(row.path || ''))
        }),
        error: null,
      }),
      upsert: async (row: Record<string, unknown>) => {
        const index = rows.findIndex(existing => existing.user_id === row.user_id && existing.path === row.path)
        if (index >= 0) rows[index] = { ...rows[index], ...row }
        else rows.push(row)
        return { error: null }
      },
      delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }
    return query
  }

  return {
    rows,
    uploads,
    storage: {
      from: () => ({
        upload: async (storagePath: string, body: string | Buffer, options: { contentType?: string }) => {
          uploads.push({ storagePath, body, contentType: options.contentType })
          return { error: null }
        },
        getPublicUrl: (storagePath: string) => ({
          data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/images/${storagePath}` },
        }),
        remove: async () => ({ error: null }),
      }),
    },
    from: (table: string) => {
      if (table !== 'workspace_files') throw new Error(`Unexpected table: ${table}`)
      return workspaceQuery()
    },
  }
}

describe('local-first workspace runtime', () => {
  it('scopes default file listing to the current project while preserving explicit pattern searches', () => {
    const files = [
      { path: 'project-1/media/source.mp4' },
      { path: 'projects/project-1/notes/shot.md' },
      { path: 'project-2/media/other.mp4' },
      { path: 'skills/video-ffmpeg-lab/SKILL.md', isBuiltIn: true },
      { path: 'memory/style.md' },
      { path: 'prompts/image.md' },
    ]

    expect(filterWorkspaceFilesForAgentScope(files, 'project-1').map(file => file.path)).toEqual([
      'project-1/media/source.mp4',
      'projects/project-1/notes/shot.md',
      'skills/video-ffmpeg-lab/SKILL.md',
      'memory/style.md',
      'prompts/image.md',
    ])

    expect(filterWorkspaceFilesForAgentScope(files, 'project-1', 'project-2/*').map(file => file.path)).toEqual([
      'project-1/media/source.mp4',
      'projects/project-1/notes/shot.md',
      'project-2/media/other.mp4',
      'skills/video-ffmpeg-lab/SKILL.md',
      'memory/style.md',
      'prompts/image.md',
    ])
  })

  it('writes workspace files to a local mirror before persisting them', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'makaron-workspace-local-test-'))
    const previousCacheDir = process.env.MAKARON_WORKSPACE_CACHE_DIR
    process.env.MAKARON_WORKSPACE_CACHE_DIR = cacheDir
    const supabase = createFakeSupabase()

    try {
      const result = await workspace.writeFile(
        'project-1/media/clip.mp4',
        Buffer.from('fake mp4 bytes'),
        supabase,
        'user-1',
        'video/mp4',
      )

      expect(result.success).toBe(true)
      expect(result.localPath).toBe(workspace.getLocalWorkspacePath('user-1', 'project-1/media/clip.mp4'))
      expect(existsSync(result.localPath!)).toBe(true)

      const handle = await workspace.resolveWorkspaceFile('project-1/media/clip.mp4', supabase, 'user-1')
      expect(handle).toMatchObject({
        path: 'project-1/media/clip.mp4',
        contentType: 'video/mp4',
        localAvailable: true,
      })
      expect(handle?.localPath).toBe(result.localPath)

      const listed = await workspace.listFiles(undefined, supabase, 'user-1')
      expect(listed.find(file => file.path === 'project-1/media/clip.mp4')).toMatchObject({
        localAvailable: true,
        localPath: result.localPath,
      })

      const read = await workspace.readFile('project-1/media/clip.mp4', supabase, 'user-1')
      expect(read).toMatchObject({
        contentType: 'video/mp4',
        localPath: result.localPath,
      })
      expect(read?.content).toContain('data:video/mp4;base64,')
      expect(supabase.uploads).toHaveLength(1)
    } finally {
      if (previousCacheDir == null) delete process.env.MAKARON_WORKSPACE_CACHE_DIR
      else process.env.MAKARON_WORKSPACE_CACHE_DIR = previousCacheDir
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('resolves workspace_paths into local inputFiles for node media code', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'makaron-workspace-runtime-test-'))
    const previousCacheDir = process.env.MAKARON_WORKSPACE_CACHE_DIR
    process.env.MAKARON_WORKSPACE_CACHE_DIR = cacheDir
    const supabase = createFakeSupabase()

    try {
      const write = await workspace.writeFile(
        'project-1/media/source.txt',
        'hello from workspace',
        supabase,
        'user-1',
        'text/plain',
      )
      expect(write.success).toBe(true)

      const result = await runNodeMediaCode({
        code: `
          const fs = require('fs');
          const content = fs.readFileSync(inputFiles[0].inputPath, 'utf8');
          return { type: 'text', content: JSON.stringify({
            source: inputFiles[0].source,
            workspacePath: inputFiles[0].workspacePath,
            content,
            isLocal: inputFiles[0].inputPath.startsWith(workspaceDir)
          }) };
        `,
        mediaItems: [],
        workspacePaths: ['project-1/media/source.txt'],
        projectId: 'project-1',
        userId: 'user-1',
        supabase,
        timeoutMs: 10_000,
      })

      expect(result.type).toBe('text')
      const payload = JSON.parse(result.content || '{}')
      expect(payload).toEqual({
        source: 'workspace',
        workspacePath: 'project-1/media/source.txt',
        content: 'hello from workspace',
        isLocal: true,
      })
    } finally {
      if (previousCacheDir == null) delete process.env.MAKARON_WORKSPACE_CACHE_DIR
      else process.env.MAKARON_WORKSPACE_CACHE_DIR = previousCacheDir
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('allows broad Node built-ins and media packages in node media code', async () => {
    const result = await runNodeMediaCode({
      code: `
        const { Buffer } = require('buffer');
        const { once } = require('events');
        const timers = require('timers/promises');
        const zlib = require('zlib');
        const sharp = require('sharp');
        const payload = Buffer.from('hello').toString('base64');
        const zipped = zlib.gzipSync('ok');
        await timers.setTimeout(1);
        return { type: 'text', content: JSON.stringify({
          payload,
          hasOnce: typeof once === 'function',
          gzipBytes: zipped.length,
          hasSharp: typeof sharp === 'function'
        }) };
      `,
      mediaItems: [],
      projectId: 'project-1',
      userId: 'user-1',
      timeoutMs: 10_000,
    })

    expect(result.type).toBe('text')
    const payload = JSON.parse(result.content || '{}')
    expect(payload).toMatchObject({
      payload: 'aGVsbG8=',
      hasOnce: true,
      hasSharp: true,
    })
    expect(payload.gzipBytes).toBeGreaterThan(0)
  })

  it('blocks require escapes and filters secret env in node media code', async () => {
    const previousSecret = process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'secret-for-test'
    try {
      const result = await runNodeMediaCode({
        code: `
          let moduleBlocked = false;
          let vmBlocked = false;
          try { require('module'); } catch { moduleBlocked = true; }
          try { require('vm'); } catch { vmBlocked = true; }
          return { type: 'text', content: JSON.stringify({
            moduleBlocked,
            vmBlocked,
            leakedSecret: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
          }) };
        `,
        mediaItems: [],
        projectId: 'project-1',
        userId: 'user-1',
        timeoutMs: 10_000,
      })

      expect(result.type).toBe('text')
      expect(JSON.parse(result.content || '{}')).toEqual({
        moduleBlocked: true,
        vmBlocked: true,
        leakedSecret: false,
      })
    } finally {
      if (previousSecret == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previousSecret
    }
  })
})
