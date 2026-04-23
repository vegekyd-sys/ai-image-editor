import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSkill } from '@/lib/workspace';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { skillName } = await req.json();
    if (!skillName) return NextResponse.json({ error: 'skillName required' }, { status: 400 });

    const skill = await getSkill(skillName, supabase, user.id);
    if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });

    const code = crypto.randomUUID().replace(/-/g, '').slice(0, 8);

    const { error } = await supabase.from('skill_shares').insert({
      code,
      sharer_id: user.id,
      skill_name: skillName,
    });

    if (error) {
      console.error('[skills/share POST]', error);
      return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.makaron.app';
    return NextResponse.json({ code, url: `${baseUrl}/s/${code}` });
  } catch (err) {
    console.error('[skills/share POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
