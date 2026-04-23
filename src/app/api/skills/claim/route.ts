import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/service';
import { installSkill, type SkillAsset } from '@/lib/workspace';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { code } = await req.json();
    if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 });

    const admin = getSupabaseAdmin();

    // Look up share
    const { data: share, error: shareErr } = await admin
      .from('skill_shares')
      .select('sharer_id, skill_name')
      .eq('code', code)
      .single();

    if (shareErr || !share) {
      return NextResponse.json({ error: 'Share link not found or expired' }, { status: 404 });
    }

    // List all files for this skill — find any available copy
    const { data: allFiles } = await admin
      .from('workspace_files')
      .select('path, storage_url, content_type, user_id')
      .like('path', `skills/${share.skill_name}/%`);

    if (!allFiles || allFiles.length === 0) {
      return NextResponse.json({ error: 'Skill no longer exists' }, { status: 404 });
    }

    // Group by path, prefer sharer's own files
    const fileMap = new Map<string, typeof allFiles[0]>();
    for (const f of allFiles) {
      const existing = fileMap.get(f.path);
      if (!existing || f.user_id === share.sharer_id) {
        fileMap.set(f.path, f);
      }
    }
    const files = [...fileMap.values()];

    // Read SKILL.md content
    const skillMdFile = files.find((f: { path: string }) => f.path.endsWith('/SKILL.md'));
    if (!skillMdFile?.storage_url) {
      return NextResponse.json({ error: 'Skill no longer exists' }, { status: 404 });
    }

    const mdResp = await fetch(skillMdFile.storage_url);
    if (!mdResp.ok) {
      return NextResponse.json({ error: 'Failed to read skill' }, { status: 500 });
    }
    const skillMd = await mdResp.text();

    // Fetch all assets
    const assetFiles = files.filter((f: { path: string; storage_url: string }) =>
      f.path.includes('/assets/') && f.storage_url
    );

    const assets: SkillAsset[] = [];
    for (const af of assetFiles) {
      try {
        const resp = await fetch(af.storage_url);
        if (!resp.ok) continue;
        const buf = Buffer.from(await resp.arrayBuffer());
        const filename = af.path.split('/assets/').pop() || '';
        assets.push({ filename, data: buf, contentType: af.content_type });
      } catch {
        // Skip failed assets
      }
    }

    // Install to claimer's workspace
    const result = await installSkill({ skillMd, assets, supabase, userId: user.id });
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, skillName: result.skillName });
  } catch (err) {
    console.error('[skills/claim POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
