import { expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const { advance } = vi.hoisted(() => ({ advance: vi.fn().mockResolvedValue({ status: 'processing' }) }))
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: async () => ({ auth: { userId: 'authenticated-owner' } }) }))
vi.mock('@/lib/video-upscale-pipeline', () => ({ advanceVideoPipeline: advance }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: vi.fn() }))
vi.mock('@/lib/kling', () => ({ getKlingTask: vi.fn() }))
vi.mock('@/lib/piapi', () => ({ getKlingTask: vi.fn() }))
vi.mock('@/lib/supabase/storage', () => ({ uploadVideo: vi.fn() }))
import { GET } from '@/app/api/animate/[taskId]/route'
import { getVideoStatus } from '@/lib/skills/get-video-status'
it('passes the authenticated owner into legacy animation polling for Eco roots', async () => {
  const taskId = 'video-pipeline-22222222-2222-4222-8222-222222222222'
  const response = await GET(new NextRequest('https://makaron.app/api/animate/' + taskId), { params: Promise.resolve({ taskId }) })
  expect(response.status).toBe(200)
  expect(advance).toHaveBeenCalledWith(taskId, 'authenticated-owner')
})
it('labels pipeline transport failures as query failures so billing cannot refund them', async () => {
  advance.mockRejectedValueOnce(new Error('temporary transport failure'))
  const result = await getVideoStatus({ taskId: 'video-pipeline-22222222-2222-4222-8222-222222222222', userId: 'authenticated-owner' })
  expect(result).toMatchObject({ success: false, queryFailed: true })
})
