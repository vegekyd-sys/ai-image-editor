import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseKidsImageRequest } from '@/lib/kids-live-contract'

const mocks = vi.hoisted(() => ({ streamAgent: vi.fn() }))
vi.mock('@/lib/agentStream', () => ({ streamAgent: mocks.streamAgent }))

import { KidsOperatorHandoff } from '@/components/kids/kids-operator'

describe('Makaron Kids Operator handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates the explicit function contract and strips contact-like data', () => {
    expect(parseKidsImageRequest({ action: 'edit', instruction: '加一艘火箭，联系 me@example.com' })).toEqual({
      action: 'edit',
      instruction: '加一艘火箭，联系',
    })
    expect(parseKidsImageRequest({ action: 'talk', instruction: 'hello' })).toBeNull()
    expect(parseKidsImageRequest({ action: 'create', instruction: '138 1234 5678' })).toBeNull()
  })

  it('returns from queue immediately, then reuses project creation and durable Agent generation', async () => {
    const phases: string[] = []
    const images: string[] = []
    let releaseAgent!: () => void
    const agentGate = new Promise<void>((resolve) => { releaseAgent = resolve })
    mocks.streamAgent.mockImplementation(async (_body, callbacks) => {
      await agentGate
      callbacks.onImage('', 'model', 'snapshot-2', 'https://cdn.makaron.app/result.jpg')
    })
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ projectId: 'project-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const handoff = new KidsOperatorHandoff({
      onImage: (url) => images.push(url),
      onPhase: (phase) => phases.push(phase),
    })

    expect(handoff.queue({ action: 'edit', instruction: '让月亮戴上黄色帽子' }, {
      data: 'base64-source', mimeType: 'image/jpeg',
    })).toBe(true)
    expect(phases).toEqual(['queued'])
    expect(handoff.queue({ action: 'edit', instruction: '再加一颗星星' }, null)).toBe(false)

    await vi.waitFor(() => expect(mocks.streamAgent).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/create', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      title: 'Makaron Kids', imageBase64: 'base64-source',
    })
    expect(mocks.streamAgent.mock.calls[0][0]).toMatchObject({
      projectId: 'project-1', durable: true,
    })

    releaseAgent()
    await vi.waitFor(() => expect(phases).toEqual(['queued', 'working', 'done']))
    expect(images).toEqual(['https://cdn.makaron.app/result.jpg'])
  })
})
