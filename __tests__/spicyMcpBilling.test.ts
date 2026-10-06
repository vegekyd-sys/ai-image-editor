vi.mock('@/lib/gemini', () => ({ ContentBlockedError: class extends Error {} }))
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ balance: 100, editImage: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/billing/api-keys', () => ({ validateApiKey: async () => ({ userId: 'test-user', keyId: 'test-key' }) }))
vi.mock('@/lib/skills/edit-image', () => ({ editImage: state.editImage }))
vi.mock('@/lib/skills/rotate-camera', () => ({ rotateCamera: vi.fn() }))
vi.mock('@/lib/skills/write-video-script', () => ({ writeVideoScript: vi.fn() }))
vi.mock('@/lib/skills/create-video', () => ({ createVideo: vi.fn() }))
vi.mock('@/lib/skills/get-video-status', () => ({ getVideoStatus: vi.fn() }))
vi.mock('@/lib/skills/analyze-video', () => ({ analyzeVideo: vi.fn() }))
vi.mock('@/lib/skills/create-audio', () => ({ createAudio: vi.fn() }))
vi.mock('@/lib/skills/create-music', () => ({ createMusic: vi.fn() }))
vi.mock('@/lib/skills/get-music-status', () => ({ getMusicStatus: vi.fn() }))
vi.mock('fs', async importOriginal => ({
  ...await importOriginal<typeof import('fs')>(),
  mkdirSync: () => { throw new Error('serverless') },
  writeFileSync: () => { throw new Error('serverless') },
}))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({
  rpc: state.rpc,
  from: (table: string) => {
    const data = table === 'app_settings' ? { value: 'true' }
      : table === 'credit_balances' ? { balance: state.balance }
      : table === 'credit_pricing' ? [
        { tool_name: 'generate_image_qwen-spicy', credits: 3, is_free: false },
        { tool_name: 'edit_image_qwen-spicy', credits: 8, is_free: false },
        { tool_name: 'edit_image_qwen-spicy-2', credits: 9, is_free: false },
        { tool_name: 'edit_image_qwen-spicy-3', credits: 10, is_free: false },
      ] : null
    const chain = { data, error: null, select: () => chain, eq: () => chain, single: async () => ({ data, error: null }) }
    return chain
  },
}) }))

import { POST } from '@/app/api/mcp/route'
import { invalidateBillingCache } from '@/lib/billing/credits'

async function callSpicy(imageCount: number, model: string | null = 'qwen-spicy') {
  const response = await POST(new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { Authorization: 'Bearer mk_live_test', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'makaron_edit_image', arguments: {
      editPrompt: 'A red mug.', ...(model ? { model } : {}),
      ...(imageCount ? { image: 'data:image/png;base64,YQ==' } : {}),
      ...(imageCount > 1 ? { referenceImages: Array.from({ length: imageCount - 1 }, () => 'data:image/png;base64,Yg==') } : {}),
    } } }),
  }))
  return { response, payload: await response.json() }
}

beforeEach(() => {
  state.balance = 100
  state.editImage.mockReset().mockResolvedValue({ success: true, image: 'data:image/png;base64,YQ==', usedModel: 'qwen-spicy', provider: 'mulerouter', message: 'done' })
  state.rpc.mockReset().mockImplementation(async (name, params) => {
    if (name === 'deduct_and_log') state.balance -= params.p_amount
    return { data: state.balance, error: null }
  })
  invalidateBillingCache()
})

describe('MCP Spicy price-to-ledger path', () => {
  it.each([
    { count: 0, tool: 'generate_image_qwen-spicy', credits: 3 },
    { count: 1, tool: 'edit_image_qwen-spicy', credits: 8 },
    { count: 2, tool: 'edit_image_qwen-spicy-2', credits: 9 },
    { count: 3, tool: 'edit_image_qwen-spicy-3', credits: 10 },
  ])('charges $tool for $count inputs', async ({ count, tool, credits }) => {
    const { response, payload } = await callSpicy(count)
    expect(payload.result.content[1].type).toBe('image')
    expect(response.headers.get('X-Credits-Charged')).toBe(String(credits))
    expect(response.headers.get('X-Credits-Remaining')).toBe(String(100 - credits))
    expect(state.rpc).toHaveBeenCalledWith('deduct_and_log', expect.objectContaining({
      p_user_id: 'test-user', p_api_key_id: 'test-key', p_source: 'mcp',
      p_tool_name: tool, p_model_used: 'qwen-spicy', p_amount: credits,
    }))
  })

  it('rejects an underfunded edit before provider submission', async () => {
    state.balance = 7
    const { payload } = await callSpicy(1)
    expect(payload.result.isError).toBe(true)
    expect(state.editImage).not.toHaveBeenCalled()
    expect(state.rpc.mock.calls.filter(([name]) => name === 'deduct_and_log')).toHaveLength(0)
  })

  it('also preflights the Spicy fallback when no model was selected', async () => {
    state.balance = 7
    const { payload } = await callSpicy(1, null)
    expect(payload.result.isError).toBe(true)
    expect(state.editImage).not.toHaveBeenCalled()
    expect(state.rpc.mock.calls.filter(([name]) => name === 'deduct_and_log')).toHaveLength(0)
  })

  it('does not charge when the provider returns no image', async () => {
    state.editImage.mockResolvedValue({ success: false, message: 'rejected' })
    const { payload } = await callSpicy(1)
    expect(payload.result.isError).toBe(true)
    expect(state.rpc.mock.calls.filter(([name]) => name === 'deduct_and_log')).toHaveLength(0)
  })
})
