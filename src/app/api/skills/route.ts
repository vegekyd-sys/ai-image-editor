import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseSkillMd } from '@/lib/skill-registry';
import { getAllSkills, installSkill, deleteFile, listFiles, type SkillAsset } from '@/lib/workspace';
import JSZip from 'jszip';

// GET — list built-in + user skills (via workspace)
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    const allSkills = await getAllSkills(supabase, userId || undefined);

    const skills = allSkills.map(s => ({
      name: s.name,
      label: s.name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
      icon: s.makaron?.icon || '',
      color: s.makaron?.color || '#a78bfa',
      builtIn: s.makaron?.builtIn || false,
      description: s.description || '',
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

  const zip = await JSZip.loadAsync(buffer);

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
  if (!parseSkillMd(skillMdContent)) return { success: false, error: 'Invalid SKILL.md format' };

  const skillDir = skillMdPath.includes('/') ? skillMdPath.substring(0, skillMdPath.lastIndexOf('/') + 1) : '';
  const assetsPrefix = skillDir + 'assets/';
  const assets: SkillAsset[] = [];

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !path.startsWith(assetsPrefix)) continue;
    const data = await entry.async('nodebuffer');
    const filename = path.substring(assetsPrefix.length);
    const ct = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
    assets.push({ filename, data: Buffer.from(data), contentType: ct });
  }

  const result = await installSkill({ skillMd: skillMdContent, assets, supabase, userId, marketplaceId });
  if (!result.success) return { success: false, error: result.error };
  return { success: true, skillName: result.skillName, assetsUploaded: assets.length };
}

// POST — install skill: JSON { skillPath } = remote zip, FormData = local zip upload
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const { skillPath, homeSkillId } = await req.json();
      if (!skillPath) return NextResponse.json({ error: 'skillPath required' }, { status: 400 });

      const resp = await fetch(skillPath);
      if (!resp.ok) return NextResponse.json({ error: `Failed to fetch skill: ${resp.status}` }, { status: 502 });
      const buffer = await resp.arrayBuffer();

      const result = await installFromZip(buffer, supabase, user.id, homeSkillId || undefined);
      if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json(result);
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = await file.arrayBuffer();
    const result = await installFromZip(buffer, supabase, user.id);
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
    const { data: { user } } = await supabase.auth.getUser();
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
