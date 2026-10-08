// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInspectedRetakeVideoTool } from '@/lib/agent-retake-tool'
import { signRetakeInspection } from '@/lib/video-retake-inspection'

const submit = vi.hoisted(() => vi.fn(async () => ({ success: false, message: 'test submission recorded' })))
afterEach(() => { vi.unstubAllEnvs(); submit.mockClear() })

const sourceUrl = 'https://example.com/original.mp4'
const ctx = { userId: 'owner', projectId: 'project', snapshotImages: [sourceUrl], agentRunId: 'run' }
const scope = { ctx, submit, resolveSource: async () => ({ videoUrl: sourceUrl }), serializeVideoSubmission: async (operation: () => Promise<unknown>) => operation() } as any
const input = { media_index: 1, start: 18, end: 21, model: 'fal-h3-max', prompt: '1–2s: wheel close-up. CUT. 2–4s: overhead landing.' }
const observation = 'A white box-headed robot is already airborne above an orange skateboard in the purple-lit skatepark.'
const receipt = () => signRetakeInspection({ userId: 'owner', projectId: 'project', runId: 'run', inputEpoch: 0,
  sourceUrl, start: 18, end: 21, model: 'fal-h3-max' }, 'test-server-secret')

describe('Agent Retake paid-submission gate', () => {
  it('does not reserve or submit without actual inspection evidence', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-server-secret')
    const result = await (createInspectedRetakeVideoTool(scope).execute as any)({ ...input, source_observation: observation })
    expect(result).toMatchObject({ success: false, errorCode: 'retake_inspection_required' })
    expect(submit).not.toHaveBeenCalled()
  })
  it('does not submit a different range or a receipt without scene understanding', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-server-secret')
    await (createInspectedRetakeVideoTool(scope).execute as any)({ ...input, start: 19, inspection_id: receipt(), source_observation: observation })
    await (createInspectedRetakeVideoTool(scope).execute as any)({ ...input, inspection_id: receipt() })
    expect(submit).not.toHaveBeenCalled()
  })
  it('submits the inspected Agent prompt unchanged through the normal billing path', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-server-secret')
    await (createInspectedRetakeVideoTool(scope).execute as any)({ ...input, inspection_id: receipt(), source_observation: observation })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ script: input.prompt, videoUrl: sourceUrl,
      retake: { start: 18, end: 21 }, videoModel: 'fal-h3-max' }), expect.objectContaining({ toolName: 'retake_video' }))
  })
})
