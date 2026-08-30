import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as workspace from '@/lib/workspace'

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
      delete: () => ({
        eq: (firstColumn: string, firstValue: unknown) => ({
          eq: async (secondColumn: string, secondValue: unknown) => {
            const index = rows.findIndex(row => row[firstColumn] === firstValue && row[secondColumn] === secondValue)
            if (index >= 0) rows.splice(index, 1)
            return { error: null }
          },
        }),
      }),
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

function skillMd(options: { description: string; triggers: string[]; bodyMarker: string }): string {
  return `---
name: memory-restorer
description: >
  ${options.description}
  Preserve the subject's identity and the original photographic era.
metadata:
  makaron:
    triggers:
${options.triggers.map(trigger => `      - ${trigger}`).join('\n')}
    tags: [photo restoration, family archive]
    modelPreference: [gemini]
    referenceImages:
      - assets/reference.jpg
---

# Private workflow

${options.bodyMarker}
`
}

function uploadedIndex(supabase: ReturnType<typeof createFakeSupabase>): Record<string, unknown> {
  const upload = [...supabase.uploads]
    .reverse()
    .find(item => item.storagePath.endsWith('/.makaron-skill-index.json'))
  expect(upload).toBeDefined()
  return JSON.parse(Buffer.isBuffer(upload!.body) ? upload!.body.toString('utf8') : upload!.body)
}

