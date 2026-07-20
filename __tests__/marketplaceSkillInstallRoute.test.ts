import JSZip from 'jszip'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  installSkill: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mocks.authenticateRequest }))
vi.mock('@/lib/workspace', () => ({
  deleteFile: vi.fn(),
  getAllSkills: vi.fn().mockResolvedValue([]),
  installSkill: mocks.installSkill,
  listFiles: vi.fn().mockResolvedValue([]),
}))

function createSupabase(skillPath: string) {
  return {
    from(table: string) {
      if (table === 'home_skills') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: async () => ({
            data: {
              id: 'home-skill-1',
              skill_path: skillPath,
              labels: { en: 'Drone Rush', zh: '无人机穿越' },
            },
            error: null,
          }),
        }
        return builder
      }
      if (table === 'workspace_files') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          limit: async () => ({ data: [], error: null }),
        }
        return builder
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

describe('marketplace Skill install route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes a server-verified markdown-only legacy template before installation', async () => {
    const skillPath = 'https://cdn.makaron.app/marketplace/skills/drone-rush.zip'
    const supabase = createSupabase(skillPath)
    mocks.authenticateRequest.mockResolvedValue({ auth: { userId: 'user-1', supabase } })
    mocks.installSkill.mockResolvedValue({ success: true, skillName: 'drone-rush' })

    const zip = new JSZip()
    zip.file('SKILL.md', '# FPV Drone Flythrough Video\n\nGenerate the final cinematic flythrough.')
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(buffer, { status: 200 })))

    const { POST } = await import('@/app/api/skills/route')
    const response = await POST(new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillPath, homeSkillId: 'home-skill-1' }),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, skillName: 'drone-rush' })
    expect(mocks.installSkill).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      marketplaceId: 'home-skill-1',
      skillMd: expect.stringContaining('name: drone-rush\ndescription: Makaron marketplace Skill: Drone Rush'),
    }))
  })

  it('rejects a client URL that does not match the active template record', async () => {
    const trustedPath = 'https://cdn.makaron.app/marketplace/skills/drone-rush.zip'
    const supabase = createSupabase(trustedPath)
    mocks.authenticateRequest.mockResolvedValue({ auth: { userId: 'user-1', supabase } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/skills/route')
    const response = await POST(new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillPath: 'https://example.com/untrusted.zip',
        homeSkillId: 'home-skill-1',
      }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Skill template could not be verified' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
