/**
 * Workspace Service — unified file system backed by Supabase.
 *
 * All files stored in Supabase Storage (`images` bucket, `workspace/{userId}/{path}`).
 * `workspace_files` table is the index (path → storage_url mapping).
 *
 * Built-in skills (src/skills/, src/lib/prompts/) are loaded from local filesystem
 * as fallback when not in DB. Will be migrated to DB via seed script.
 *
 * Path conventions:
 *   skills/{name}/SKILL.md         — User-level skill
 *   skills/{name}/assets/{file}    — Skill reference images
 *   memory/{file}                  — User-level memory (hidden this release)
 *   projects/{id}/...              — Project-level (hidden this release)
 */

import { parseSkillMd, type ParsedSkill } from './skill-registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

// ── Types ───────────────────────────────────────────────────────────────────

export interface WorkspaceFile {
  path: string;
  contentType: string;
  size?: number;
  storageUrl?: string;
  updatedAt?: string;
  isBuiltIn?: boolean;  // true for src/skills/ files
}

export interface WorkspaceReadResult {
  content: string;       // text content or data:... URL for binary
  contentType: string;
  storageUrl?: string;
}

// ── Cache ───────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 60 * 1000; // 1 minute

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function setCache<T>(key: string, value: T, ttl = CACHE_TTL): void {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

export function clearWorkspaceCache(): void {
  cache.clear();
}

// ── MIME type helpers ──────────────────────────────────────────────────────

function extToContentType(ext: string): string {
  const map: Record<string, string> = {
    '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
    '.zip': 'application/zip',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

function pathToContentType(filePath: string): string {
  const ext = filePath.includes('.') ? '.' + filePath.split('.').pop()!.toLowerCase() : '';
  return extToContentType(ext);
}

// ── Supabase operations ────────────────────────────────────────────────────

/** Storage path: {userId}/workspace/{path} — first folder must be userId for RLS */
function storagePath(userId: string, path: string): string {
  return `${userId}/workspace/${path}`;
}

/** List files from workspace_files table */
async function dbListFiles(supabase: SupabaseClient, userId: string, pattern?: string): Promise<WorkspaceFile[]> {
  let query = supabase
    .from('workspace_files')
    .select('path, content_type, size_bytes, storage_url, updated_at')
    .or(`user_id.eq.${userId},user_id.is.null`); // own files + global

  if (pattern) {
    const likePattern = pattern.replace(/\*/g, '%');
    query = query.like('path', likePattern);
  }

  const { data, error } = await query.order('path');
  if (error) {
    console.error('[workspace] list error:', error.message);
    return [];
  }

  return (data || []).map((row: { path: string; content_type: string; size_bytes: number | null; storage_url: string; updated_at: string | null }) => ({
    path: row.path,
    contentType: row.content_type,
    size: row.size_bytes ?? undefined,
    storageUrl: row.storage_url,
    updatedAt: row.updated_at ?? undefined,
  }));
}

/** Read file content from Storage via its URL */
async function fetchFileContent(storageUrl: string, contentType: string): Promise<WorkspaceReadResult | null> {
  try {
    const response = await fetch(storageUrl);
    if (!response.ok) return null;

    if (contentType.startsWith('text/') || contentType === 'application/json') {
      return { content: await response.text(), contentType, storageUrl };
    } else {
      const buffer = await response.arrayBuffer();
      return { content: `data:${contentType};base64,${Buffer.from(buffer).toString('base64')}`, contentType, storageUrl };
    }
  } catch (e) {
    console.error('[workspace] fetch error:', e);
    return null;
  }
}

/** Write file to Storage + upsert workspace_files row */
async function dbWriteFile(
  supabase: SupabaseClient,
  userId: string,
  path: string,
  content: string | Buffer,
  contentType?: string,
  marketplaceId?: string,
): Promise<{ success: boolean; storageUrl?: string; error?: string }> {
  const ct = contentType || pathToContentType(path);
  const sp = storagePath(userId, path);
  const isText = ct.startsWith('text/') || ct === 'application/json';
  const body = isText && typeof content === 'string' ? content : (Buffer.isBuffer(content) ? content : Buffer.from(content));
  const sizeBytes = typeof content === 'string' ? Buffer.byteLength(content, 'utf-8') : (Buffer.isBuffer(content) ? content.length : 0);

  // Upload to Storage
  const { error: uploadError } = await supabase.storage
    .from('images')
    .upload(sp, body, { contentType: ct, upsert: true });

  if (uploadError) {
    console.error('[workspace] upload error:', uploadError.message);
    return { success: false, error: uploadError.message };
  }

  // Get public URL
  const { data: urlData } = supabase.storage.from('images').getPublicUrl(sp);
  const publicUrl = urlData?.publicUrl;

  // Upsert index row
  const { error: dbError } = await supabase.from('workspace_files').upsert({
    user_id: userId,
    path,
    content_type: ct,
    size_bytes: sizeBytes,
    storage_url: publicUrl,
    updated_at: new Date().toISOString(),
    ...(marketplaceId ? { marketplace_id: marketplaceId } : {}),
  }, { onConflict: 'user_id,path' });

  if (dbError) {
    console.error('[workspace] db upsert error:', dbError.message);
    return { success: false, error: dbError.message };
  }

  cache.clear();
  return { success: true, storageUrl: publicUrl };
}

/** Delete file from Storage + workspace_files */
async function dbDeleteFile(supabase: SupabaseClient, userId: string, path: string): Promise<boolean> {
  const sp = storagePath(userId, path);

  // Delete from Storage
  await supabase.storage.from('images').remove([sp]);

  // Delete from DB
  const { error } = await supabase.from('workspace_files')
    .delete()
    .eq('user_id', userId)
    .eq('path', path);

  if (error) {
    console.error('[workspace] delete error:', error.message);
    return false;
  }

  cache.clear();
  return true;
}

// ── Local filesystem fallback (built-in skills + prompts) ──────────────────

function listDirRecursive(dir: string, prefix = ''): string[] {
  try {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...listDirRecursive(path.join(dir, entry.name), relPath));
      } else {
        results.push(relPath);
      }
    }
    return results;
  } catch { return []; }
}

