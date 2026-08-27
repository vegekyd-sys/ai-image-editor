import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { authenticateRequest } from '@/lib/api-auth';
import { deriveMarketplaceSkillName, normalizeMarketplaceSkillMd, parseSkillMd } from '@/lib/skill-registry';
import { getAllSkills, installSkill, deleteFile, listFiles, type SkillAsset } from '@/lib/workspace';
import JSZip from 'jszip';

const INVALID_ZIP_MESSAGE = 'Invalid skill archive. Please upload a .zip file containing SKILL.md.';

function isLikelyZip(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  const bytes = new Uint8Array(buffer, 0, 4);
  return bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
}

// GET — list built-in + user skills (via workspace)
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    const allSkills = await getAllSkills(supabase, userId || undefined);
    const includeInternal = req.nextUrl.searchParams.get('include') === 'internal';

    const skills = allSkills.filter(s => includeInternal || s.makaron?.userSelectable !== false).map(s => ({
      name: s.name,
      label: s.name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
      icon: s.makaron?.icon || '',
      color: s.makaron?.color || '#a78bfa',
      builtIn: s.makaron?.builtIn || false,
      description: s.description || '',
      tags: s.makaron?.tags || [],
      studioRunRecipe: s.makaron?.studioRunRecipe,
      studioRunProfile: s.makaron?.studioRunProfile,
      sourceMediaRequired: s.makaron?.sourceMediaRequired || false,
      inputHint: s.makaron?.inputHint,
      userSelectable: s.makaron?.userSelectable !== false,
      manifestVisible: s.makaron?.manifestVisible !== false,
      sourceProject: s.makaron?.sourceProject,
      sourceSkill: s.makaron?.sourceSkill,
      sourceKind: s.makaron?.sourceKind,
      supportLevel: s.makaron?.supportLevel,
      adapterFamily: s.makaron?.adapterFamily,
      canonicalSkill: s.makaron?.canonicalSkill,
      referenceImages: s.makaron?.referenceImages || [],
    }));

    return NextResponse.json({ skills });
  } catch (err) {
    console.error('[skills GET]', err);
    return NextResponse.json({ error: 'Failed to load skills' }, { status: 500 });
  }
}

// Shared: parse zip buffer → extract SKILL.md + assets → installSkill
async function installFromZip(
  buffer: ArrayBuffer,
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  marketplaceId?: string,
  marketplaceFallback?: { name: string; description: string },
): Promise<{ success: boolean; skillName?: string; assetsUploaded?: number; alreadyInstalled?: boolean; error?: string }> {
  // Dedup: if marketplace skill already installed, skip
  if (marketplaceId) {
    const { data: existing } = await supabase
      .from('workspace_files')
      .select('path')
      .eq('user_id', userId)
      .eq('marketplace_id', marketplaceId)
      .limit(1);
    if (existing && existing.length > 0) {
      const skillName = existing[0].path.split('/')[1] || '';
      return { success: true, skillName, alreadyInstalled: true };
    }
  }

  if (!isLikelyZip(buffer)) return { success: false, error: INVALID_ZIP_MESSAGE };

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return { success: false, error: INVALID_ZIP_MESSAGE };
  }

  let skillMdContent: string | null = null;
  let skillMdPath = '';
  for (const [path, entry] of Object.entries(zip.files)) {
    if (path.endsWith('SKILL.md') && !entry.dir) {
      skillMdContent = await entry.async('string');
      skillMdPath = path;
      break;
    }
  }
  if (!skillMdContent) return { success: false, error: 'No SKILL.md found in zip' };
  const installableSkillMd = marketplaceFallback
    ? normalizeMarketplaceSkillMd(skillMdContent, marketplaceFallback)
    : skillMdContent;
  if (!parseSkillMd(installableSkillMd)) return { success: false, error: 'Invalid SKILL.md format' };

  const skillDir = skillMdPath.includes('/') ? skillMdPath.substring(0, skillMdPath.lastIndexOf('/') + 1) : '';
  const assetsPrefix = skillDir + 'assets/';
  const assets: SkillAsset[] = [];

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !path.startsWith(assetsPrefix)) continue;
    const data = await entry.async('nodebuffer');
    const filename = path.substring(assetsPrefix.length);
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.gif': 'image/gif',
      '.mp4': 'video/mp4', '.mov': 'video/quicktime',
    };
    const ct = mimeMap[ext] || 'application/octet-stream';
    assets.push({ filename, data: Buffer.from(data), contentType: ct });
  }

  const result = await installSkill({ skillMd: installableSkillMd, assets, supabase, userId, marketplaceId });
  if (!result.success) return { success: false, error: result.error };
  return { success: true, skillName: result.skillName, assetsUploaded: assets.length };
}

// POST — install skill: JSON { skillPath } = remote zip, FormData = local zip upload
export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest(req);
    if ('error' in authResult) return authResult.error;
    const { supabase, userId } = authResult.auth;

    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const { skillPath, homeSkillId } = await req.json();
      if (!skillPath) return NextResponse.json({ error: 'skillPath required' }, { status: 400 });

      let trustedSkillPath = skillPath as string;
      let marketplaceFallback: { name: string; description: string } | undefined;
      if (homeSkillId) {
        const { data: homeSkill, error: homeSkillError } = await supabase
          .from('home_skills')
          .select('id, skill_path, labels')
          .eq('id', homeSkillId)
          .eq('is_active', true)
          .single();
        if (homeSkillError || !homeSkill?.skill_path || homeSkill.skill_path !== skillPath) {
          return NextResponse.json({ error: 'Skill template could not be verified' }, { status: 400 });
        }
        trustedSkillPath = homeSkill.skill_path;
        const labels = homeSkill.labels && typeof homeSkill.labels === 'object' && !Array.isArray(homeSkill.labels)
          ? homeSkill.labels as Record<string, unknown>
          : {};
        const englishLabel = typeof labels.en === 'string' ? labels.en.trim() : '';
        marketplaceFallback = {
          name: deriveMarketplaceSkillName(trustedSkillPath, homeSkill.id),
          description: englishLabel
            ? `Makaron marketplace Skill: ${englishLabel}`
            : `Makaron marketplace Skill ${homeSkill.id}`,
        };
      }

      const resp = await fetch(trustedSkillPath);
      if (!resp.ok) return NextResponse.json({ error: `Failed to fetch skill: ${resp.status}` }, { status: 502 });
      const buffer = await resp.arrayBuffer();

      const result = await installFromZip(buffer, supabase, userId, homeSkillId || undefined, marketplaceFallback);
      if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json(result);
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!file.name.toLowerCase().endsWith('.zip')) {
      return NextResponse.json({ error: INVALID_ZIP_MESSAGE }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const result = await installFromZip(buffer, supabase, userId);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[skills POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE — remove a user skill (via workspace)
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name } = await req.json();
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

    // Find all files under skills/{name}/
    const files = await listFiles(`skills/${name}/%`, supabase, user.id);

    // Delete each file
    for (const f of files) {
      await deleteFile(f.path, supabase, user.id);
    }

    // Also delete exact match (in case SKILL.md path doesn't end with /)
    await deleteFile(`skills/${name}/SKILL.md`, supabase, user.id);

    // Clean up any share links for this skill
    await supabase.from('skill_shares').delete().eq('sharer_id', user.id).eq('skill_name', name);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[skills DELETE]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
