import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ensureMarketplaceSkill, marketplaceSourceFingerprint } from '@/lib/marketplace-skill-install';

const source = { id: 'template-1', skill_path: 'https://example.com/v2.zip', updated_at: '2026-10-12T00:00:00Z' };
function fake(options: { installed?: any[]; failUpload?: number; result?: any } = {}) {
  const rows: any[] = [];
  const uploads: any[] = [];
  const remove = vi.fn(async () => ({ error: null }));
  const rpc = vi.fn(async (_name, args) => { rows.push(...args.p_files); return { data: options.result || { committed: true, skillName: args.p_name }, error: null }; });
  const db = { from: () => {
    let filter = '';
    const q: any = { select: () => q, eq: () => q, like: () => q, in: () => { filter = 'references'; return q; },
      then: (resolve: any) => resolve({ data: filter === 'references' ? [] : options.installed || [], error: null }) };
    return q;
  }, storage: { from: () => ({ upload: vi.fn(async (object, body) => {
    uploads.push({ object, body }); return { error: uploads.length === options.failUpload ? { message: 'fixture failure' } : null };
  }), getPublicUrl: (object: string) => ({ data: { publicUrl: `https://example.com/${object}` } }), remove }) }, rpc };
  return { db, uploads, remove, rpc, rows };
}
async function archive() {
  const zip = new JSZip();
  zip.file('sample/SKILL.md', '---\nname: sample\ndescription: fixture\n---\nExecute V2 with assets/ref.txt');
  zip.file('sample/assets/ref.txt', 'NEW');
  return zip.generateAsync({ type: 'arraybuffer' });
}
afterEach(() => vi.unstubAllGlobals());
describe('marketplace version synchronization', () => {
  it('reuses the published fingerprint without downloading or uploading anything', async () => {
    const f = fake({ installed: [{ path: 'skills/sample/SKILL.md', marketplace_source: marketplaceSourceFingerprint(source) }] });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const result = await ensureMarketplaceSkill(f.db as never, 'user', source.id, source, f.db as never);
    expect(result.alreadyInstalled).toBe(true); expect(fetch).not.toHaveBeenCalled(); expect(f.uploads).toHaveLength(0);
  });
  it('upgrades a legacy install in place and stages all assets, content and discovery before committing', async () => {
    const f = fake({ installed: [{ path: 'skills/old-name/SKILL.md' }] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(await archive())));
    const result = await ensureMarketplaceSkill(f.db as never, 'user', source.id, source, f.db as never);
    expect(result.updated).toBe(true); expect(result.skillName).toBe('old-name');
    expect(f.rpc).toHaveBeenCalledOnce(); expect(f.rows).toHaveLength(3);
    const md = f.uploads.find(u => u.object.endsWith('/SKILL.md')).body;
    expect(md).toContain('name: old-name'); expect(md).toContain('Execute V2'); expect(md).toContain('/marketplace-revisions/');
    expect(f.remove).not.toHaveBeenCalled();
  });
  it('does not publish a partial update when asset/content upload fails', async () => {
    const f = fake({ installed: [{ path: 'skills/sample/SKILL.md' }], failUpload: 2 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(await archive())));
    await expect(ensureMarketplaceSkill(f.db as never, 'user', source.id, source, f.db as never)).rejects.toThrow('fixture failure');
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.remove).toHaveBeenCalledWith([f.uploads[0].object]);
  });
  it('normalizes legacy markdown-only marketplace packages while leaving ZIP uploads independent', async () => {
    const f = fake(); const zip = new JSZip();zip.file('SKILL.md', '# Legacy template\n\nExecute latest instructions.');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(await zip.generateAsync({ type: 'arraybuffer' }))));
    await ensureMarketplaceSkill(f.db as never, 'user', source.id, source, f.db as never);
    const md = f.uploads.find(u => u.object.endsWith('/SKILL.md')).body;
    expect(md).toContain('description: Makaron marketplace Skill: template-1');expect(md).toContain('Execute latest instructions.');
  });
  it('canonicalizes timestamps in source fingerprints', () => {
    expect(marketplaceSourceFingerprint(source)).toBe(marketplaceSourceFingerprint({ ...source, updated_at: '2026-10-12 00:00:00+00' }));
    expect(marketplaceSourceFingerprint(source)).not.toBe(marketplaceSourceFingerprint({ ...source, skill_path: 'https://example.com/v3.zip' }));
  });
});
