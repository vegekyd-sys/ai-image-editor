import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadBuiltInSkills, parseSkillMd } from '@/lib/skill-registry';
import JSZip from 'jszip';

// GET — list built-in + user skills
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    // Built-in skills
    const builtIn = [...loadBuiltInSkills().values()].map(s => ({
      name: s.name,
      label: s.name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
      icon: s.makaron.icon || '',
      color: s.makaron.color || '#a78bfa',
      builtIn: true,
      description: s.description,
    }));

    // User skills (if logged in)
    let userSkills: typeof builtIn = [];
    if (userId) {
      const { data } = await supabase
        .from('user_skills')
        .select('name, skill_md, is_active')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (data) {
        userSkills = data.map(row => {
          const parsed = parseSkillMd(row.skill_md);
          return {
            name: parsed?.name || row.name,
            label: (parsed?.name || row.name).split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' '),
            icon: parsed?.makaron.icon || '📦',
            color: parsed?.makaron.color || '#a78bfa',
            builtIn: false,
            description: parsed?.description || '',
          };
        });
      }
    }

    return NextResponse.json({ skills: [...builtIn, ...userSkills] });
  } catch (err) {
    console.error('[skills GET]', err);
    return NextResponse.json({ error: 'Failed to load skills' }, { status: 500 });
  }
}

// POST — upload zip to create a new user skill
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    // Read zip
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    // Find SKILL.md (could be at root or in a subdirectory)
    let skillMdContent: string | null = null;
    let skillMdPath = '';
    for (const [path, entry] of Object.entries(zip.files)) {
      if (path.endsWith('SKILL.md') && !entry.dir) {
        skillMdContent = await entry.async('string');
        skillMdPath = path;
        break;
      }
    }

    if (!skillMdContent) {
      return NextResponse.json({ error: 'No SKILL.md found in zip' }, { status: 400 });
    }

    // Parse SKILL.md
    const parsed = parseSkillMd(skillMdContent);
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid SKILL.md format' }, { status: 400 });
    }

    // Upload assets to Supabase Storage
    const skillDir = skillMdPath.includes('/') ? skillMdPath.substring(0, skillMdPath.lastIndexOf('/') + 1) : '';
    const assetsPrefix = skillDir + 'assets/';
    const uploadedUrls: Record<string, string> = {};

    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir || !path.startsWith(assetsPrefix)) continue;
      const data = await entry.async('uint8array');
      const filename = path.substring(assetsPrefix.length);
      const storagePath = `${user.id}/skills/${parsed.name}/${filename}`;

      const { error: uploadErr } = await supabase.storage
        .from('images')
        .upload(storagePath, data, {
          contentType: filename.endsWith('.png') ? 'image/png' : 'image/jpeg',
          upsert: true,
        });

      if (uploadErr) {
        console.error(`[skills POST] Upload failed for ${filename}:`, uploadErr);
        continue;
      }

      const { data: urlData } = supabase.storage.from('images').getPublicUrl(storagePath);
      uploadedUrls[`assets/${filename}`] = urlData.publicUrl;
    }

    // Replace relative asset paths in SKILL.md with Supabase URLs
    let finalSkillMd = skillMdContent;
    for (const [relativePath, publicUrl] of Object.entries(uploadedUrls)) {
      finalSkillMd = finalSkillMd.replace(new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), publicUrl);
    }

    // Upsert to user_skills table
    const { error: dbErr } = await supabase
      .from('user_skills')
      .upsert({
        user_id: user.id,
        name: parsed.name,
        skill_md: finalSkillMd,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,name' });

    if (dbErr) {
      console.error('[skills POST] DB error:', dbErr);
      return NextResponse.json({ error: 'Failed to save skill' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      name: parsed.name,
      assetsUploaded: Object.keys(uploadedUrls).length,
    });
  } catch (err) {
    console.error('[skills POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE — remove a user skill
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name } = await req.json();
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

    await supabase.from('user_skills').delete().eq('user_id', user.id).eq('name', name);

    // Clean up storage
    const { data: files } = await supabase.storage.from('images').list(`${user.id}/skills/${name}`);
    if (files?.length) {
      await supabase.storage.from('images').remove(files.map(f => `${user.id}/skills/${name}/${f.name}`));
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[skills DELETE]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
