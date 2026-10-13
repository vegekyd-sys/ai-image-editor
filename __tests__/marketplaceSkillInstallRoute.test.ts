import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
const mocks = vi.hoisted(() => ({ authenticateRequest: vi.fn(), installSkill: vi.fn(), ensureMarketplaceSkill: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock('@/lib/marketplace-skill-install', () => ({ ensureMarketplaceSkill: mocks.ensureMarketplaceSkill }));
vi.mock('@/lib/workspace', () => ({ deleteFile: vi.fn(), getAllSkills: vi.fn().mockResolvedValue([]), installSkill: mocks.installSkill, listFiles: vi.fn().mockResolvedValue([]) }));
afterEach(() => vi.unstubAllGlobals());
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

describe('ZIP Skill install inputs', () => {
  const supabase = {};
  const skillMd = '---\nname: sample\ndescription: Fixture Skill\n---\nUse assets/ref.PNG';
  const invalidZipMessage = 'Invalid skill archive. Please upload a .zip file containing SKILL.md.';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({ auth: { userId: 'user-1', supabase } });
    mocks.installSkill.mockResolvedValue({ success: true, skillName: 'sample' });
  });

  async function archive(markdown: string | null = skillMd) {
    const zip = new JSZip();
    if (markdown !== null) zip.file('sample/SKILL.md', markdown);
    zip.file('sample/assets/ref.PNG', 'fixture image');
    zip.file('unrelated.txt', 'not a Skill asset');
    return zip.generateAsync({ type: 'arraybuffer' });
  }

  function request(input: string, buffer: ArrayBuffer) {
    if (input === 'remote ZIP') {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(buffer)));
      return new NextRequest('http://localhost/api/skills', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillPath: 'https://example.com/skill.zip' }),
      });
    }
    const form = new FormData();
    form.set('file', new File([buffer], 'skill.ZIP', { type: 'application/zip' }));
    const req = new NextRequest('http://localhost/api/skills', { method: 'POST' });
    vi.spyOn(req, 'formData').mockResolvedValue(form);
    return req;
  }

  describe.each(['remote ZIP', 'local upload'])('%s', (input) => {
    it('installs the same markdown and assets with the authenticated identity', async () => {
      const { POST } = await import('@/app/api/skills/route');
      const response = await POST(request(input, await archive()));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, skillName: 'sample', assetsUploaded: 1 });
      expect(mocks.installSkill).toHaveBeenCalledExactlyOnceWith({
        skillMd, supabase, userId: 'user-1',
        assets: [{ filename: 'ref.PNG', data: Buffer.from('fixture image'), contentType: 'image/png' }],
      });
      expect(mocks.ensureMarketplaceSkill).not.toHaveBeenCalled();
    });

    it.each([
      ['non-ZIP bytes', () => Promise.resolve(new ArrayBuffer(4)), invalidZipMessage],
      ['corrupt ZIP bytes', () => Promise.resolve(Uint8Array.from([0x50, 0x4b, 0, 0]).buffer), invalidZipMessage],
      ['missing SKILL.md', () => archive(null), 'No SKILL.md found in zip'],
      ['invalid SKILL.md', () => archive('# No frontmatter'), 'Invalid SKILL.md format'],
    ])('rejects %s without installing', async (_label, buffer, error) => {
      const { POST } = await import('@/app/api/skills/route');
      const response = await POST(request(input, await buffer()));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error });
      expect(mocks.installSkill).not.toHaveBeenCalled();
    });

    it('preserves the installation failure response', async () => {
      mocks.installSkill.mockResolvedValue({ success: false, error: 'Fixture installation failed' });
      const { POST } = await import('@/app/api/skills/route');
      const response = await POST(request(input, await archive()));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Fixture installation failed' });
    });
  });

  it('preserves remote fetch errors without attempting installation', async () => {
    const req = request('remote ZIP', await archive());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const { POST } = await import('@/app/api/skills/route');
    const response = await POST(req);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Failed to fetch skill: 404' });
    expect(mocks.installSkill).not.toHaveBeenCalled();
  });
});
