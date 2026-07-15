import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: serviceMocks.getSupabaseAdmin,
}))

type QueryResult = { data: unknown[] | null; error: unknown }

function query(result: QueryResult) {
  const order = vi.fn().mockResolvedValue(result)
  const eq = vi.fn().mockReturnValue({ order })
  const select = vi.fn().mockReturnValue({ eq })
  return { select, eq, order }
}

describe('home skill category public APIs', () => {
  beforeEach(() => {
    serviceMocks.getSupabaseAdmin.mockReset()
  })

  it('returns additive prompt and category fields from the localized projection', async () => {
    const localized = query({
      data: [{
        id: 'skill-1',
        labels: { en: 'Skill' },
        prompt: 'Legacy prompt',
        prompts: { ja: '日本語プロンプト' },
        categories: ['video'],
      }],
      error: null,
    })
    const from = vi.fn().mockReturnValue(localized)
    serviceMocks.getSupabaseAdmin.mockReturnValue({ from })

    const { GET } = await import('@/app/api/home-skills/route')
    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([expect.objectContaining({
      id: 'skill-1',
      prompts: { ja: '日本語プロンプト' },
      categories: ['video'],
    })])
    expect(localized.select).toHaveBeenCalledWith(expect.stringContaining('prompts, categories'))
  })

  it('retries the legacy projection when the additive columns are not deployed', async () => {
    const missingColumns = query({ data: null, error: { code: '42703' } })
    const legacy = query({
      data: [{ id: 'skill-1', labels: { en: 'Skill' }, prompt: 'Legacy prompt' }],
      error: null,
    })
    const from = vi.fn()
      .mockReturnValueOnce(missingColumns)
      .mockReturnValueOnce(legacy)
    serviceMocks.getSupabaseAdmin.mockReturnValue({ from })

    const { GET } = await import('@/app/api/home-skills/route')
    const response = await GET()

    expect(await response.json()).toEqual([expect.objectContaining({
      id: 'skill-1',
      prompt: 'Legacy prompt',
      prompts: {},
      categories: [],
    })])
    expect(legacy.select).not.toHaveBeenCalledWith(expect.stringContaining('prompts'))
  })

  it('returns ordered active category definitions', async () => {
    const categories = query({
      data: [{
        id: 'video',
        labels: { en: 'Video' },
        descriptions: { en: 'Bring photos to life' },
        sort_order: 0,
        icon: null,
        is_active: true,
      }],
      error: null,
    })
    serviceMocks.getSupabaseAdmin.mockReturnValue({ from: vi.fn().mockReturnValue(categories) })

    const { GET } = await import('@/app/api/skill-categories/route')
    const response = await GET()

    expect(await response.json()).toEqual([expect.objectContaining({ id: 'video' })])
    expect(categories.eq).toHaveBeenCalledWith('is_active', true)
    expect(categories.order).toHaveBeenCalledWith('sort_order')
  })

  it('falls back to an empty category list before the migration is applied', async () => {
    const missingTable = query({ data: null, error: { code: '42P01' } })
    serviceMocks.getSupabaseAdmin.mockReturnValue({ from: vi.fn().mockReturnValue(missingTable) })

    const { GET } = await import('@/app/api/skill-categories/route')
    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })
})