/** List built-in skill files from src/skills/ (local, read-only) */
export function listBuiltInFiles(pattern?: string): WorkspaceFile[] {
  const files: WorkspaceFile[] = [];
  try {
    const fs = require('fs') as typeof import('fs');
    const pathMod = require('path') as typeof import('path');

    const skillsDir = pathMod.join(process.cwd(), 'src', 'skills');
    if (fs.existsSync(skillsDir)) {
      const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d: { isDirectory: () => boolean }) => d.isDirectory());
      for (const dir of dirs) {
        const allFiles = listDirRecursive(pathMod.join(skillsDir, dir.name));
        for (const relPath of allFiles) {
          const fullPath = pathMod.join(skillsDir, dir.name, relPath);
          const stat = fs.statSync(fullPath);
          const ext = pathMod.extname(relPath).toLowerCase();
          files.push({
            path: `skills/${dir.name}/${relPath}`,
            contentType: extToContentType(ext),
            size: stat.size,
            isBuiltIn: true,
          });
        }
      }
    }

    // Legacy prompts
    const promptsDir = pathMod.join(process.cwd(), 'src', 'lib', 'prompts');
    if (fs.existsSync(promptsDir)) {
      const mds = fs.readdirSync(promptsDir).filter((f: string) => f.endsWith('.md'));
      for (const f of mds) {
        const stat = fs.statSync(pathMod.join(promptsDir, f));
        files.push({ path: `prompts/${f}`, contentType: 'text/markdown', size: stat.size, isBuiltIn: true });
      }
    }
  } catch { /* browser */ }

  if (pattern) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return files.filter(f => regex.test(f.path));
  }
  return files;
}

/** Read a built-in file from local filesystem */
export function readBuiltInFile(filePath: string): WorkspaceReadResult | null {
  try {
    const fs = require('fs') as typeof import('fs');
    const pathMod = require('path') as typeof import('path');

    let fullPath: string | null = null;
    if (filePath.startsWith('skills/')) {
      fullPath = pathMod.join(process.cwd(), 'src', filePath);
    } else if (filePath.startsWith('prompts/')) {
      fullPath = pathMod.join(process.cwd(), 'src', 'lib', filePath);
    }
    if (!fullPath || !fs.existsSync(fullPath)) return null;

    const ext = pathMod.extname(fullPath).toLowerCase();
    const ct = extToContentType(ext);
    if (ct.startsWith('text/') || ct === 'application/json') {
      return { content: fs.readFileSync(fullPath, 'utf-8'), contentType: ct };
    } else {
      const buf = fs.readFileSync(fullPath);
      return { content: `data:${ct};base64,${buf.toString('base64')}`, contentType: ct };
    }
  } catch { return null; }
}