describe('user Skill lightweight manifest index', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    workspace.clearWorkspaceCache()
  })

  it('persists semantic install metadata and refreshes it on SKILL.md updates without exposing the body', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'makaron-user-skill-index-'))
    const previousCacheDir = process.env.MAKARON_WORKSPACE_CACHE_DIR
    process.env.MAKARON_WORKSPACE_CACHE_DIR = cacheDir
    const supabase = createFakeSupabase()
    const initial = skillMd({
      description: 'Restore scratched and faded family photographs from natural-language requests.',
      triggers: ['repair my grandparents photo', '修复褪色的老照片'],
      bodyMarker: 'PRIVATE_INITIAL_BODY_MUST_NOT_ENTER_STARTUP',
    })

    try {
      const installed = await workspace.installSkill({
        skillMd: initial,
        assets: [],
        supabase,
        userId: 'user-1',
      })
      expect(installed).toEqual({ success: true, skillName: 'memory-restorer' })

      const firstIndex = uploadedIndex(supabase)
      expect(firstIndex).toMatchObject({
        schemaVersion: 1,
        name: 'memory-restorer',
        path: 'skills/memory-restorer/SKILL.md',
        contentHashSource: 'skill-md',
        modelPreference: ['gemini'],
        referenceImages: ['assets/reference.jpg'],
      })
      expect(firstIndex.triggers).toEqual(expect.arrayContaining([
        'repair my grandparents photo',
        '修复褪色的老照片',
        'photo restoration',
        'family archive',
      ]))
      expect(firstIndex.contentHash).toMatch(/^[a-f0-9]{64}$/)

      workspace.clearWorkspaceCache()
      const fetchMock = vi.fn(() => {
        throw new Error('startup should use the local lightweight sidecar')
      })
      vi.stubGlobal('fetch', fetchMock)
      const initialManifest = await workspace.getSkillManifest(supabase, 'user-1')
      expect(initialManifest).toContain('Restore scratched and faded family photographs')
      expect(initialManifest).toContain('repair my grandparents photo')
      expect(initialManifest).toContain('修复褪色的老照片')
      expect(initialManifest).toContain('has reference images')
      expect(initialManifest).toContain('prefers: gemini')
      expect(initialManifest).not.toContain('PRIVATE_INITIAL_BODY_MUST_NOT_ENTER_STARTUP')
      expect(fetchMock).not.toHaveBeenCalled()

      const updated = skillMd({
        description: 'Colorize and repair damaged historical portraits while keeping exact identity.',
        triggers: ['colorize this archive portrait', '给这张旧肖像上色'],
        bodyMarker: 'PRIVATE_UPDATED_BODY_MUST_NOT_ENTER_STARTUP',
      })
      const write = await workspace.writeFile(
        'skills/memory-restorer/SKILL.md',
        updated,
        supabase,
        'user-1',
        'text/markdown',
      )
      expect(write.success).toBe(true)
      const updatedIndex = uploadedIndex(supabase)
      expect(updatedIndex.contentHash).not.toBe(firstIndex.contentHash)
      expect(updatedIndex.description).toContain('Colorize and repair damaged historical portraits')

      workspace.clearWorkspaceCache()
      fetchMock.mockClear()
      const updatedManifest = await workspace.getSkillManifest(supabase, 'user-1')
      expect(updatedManifest).toContain('Colorize and repair damaged historical portraits')
      expect(updatedManifest).toContain('colorize this archive portrait')
      expect(updatedManifest).not.toContain('Restore scratched and faded family photographs')
      expect(updatedManifest).not.toContain('PRIVATE_UPDATED_BODY_MUST_NOT_ENTER_STARTUP')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      if (previousCacheDir == null) delete process.env.MAKARON_WORKSPACE_CACHE_DIR
      else process.env.MAKARON_WORKSPACE_CACHE_DIR = previousCacheDir
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('backfills a legacy Skill once from bounded frontmatter, then loads its full body only after selection', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'makaron-legacy-skill-index-'))
    const previousCacheDir = process.env.MAKARON_WORKSPACE_CACHE_DIR
    process.env.MAKARON_WORKSPACE_CACHE_DIR = cacheDir
    const supabase = createFakeSupabase()
    const bodyMarker = 'FULL_PRIVATE_SKILL_BODY_ONLY_AFTER_SELECTION'
    const legacy = `${skillMd({
      description: 'Reconstruct torn wedding photographs and preserve recognizable faces.',
      triggers: ['rebuild a torn wedding photo', '修复撕裂的结婚照'],
      bodyMarker: `${'private workflow detail '.repeat(120)}${bodyMarker}`,
    })}`
    const skillUrl = 'https://cdn.example.com/legacy-memory-restorer.md'
    supabase.rows.push({
      user_id: 'user-1',
      path: 'skills/memory-restorer/SKILL.md',
      content_type: 'text/markdown',
      size_bytes: Buffer.byteLength(legacy),
      storage_url: skillUrl,
      updated_at: '2026-08-30T10:00:00.000Z',
    })

    const servedStartupChunks: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url !== skillUrl) throw new Error(`Unexpected fetch: ${url}`)
      const headers = new Headers(init?.headers)
      const range = headers.get('range')
      if (!range) return new Response(legacy, { status: 200, headers: { 'content-type': 'text/markdown' } })
      const match = range.match(/^bytes=(\d+)-(\d+)$/)
      if (!match) throw new Error(`Invalid Range header: ${range}`)
      const start = Number(match[1])
      const requestedEnd = Number(match[2])
      const end = Math.min(requestedEnd, Buffer.byteLength(legacy) - 1)
      const chunk = Buffer.from(legacy).subarray(start, end + 1)
      servedStartupChunks.push(chunk.toString('utf8'))
      return new Response(chunk, {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${Buffer.byteLength(legacy)}` },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const firstManifest = await workspace.getSkillManifest(supabase, 'user-1')
      expect(firstManifest).toContain('Reconstruct torn wedding photographs')
      expect(firstManifest).toContain('rebuild a torn wedding photo')
      expect(firstManifest).toContain('修复撕裂的结婚照')
      expect(firstManifest).not.toContain(bodyMarker)
      expect(servedStartupChunks.join('')).not.toContain(bodyMarker)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('range')).toBe('bytes=0-511')

      const backfilled = uploadedIndex(supabase)
      expect(backfilled).toMatchObject({
        name: 'memory-restorer',
        contentHashSource: 'frontmatter-and-workspace-metadata',
      })

      workspace.clearWorkspaceCache()
      fetchMock.mockClear()
      const secondManifest = await workspace.getSkillManifest(supabase, 'user-1')
      expect(secondManifest).toContain('Reconstruct torn wedding photographs')
      expect(secondManifest).not.toContain(bodyMarker)
      expect(fetchMock).not.toHaveBeenCalled()

      workspace.clearWorkspaceCache()
      fetchMock.mockClear()
      const selected = await workspace.readFile('skills/memory-restorer/SKILL.md', supabase, 'user-1')
      expect(selected?.content).toContain(bodyMarker)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('range')).toBeNull()

      workspace.clearWorkspaceCache()
      fetchMock.mockClear()
      const afterSelectionManifest = await workspace.getSkillManifest(supabase, 'user-1')
      expect(afterSelectionManifest).toContain('Reconstruct torn wedding photographs')
      expect(afterSelectionManifest).not.toContain(bodyMarker)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      if (previousCacheDir == null) delete process.env.MAKARON_WORKSPACE_CACHE_DIR
      else process.env.MAKARON_WORKSPACE_CACHE_DIR = previousCacheDir
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
