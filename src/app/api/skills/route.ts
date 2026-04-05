import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseSkillMd } from '@/lib/skill-registry';
import { getAllSkills, writeFile, deleteFile, listFiles } from '@/lib/workspace';
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

// POST — upload zip to create a new user skill (via workspace)
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

    // Find SKILL.md
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

    const parsed = parseSkillMd(skillMdContent);
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid SKILL.md format' }, { status: 400 });
    }

    // Upload assets via workspace
    const skillDir = skillMdPath.includes('/') ? skillMdPath.substring(0, skillMdPath.lastIndexOf('/') + 1) : '';
    const assetsPrefix = skillDir + 'assets/';
    const uploadedUrls: Record<string, string> = {};

    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir || !path.startsWith(assetsPrefix)) continue;
      const data = await entry.async('nodebuffer');
      const filename = path.substring(assetsPrefix.length);
      const ct = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const wsPath = `skills/${parsed.name}/assets/${filename}`;

      const result = await writeFile(wsPath, data, supabase, user.id, ct);
      if (result.success && result.storageUrl) {
        uploadedUrls[`assets/${filename}`] = result.storageUrl;
      }
    }

    // Replace relative asset paths with Storage URLs
    let finalSkillMd = skillMdContent;
    for (const [relativePath, publicUrl] of Object.entries(uploadedUrls)) {
      finalSkillMd = finalSkillMd.replace(new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), publicUrl);
    }

    // Save SKILL.md via workspace
    const mdResult = await writeFile(`skills/${parsed.name}/SKILL.md`, finalSkillMd, supabase, user.id, 'text/markdown');
    if (!mdResult.success) {
      return NextResponse.json({ error: `Failed to save SKILL.md: ${mdResult.error}` }, { status: 500 });
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

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[skills DELETE]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
