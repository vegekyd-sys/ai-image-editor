/**
 * Seed built-in skills into workspace_files table.
 * Run once: node scripts/seed-builtin-skills.mjs
 *
 * Reads from src/skills/{name}/ → uploads assets to Storage → writes workspace_files rows.
 * Uses user_id = NULL for global/built-in skills (visible to all users).
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SKILLS_DIR = path.join(process.cwd(), 'src', 'skills');
const STORAGE_BUCKET = 'images';
const STORAGE_PREFIX = 'workspace/_global'; // global skills use _global prefix

function listDirRecursive(dir, prefix = '') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listDirRecursive(path.join(dir, entry.name), relPath));
    } else {
      results.push(relPath);
    }
  }
  return results;
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = { '.md': 'text/markdown', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
  return map[ext] || 'application/octet-stream';
}

async function seedSkill(skillName) {
  const skillDir = path.join(SKILLS_DIR, skillName);
  if (!fs.existsSync(skillDir)) {
    console.log(`⚠️ Skill dir not found: ${skillDir}`);
    return;
  }

  const files = listDirRecursive(skillDir);
  console.log(`📦 Seeding ${skillName}: ${files.length} files`);

  for (const relPath of files) {
    const fullPath = path.join(skillDir, relPath);
    const wsPath = `skills/${skillName}/${relPath}`;
    const storagePath = `${STORAGE_PREFIX}/${wsPath}`;
    const ct = mimeType(relPath);
    const content = fs.readFileSync(fullPath);

    // Upload to Storage
    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, content, { contentType: ct, upsert: true });

    if (uploadErr) {
      console.error(`  ❌ Upload ${wsPath}: ${uploadErr.message}`);
      continue;
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

    // Upsert workspace_files row (user_id = NULL for global)
    const { error: dbErr } = await supabase.from('workspace_files').upsert({
      user_id: null,
      path: wsPath,
      storage_url: urlData.publicUrl,
      content_type: ct,
      size_bytes: content.length,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,path' });

    if (dbErr) {
      console.error(`  ❌ DB ${wsPath}: ${dbErr.message}`);
    } else {
      console.log(`  ✅ ${wsPath} (${(content.length / 1024).toFixed(1)}KB)`);
    }
  }
}

async function main() {
  // Find all skill directories
  const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  console.log(`Found ${dirs.length} built-in skills: ${dirs.join(', ')}\n`);

  for (const dir of dirs) {
    await seedSkill(dir);
    console.log();
  }

  console.log('✅ Done!');
}

main().catch(console.error);