/** Load built-in skills as ParsedSkill map (for skill manifest + getSkill) */
function loadBuiltInSkills(): Map<string, ParsedSkill> {
  const cacheKey = 'builtInSkills';
  const cached = getCached<Map<string, ParsedSkill>>(cacheKey);
  if (cached) return cached;

  const skills = new Map<string, ParsedSkill>();
  try {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');

    // src/skills/
    const skillsDir = path.join(process.cwd(), 'src', 'skills');
    if (fs.existsSync(skillsDir)) {
      const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d: { isDirectory: () => boolean }) => d.isDirectory());
      for (const dir of dirs) {
        const p = path.join(skillsDir, dir.name, 'SKILL.md');
        if (!fs.existsSync(p)) continue;
        const parsed = parseSkillMd(fs.readFileSync(p, 'utf-8'));
        if (parsed) skills.set(parsed.name, parsed);
      }
    }

    // Legacy prompts
    const promptsDir = path.join(process.cwd(), 'src', 'lib', 'prompts');
    for (const cat of ['enhance', 'creative', 'wild', 'captions']) {
      if (skills.has(cat)) continue;
      const p = path.join(promptsDir, `${cat}.md`);
      if (!fs.existsSync(p)) continue;
      const content = fs.readFileSync(p, 'utf-8');
      const parsed = parseSkillMd(content);
      if (parsed) {
        skills.set(parsed.name, parsed);
      } else {
        skills.set(cat, { name: cat, description: `${cat} template`, makaron: { builtIn: true, tipsEnabled: true, tipsCount: 2 }, template: content });
      }
    }
  } catch { /* browser */ }

  setCache(cacheKey, skills, 5 * 60 * 1000);
  return skills;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * List workspace files.
 * Combines: workspace_files table (user's) + built-in skills (local).
 */
export async function listFiles(pattern?: string, supabase?: SupabaseClient, userId?: string): Promise<WorkspaceFile[]> {
  const cacheKey = `list:${userId || ''}:${pattern || ''}`;
  const cached = getCached<WorkspaceFile[]>(cacheKey);
  if (cached) return cached;

  // Built-in files (always available)
  const builtIn = listBuiltInFiles(pattern);

  // User files from DB
  let userFiles: WorkspaceFile[] = [];
  if (supabase && userId) {
    userFiles = await dbListFiles(supabase, userId, pattern);
  }

  // Merge: user files override built-in if same path
  const pathSet = new Set(userFiles.map(f => f.path));
  const merged = [...userFiles, ...builtIn.filter(f => !pathSet.has(f.path))];

  setCache(cacheKey, merged);
  return merged;
}

/**
 * Read a workspace file's content.
 * Tries: workspace_files (Supabase) → built-in (local).
 */
export async function readFile(filePath: string, supabase?: SupabaseClient, userId?: string): Promise<WorkspaceReadResult | null> {
  const cacheKey = `read:${userId || ''}:${filePath}`;
  const cached = getCached<WorkspaceReadResult>(cacheKey);
  if (cached) return cached;

  // Try Supabase first
  if (supabase && userId) {
    const files = await dbListFiles(supabase, userId, filePath);
    const file = files.find(f => f.path === filePath);
    if (file?.storageUrl) {
      const result = await fetchFileContent(file.storageUrl, file.contentType);
      if (result) { setCache(cacheKey, result); return result; }
    }
  }

  // Fallback to built-in
  const builtIn = readBuiltInFile(filePath);
  if (builtIn) { setCache(cacheKey, builtIn); return builtIn; }

  return null;
}

/**
 * Write a file to workspace.
 * Uploads to Supabase Storage + upserts workspace_files index.
 */
export async function writeFile(
  filePath: string,
  content: string | Buffer,
  supabase: SupabaseClient,
  userId: string,
  contentType?: string,
  marketplaceId?: string,
): Promise<{ success: boolean; storageUrl?: string; error?: string }> {
  return dbWriteFile(supabase, userId, filePath, content, contentType, marketplaceId);
}

/**
 * Delete a file from workspace.
 */
export async function deleteFile(filePath: string, supabase: SupabaseClient, userId: string): Promise<boolean> {
  return dbDeleteFile(supabase, userId, filePath);
}

// ── Skill install (shared by ZIP upload + claim) ─────────────────────────

export interface SkillAsset {
  filename: string;
  data: Buffer;
  contentType: string;
}

export async function installSkill(opts: {
  skillMd: string;
  assets: SkillAsset[];
  supabase: SupabaseClient;
  userId: string;
  marketplaceId?: string;
}): Promise<{ success: boolean; skillName: string; error?: string }> {
  const { skillMd, assets, supabase, userId, marketplaceId } = opts;

  const parsed = parseSkillMd(skillMd);
  if (!parsed) return { success: false, skillName: '', error: 'Invalid SKILL.md format' };

  let finalName = parsed.name;
  const existing = await getAllSkills(supabase, userId);
  const existingNames = new Set(existing.map(s => s.name));
  if (existingNames.has(finalName)) {
    let i = 2;
    while (existingNames.has(`${parsed.name}-${i}`)) i++;
    finalName = `${parsed.name}-${i}`;
  }

  const uploadedUrls: Record<string, string> = {};
  for (const asset of assets) {
    const wsPath = `skills/${finalName}/assets/${asset.filename}`;
    const result = await writeFile(wsPath, asset.data, supabase, userId, asset.contentType);
    if (result.success && result.storageUrl) {
      uploadedUrls[`assets/${asset.filename}`] = result.storageUrl;
    }
  }

  let finalMd = skillMd;
  if (finalName !== parsed.name) {
    finalMd = finalMd.replace(/^name:\s*.+$/m, `name: ${finalName}`);
  }
  for (const [relativePath, publicUrl] of Object.entries(uploadedUrls)) {
    finalMd = finalMd.replace(new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), publicUrl);
  }

  const mdResult = await writeFile(`skills/${finalName}/SKILL.md`, finalMd, supabase, userId, 'text/markdown', marketplaceId);
  if (!mdResult.success) {
    return { success: false, skillName: finalName, error: `Failed to save SKILL.md: ${mdResult.error}` };
  }

  return { success: true, skillName: finalName };
}

