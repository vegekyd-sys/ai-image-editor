import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authenticateRequest: vi.fn(), installSkill: vi.fn(), ensureMarketplaceSkill: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock('@/lib/marketplace-skill-install', () => ({ ensureMarketplaceSkill: mocks.ensureMarketplaceSkill }));
vi.mock('@/lib/workspace', () => ({ deleteFile: vi.fn(), getAllSkills: vi.fn().mockResolvedValue([]), installSkill: mocks.installSkill, listFiles: vi.fn().mockResolvedValue([]) }));
describe('marketplace Skill install route', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses the verified identity even when a cached client supplies an old ZIP URL', async () => {
    const supabase = {};
    mocks.authenticateRequest.mockResolvedValue({ auth: { userId: 'user-1', supabase } });
    mocks.ensureMarketplaceSkill.mockResolvedValue({ success: true, skillName: 'drone-rush', updated: true });
    const fetchMock = vi.fn();vi.stubGlobal('fetch', fetchMock);
    const { POST } = await import('@/app/api/skills/route');
    const response = await POST(new NextRequest('http://localhost/api/skills', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({skillPath:'https://example.com/old.zip',homeSkillId:'home-skill-1'})}));
    expect(response.status).toBe(200);
    expect(mocks.ensureMarketplaceSkill).toHaveBeenCalledWith(supabase, 'user-1', 'home-skill-1');
    expect(mocks.installSkill).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requires authentication before synchronizing a template', async () => {
    mocks.authenticateRequest.mockResolvedValue({ error: new Response('Unauthorized', {status:401}) });
    const { POST } = await import('@/app/api/skills/route');
    const response = await POST(new NextRequest('http://localhost/api/skills', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({skillPath:'https://example.com/old.zip',homeSkillId:'home-skill-1'})}));
    expect(response.status).toBe(401);expect(mocks.ensureMarketplaceSkill).not.toHaveBeenCalled();
  });
});
