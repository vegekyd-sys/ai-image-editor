import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const projectRows = vi.hoisted(() => new Map<string, { id: string; user_id: string }>())
const insertProject = vi.hoisted(() => vi.fn(async (row: { id: string; user_id: string }) => {
  if (projectRows.has(row.id)) return { error: { code: '23505', message: 'duplicate key' } }
  projectRows.set(row.id, row)
  return { error: null }
}))

vi.mock('@/lib/api-auth', () => ({
  authenticateRequest: vi.fn(async () => ({
    auth: {
      userId: 'user-1',
      supabase: {
        from: (table: string) => {
          if (table !== 'projects') throw new Error(`Unexpected table ${table}`)
          return {
            select: () => ({
              eq: (_key: string, projectId: string) => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: projectRows.get(projectId) ?? null,
                    error: null,
                  }),
                }),
              }),
            }),
            insert: insertProject,
          }
        },
      },
    },
  })),
}))

describe('project creation idempotency', () => {
  beforeEach(() => {
    projectRows.clear()
    insertProject.mockClear()
  })

  it('returns the same client project for repeated continuation requests', async () => {
    const { POST } = await import('@/app/api/projects/create/route')
    const body = {
      title: 'Untitled',
      clientProjectId: '44444444-4444-4444-8444-444444444444',
      idempotencyKey: 'anonymous-continuation-4',
    }

    const makeRequest = () => new NextRequest('http://localhost/api/projects/create', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
    const first = await POST(makeRequest())
    const second = await POST(makeRequest())

    await expect(first.json()).resolves.toMatchObject({
      projectId: body.clientProjectId,
      idempotent: false,
    })
    await expect(second.json()).resolves.toMatchObject({
      projectId: body.clientProjectId,
      idempotent: true,
    })
    expect(insertProject).toHaveBeenCalledTimes(1)
  })
})
