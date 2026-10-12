import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deriveMarketplaceSkillName, normalizeMarketplaceSkillMd, parseSkillMd } from './skill-registry';
import { buildUserSkillManifestEntry, clearWorkspaceCache } from './workspace';
import { getSupabaseAdmin } from './supabase/service';

export interface MarketplaceSource {
  id: string;
  skill_path: string;
  updated_at: string;
  labels?: Record<string, unknown>;
}
export function marketplaceSourceFingerprint(source: MarketplaceSource): string {
  return createHash('sha256').update(JSON.stringify([source.skill_path, new Date(source.updated_at).toISOString()])).digest('hex');
}
export async function getMarketplaceSource(supabase: Pick<SupabaseClient, 'from'>, id: string): Promise<MarketplaceSource> {
  const { data, error } = await supabase.from('home_skills')
    .select('id, skill_path, updated_at, labels').eq('id', id).eq('is_active', true).single();
  if (error || !data?.skill_path || !data.updated_at) throw new Error('Skill template could not be verified');
  return data as MarketplaceSource;
}

// Publish immutable objects first; only the RPC may expose them to workspace readers.
// No mutable Storage URL, partial file index, or process-local lock participates in publication.
export async function ensureMarketplaceSkill(
  supabase: Pick<SupabaseClient, 'from'>,
  userId: string,
  marketplaceId: string,
  source?: MarketplaceSource,
  admin: SupabaseClient = getSupabaseAdmin(),
): Promise<{ success: true; skillName: string; alreadyInstalled?: boolean; updated?: boolean; sourceFingerprint: string; assetsUploaded?: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = source || await getMarketplaceSource(supabase, marketplaceId);
    source = undefined;
    const fingerprint = marketplaceSourceFingerprint(current);
    const { data: installed, error } = await supabase.from('workspace_files')
      .select('path, marketplace_source').eq('user_id', userId).eq('marketplace_id', marketplaceId)
      .like('path', 'skills/%/SKILL.md');
    if (error) throw new Error('Failed to check installed Skill');
    const existing = installed?.[0];
    if (existing?.marketplace_source === fingerprint) {
      clearWorkspaceCache();
      return { success: true, skillName: existing.path.split('/')[1], alreadyInstalled: true, sourceFingerprint: fingerprint };
    }
    const response = await fetch(current.skill_path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to fetch skill: ${response.status}`);
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const mdPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir && /(?:^|\/)SKILL\.md$/.test(p));
    if (mdPaths.length !== 1) throw new Error('Skill archive must contain exactly one SKILL.md');
    const mdPath = mdPaths[0];
    const rawMd = await zip.files[mdPath].async('string');
    const fallback = { name: deriveMarketplaceSkillName(current.skill_path, current.id), description: `Makaron marketplace Skill: ${current.labels?.en || current.id}` };
    let md = normalizeMarketplaceSkillMd(rawMd, fallback);
    const parsed = parseSkillMd(md);
    if (!parsed || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(parsed.name)) throw new Error('Invalid marketplace Skill name');
    let name = existing?.path.split('/')[1] || parsed.name;
    if (!existing) {
      // Marketplace templates never overwrite an unrelated custom/built-in Skill.
      const { data: files, error: namesError } = await supabase.from('workspace_files').select('path').eq('user_id', userId).like('path', 'skills/%');
      if (namesError) throw new Error('Failed to check Skill names');
      const names = new Set(files?.map(f => f.path.split('/')[1]));
      const { getSkill } = await import('./skill-registry');
      let suffix = 2;
      while (names.has(name) || getSkill(name)) name = `${parsed.name}-${suffix++}`;
    }
    if (name !== parsed.name) md = md.replace(/^name:\s*.+$/m, `name: ${name}`);
    const prefix = mdPath.slice(0, -'SKILL.md'.length) + 'assets/';
    const stage = `${userId}/workspace/marketplace-revisions/${marketplaceId}/${fingerprint}/${randomUUID()}`;
    const objects: string[] = [];
    const rows: Array<{ path: string; storage_url: string; content_type: string; size_bytes: number; updated_at: string }> = [];
    const updatedAt = new Date().toISOString();
    async function stageFile(logicalPath: string, body: string | Buffer, contentType: string) {
      const object = `${stage}/${logicalPath}`;
      const { error: uploadError } = await admin.storage.from('images').upload(object, body, { contentType, upsert: false, cacheControl: '31536000' });
      if (uploadError) throw new Error(`Failed to stage Skill file: ${uploadError.message}`);
      objects.push(object);
      const url = admin.storage.from('images').getPublicUrl(object).data.publicUrl;
      rows.push({ path: logicalPath, storage_url: url, content_type: contentType, size_bytes: Buffer.byteLength(body), updated_at: updatedAt });
      return url;
    }
    let committed = false;
    try {
      for (const [assetPath, entry] of Object.entries(zip.files)) {
        if (entry.dir || !assetPath.startsWith(prefix)) continue;
        const filename = assetPath.slice(prefix.length);
        if (!filename || filename.split('/').some(p => !p || p === '.' || p === '..') || /[\\\u0000-\u001f]/.test(filename)) throw new Error('Invalid Skill asset path');
        const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', json: 'application/json', txt: 'text/plain', md: 'text/markdown' };
        const url = await stageFile(`skills/${name}/assets/${fingerprint}/${filename}`, await entry.async('nodebuffer'), mime[filename.split('.').pop()!.toLowerCase()] || 'application/octet-stream');
        md = md.split(`assets/${filename}`).join(url);
      }
      await stageFile(`skills/${name}/SKILL.md`, md, 'text/markdown');
      const index = buildUserSkillManifestEntry(`skills/${name}/SKILL.md`, md, { size: Buffer.byteLength(md), updatedAt });
      if (!index) throw new Error('Invalid Skill discovery metadata');
      await stageFile(`skills/${name}/.makaron-skill-index.json`, JSON.stringify(index), 'application/json');
      const { data: result, error: commitError } = await admin.rpc('commit_marketplace_skill', {
        p_user_id: userId, p_marketplace_id: marketplaceId, p_skill_path: current.skill_path,
        p_source_updated_at: current.updated_at, p_source: fingerprint, p_name: name, p_files: rows,
      });
      if (commitError) throw new Error(`Failed to publish Skill update: ${commitError.message}`);
      if (result?.retry) continue;
      committed = result?.committed === true;
      if (!committed && !result?.alreadyInstalled) throw new Error('Skill update was not published');
      clearWorkspaceCache();
      return { success: true, skillName: result.skillName, sourceFingerprint: fingerprint,
        ...(result.alreadyInstalled ? { alreadyInstalled: true } : { updated: !!existing, assetsUploaded: rows.length - 2 }) };
    } finally {
      // A network error may have committed the transaction. Check its pointer before
      // removing our own staged objects; an indeterminate check keeps them intact.
      if (!committed && objects.length) {
        const { data: references, error: checkError } = await admin.from('workspace_files').select('path')
          .eq('user_id', userId).in('storage_url', rows.map(row => row.storage_url));
        if (!checkError && references?.length === 0) await admin.storage.from('images').remove(objects);
      }
    }
  }
  throw new Error('Skill template changed during installation. Please try again.');
}
