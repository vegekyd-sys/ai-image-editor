// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ generate: vi.fn(), backend: vi.fn(), requireCredits: vi.fn(), debit: vi.fn(), tokenDebit: vi.fn(), analyze: vi.fn() }));
vi.mock('@/lib/billing/api-keys', () => ({ validateApiKey: async () => ({ userId: 'test-user', keyId: 'test-key' }) }));
vi.mock('@/lib/billing/credits', () => ({
  isBillingEnabled: async () => true,
  checkBalance: async () => ({ ok: true, balance: 100, cost: 3 }),
  requireCredits: state.requireCredits,
  deductCredits: state.debit,
  deductByTokens: state.tokenDebit,
  recordSubscriptionUsage: vi.fn(),
}));
vi.mock('@/lib/billing/token-rates', () => ({ getTokenRate: async (model_id: string) => ({ model_id, markup: 2 }) }));
vi.mock('@/lib/billing/pricing', () => ({
  getToolPrice: async () => ({ credits: 3, isFree: false }),
  resolveToolName: (_tool: string, model: string) => `generate_image_${model}`,
}));
vi.mock('@/lib/models', () => ({ getBackend: state.backend }));
vi.mock('@/lib/skills/rotate-camera', () => ({ rotateCamera: vi.fn() }));
vi.mock('@/lib/skills/write-video-script', () => ({ writeVideoScript: vi.fn() }));
vi.mock('@/lib/skills/create-video', () => ({ createVideo: vi.fn() }));
vi.mock('@/lib/skills/get-video-status', () => ({ getVideoStatus: vi.fn() }));
vi.mock('@/lib/skills/analyze-video', () => ({ analyzeVideo: state.analyze }));
vi.mock('@/lib/skills/create-audio', () => ({ createAudio: vi.fn() }));
vi.mock('@/lib/skills/create-music', () => ({ createMusic: vi.fn() }));
vi.mock('@/lib/skills/get-music-status', () => ({ getMusicStatus: vi.fn() }));
vi.mock('fs', async original => ({ ...await original<typeof import('fs')>(), mkdirSync: () => { throw new Error('serverless'); }, writeFileSync: () => { throw new Error('serverless'); } }));

import { POST } from '@/app/api/mcp/route';


beforeEach(()=>{vi.clearAllMocks();state.requireCredits.mockResolvedValue({ok:true});});
describe('MCP video debit reporting',()=>{
 it.each([0,1,3])('reports the existing %i-credit analyzer debit without charging again',async credits=>{
  state.analyze.mockResolvedValue({success:true,message:'Done',analysis:'Video',usedModel:'gemini-3.8-flash',creditsCharged:credits,
   usage:{modelId:'gemini-3.8-flash',inputTokens:712,outputTokens:107}});
  const response=await POST(new Request('http://localhost/api/mcp',{method:'POST',
   headers:{Authorization:'Bearer mk_live_test','Content-Type':'application/json',Accept:'application/json, text/event-stream'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'makaron_analyze_video',arguments:{videoUrl:'https://www.makaron.app/home-hero/cloud-house-v2.mp4'}}})}));
  expect(response.status).toBe(200);expect(response.headers.get('X-Credits-Charged')).toBe(String(credits));
  expect(state.analyze).toHaveBeenCalledOnce();expect(state.tokenDebit).not.toHaveBeenCalled();expect(state.debit).not.toHaveBeenCalled();
 });
});
