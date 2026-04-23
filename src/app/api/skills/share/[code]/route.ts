import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/service';
import { parseSkillMd } from '@/lib/skill-registry';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const admin = getSupabaseAdmin();

    const { data: share, error } = await admin
      .from('skill_shares')
      .select('sharer_id, skill_name')
      .eq('code', code)
      .single();

    if (error || !share) {
      return NextResponse.json({ expired: true }, { status: 404 });
    }

    // Read the skill's SKILL.md — try sharer's copy first, then any available copy
    const skillPath = `skills/${share.skill_name}/SKILL.md`;
    const { data: candidates } = await admin
      .from('workspace_files')
      .select('storage_url, content_type, user_id')
      .eq('path', skillPath)
      .order('updated_at', { ascending: false })
      .limit(5);

    // Prefer sharer's own copy, then any other
    const skillFile = candidates?.find((f: { user_id: string | null }) => f.user_id === share.sharer_id)
      || candidates?.[0];

    if (!skillFile?.storage_url) {
      return NextResponse.json({ expired: true }, { status: 404 });
    }

    const resp = await fetch(skillFile.storage_url);
    if (!resp.ok) {
      return NextResponse.json({ expired: true }, { status: 404 });
    }

    const skillMd = await resp.text();
    const parsed = parseSkillMd(skillMd);
    if (!parsed) {
      return NextResponse.json({ expired: true }, { status: 404 });
    }

    return NextResponse.json({
      skillName: parsed.name,
      description: parsed.description || '',
      icon: parsed.makaron?.icon || '',
      color: parsed.makaron?.color || '#a78bfa',
    });
  } catch (err) {
    console.error('[skills/share/[code] GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