// ── Skill convenience methods ──────────────────────────────────────────────

/** Get a skill by name. Checks: DB user skills → built-in skills. */
export async function getSkill(name: string, supabase?: SupabaseClient, userId?: string): Promise<ParsedSkill | null> {
  const cacheKey = `skill:${name}:${userId || ''}`;
  const cached = getCached<ParsedSkill>(cacheKey);
  if (cached) return cached;

  // Try DB
  if (supabase && userId) {
    const result = await readFile(`skills/${name}/SKILL.md`, supabase, userId);
    if (result) {
      const parsed = parseSkillMd(result.content);
      if (parsed) { setCache(cacheKey, parsed); return parsed; }
    }
  }

  // Try built-in
  const builtIn = loadBuiltInSkills().get(name);
  if (builtIn) { setCache(cacheKey, builtIn); return builtIn; }

  return null;
}

/** Get a skill's template string. Main entry for tips pipeline. */
export async function getSkillTemplate(name: string, supabase?: SupabaseClient, userId?: string): Promise<string | null> {
  const skill = await getSkill(name, supabase, userId);
  return skill?.template ?? null;
}

// Legacy prompt names — these are tips templates, not user-facing skills
const LEGACY_PROMPTS = new Set(['enhance', 'creative', 'wild', 'captions']);

/** Get all skills (built-in SKILL.md + user). Excludes legacy prompt templates. */
export async function getAllSkills(supabase?: SupabaseClient, userId?: string): Promise<ParsedSkill[]> {
  const builtIn = loadBuiltInSkills();
  // Filter out legacy prompts — they're for tips pipeline, not user-selectable skills
  const skills = [...builtIn.values()].filter(s => !LEGACY_PROMPTS.has(s.name));

  if (supabase && userId) {
    const userFiles = await dbListFiles(supabase, userId, 'skills/%/SKILL.md');
    for (const file of userFiles) {
      if (!file.storageUrl) continue;
      const result = await fetchFileContent(file.storageUrl, file.contentType);
      if (result) {
        const parsed = parseSkillMd(result.content);
        if (parsed && !builtIn.has(parsed.name)) {
          skills.push(parsed);
        }
      }
    }
  }

  return skills;
}

/** Build lightweight skill manifest for Agent system prompt. */
export async function getSkillManifest(supabase?: SupabaseClient, userId?: string): Promise<string> {
  const skills = await getAllSkills(supabase, userId);
  if (skills.length === 0) return '';

  const lines = skills.map(s => {
    const extras: string[] = [];
    if (s.makaron?.referenceImages?.length) extras.push('has reference images');
    if (s.makaron?.modelPreference?.length) extras.push(`prefers: ${s.makaron.modelPreference.join('/')}`);
    const suffix = extras.length ? ` [${extras.join(', ')}]` : '';
    return `- **${s.name}**: ${s.description.trim().split('\n')[0]}${suffix}`;
  });

  return `\n## Available Skills\n\n${lines.join('\n')}\n`;
}
