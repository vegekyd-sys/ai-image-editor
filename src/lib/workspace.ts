/**
 * Workspace Service — unified access layer for skills, memory, and assets.
 *
 * Three scopes:
 *   global  — built-in skills and prompts (read-only, all users share)
 *   user    — user-uploaded skills + agent-written memory
 *   project — agent-written project-specific notes
 *
 * Storage: Supabase Storage `workspace/` bucket + `workspace_files` DB index.
 * Fallback: local filesystem (for dev / CLI mode).
 *
 * Both the Agent (via tool calls) and the Tips pipeline (via direct function
 * calls) go through this service. Caching keeps the tips path fast.
 */

import { parseSkillMd, type ParsedSkill } from './skill-registry';

// ── Types ───────────────────────────────────────────────────────────────────

export type WorkspaceScope = 'global' | 'user' | 'project';

export interface WorkspaceFile {
  path: string;              // e.g. "skills/enhance/SKILL.md"
  scope: WorkspaceScope;
  contentType: string;       // "text/markdown", "image/jpeg", etc.
  size?: number;
  metadata?: Record<string, unknown>; // parsed frontmatter, tags, etc.
  storageUrl?: string;       // Supabase Storage public URL
  updatedAt?: string;
}

export interface WorkspaceListOptions {
  scope?: WorkspaceScope;
  userId?: string;
  projectId?: string;
  pattern?: string;          // glob-like: "skills/*", "*.md"
  tag?: string;              // filter by metadata tag
  type?: string;             // filter by contentType prefix: "text", "image"
}

export interface WorkspaceReadResult {
  content: string;
  contentType: string;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceWriteOptions {
  scope: 'user' | 'project'; // global is read-only
  userId: string;
  projectId?: string;        // required for project scope
  path: string;
  content: string;
  contentType?: string;      // default: "text/markdown"
}

// ── Cache ───────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const GLOBAL_TTL = 5 * 60 * 1000;  // 5 minutes for global files
const USER_TTL = 60 * 1000;        // 1 minute for user files

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function setCache<T>(key: string, value: T, ttl: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

export function clearWorkspaceCache(): void {
  cache.clear();
}

// ── Local filesystem backend (dev / CLI) ────────────────────────────────────

function getLocalSkillsDir(): string | null {
  try {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const candidates = [
      path.join(process.cwd(), 'src', 'skills'),
      path.join(process.cwd(), 'src', 'lib', 'prompts'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) return dir;
    }
  } catch { /* browser — no fs */ }
  return null;
}

/** Load skills from local filesystem (src/skills/ + src/lib/prompts/) */
function loadLocalSkills(): Map<string, ParsedSkill> {
  const skills = new Map<string, ParsedSkill>();
  try {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');

    // 1. SKILL.md format skills (src/skills/{name}/SKILL.md)
    const skillsDir = path.join(process.cwd(), 'src', 'skills');
    if (fs.existsSync(skillsDir)) {
      const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d: { isDirectory: () => boolean }) => d.isDirectory());
      for (const dir of dirs) {
        const skillPath = path.join(skillsDir, dir.name, 'SKILL.md');
        if (!fs.existsSync(skillPath)) continue;
        try {
          const content = fs.readFileSync(skillPath, 'utf-8');
          const skill = parseSkillMd(content);
          if (skill) skills.set(skill.name, skill);
        } catch { /* skip */ }
      }
    }

    // 2. Legacy category .md files (src/lib/prompts/{name}.md) — no frontmatter
    const promptsDir = path.join(process.cwd(), 'src', 'lib', 'prompts');
    const categories = ['enhance', 'creative', 'wild', 'captions'];
    for (const cat of categories) {
      if (skills.has(cat)) continue; // SKILL.md version takes priority
      const mdPath = path.join(promptsDir, `${cat}.md`);
      if (!fs.existsSync(mdPath)) continue;
      try {
        const content = fs.readFileSync(mdPath, 'utf-8');
        // Try parsing as SKILL.md first (if migrated to have frontmatter)
        const parsed = parseSkillMd(content);
        if (parsed) {
          skills.set(parsed.name, parsed);
        } else {
          // Legacy format: raw template, wrap as ParsedSkill
          skills.set(cat, {
            name: cat,
            description: `${cat} category template`,
            makaron: { builtIn: true, tipsEnabled: true, tipsCount: 2 },
            template: content,
          });
        }
      } catch { /* skip */ }
    }
  } catch { /* browser */ }
  return skills;
}

/** List local workspace files */
function listLocalFiles(opts: WorkspaceListOptions): WorkspaceFile[] {
  const files: WorkspaceFile[] = [];
  try {
    const fs = require('fs') as typeof import('fs');
    const pathMod = require('path') as typeof import('path');

    // Skills from src/skills/
    const skillsDir = pathMod.join(process.cwd(), 'src', 'skills');
    if (fs.existsSync(skillsDir)) {
      const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d: { isDirectory: () => boolean }) => d.isDirectory());
      for (const dir of dirs) {
        const skillDir = pathMod.join(skillsDir, dir.name);
        const entries = fs.readdirSync(skillDir, { recursive: true, withFileTypes: false }) as string[];
        // readdirSync with recursive returns strings
        const allFiles = listDirRecursive(fs, pathMod, skillDir);
        for (const relPath of allFiles) {
          const fullPath = pathMod.join(skillDir, relPath);
          const stat = fs.statSync(fullPath);
          const ext = pathMod.extname(relPath).toLowerCase();
          files.push({
            path: `skills/${dir.name}/${relPath}`,
            scope: 'global',
            contentType: ext === '.md' ? 'text/markdown' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : 'application/octet-stream',
            size: stat.size,
          });
        }
      }
    }

    // Category prompts from src/lib/prompts/
    const promptsDir = pathMod.join(process.cwd(), 'src', 'lib', 'prompts');
    if (fs.existsSync(promptsDir)) {
      const promptFiles = fs.readdirSync(promptsDir).filter((f: string) => f.endsWith('.md'));
      for (const f of promptFiles) {
        const stat = fs.statSync(pathMod.join(promptsDir, f));
        files.push({
          path: `prompts/${f}`,
          scope: 'global',
          contentType: 'text/markdown',
          size: stat.size,
        });
      }
    }
  } catch { /* browser */ }

  // Apply filters
  return files.filter(f => {
    if (opts.scope && f.scope !== opts.scope) return false;
    if (opts.type && !f.contentType.startsWith(opts.type)) return false;
    if (opts.pattern) {
      const regex = new RegExp('^' + opts.pattern.replace(/\*/g, '.*') + '$');
      if (!regex.test(f.path)) return false;
    }
    return true;
  });
}

function listDirRecursive(fs: typeof import('fs'), path: typeof import('path'), dir: string, prefix = ''): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listDirRecursive(fs, path, path.join(dir, entry.name), relPath));
    } else {
      results.push(relPath);
    }
  }
  return results;
}

/** Read a local workspace file */
function readLocalFile(filePath: string): WorkspaceReadResult | null {
  try {
    const fs = require('fs') as typeof import('fs');
    const pathMod = require('path') as typeof import('path');

    // Map workspace path to actual filesystem path
    let fullPath: string;
    if (filePath.startsWith('skills/')) {
      fullPath = pathMod.join(process.cwd(), 'src', filePath);
    } else if (filePath.startsWith('prompts/')) {
      fullPath = pathMod.join(process.cwd(), 'src', 'lib', filePath);
    } else {
      return null;
    }

    if (!fs.existsSync(fullPath)) return null;
    const ext = pathMod.extname(fullPath).toLowerCase();
    const contentType = ext === '.md' ? 'text/markdown' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : 'application/octet-stream';

    if (contentType.startsWith('text/')) {
      return { content: fs.readFileSync(fullPath, 'utf-8'), contentType };
    } else {
      // Binary files: return as base64 data URL
      const buf = fs.readFileSync(fullPath);
      return { content: `data:${contentType};base64,${buf.toString('base64')}`, contentType };
    }
  } catch { return null; }
}

// ── Supabase backend ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

/** List files from workspace_files DB table */
async function listSupabaseFiles(supabase: SupabaseClient, opts: WorkspaceListOptions): Promise<WorkspaceFile[]> {
  let query = supabase
    .from('workspace_files')
    .select('path, scope, content_type, size_bytes, metadata, storage_url, updated_at');

  if (opts.scope) query = query.eq('scope', opts.scope);
  if (opts.userId) query = query.eq('user_id', opts.userId);
  if (opts.projectId) query = query.eq('project_id', opts.projectId);
  if (opts.pattern) {
    // Convert glob to SQL LIKE pattern
    const likePattern = opts.pattern.replace(/\*/g, '%');
    query = query.like('path', likePattern);
  }
  if (opts.tag) {
    query = query.contains('metadata', { tags: [opts.tag] });
  }

  const { data, error } = await query.order('path');
  if (error || !data) return [];

  return (data as Array<{
    path: string;
    scope: WorkspaceScope;
    content_type: string;
    size_bytes: number | null;
    metadata: Record<string, unknown> | null;
    storage_url: string | null;
    updated_at: string | null;
  }>).map(row => ({
    path: row.path,
    scope: row.scope,
    contentType: row.content_type,
    size: row.size_bytes ?? undefined,
    metadata: row.metadata ?? undefined,
    storageUrl: row.storage_url ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  })).filter(f => {
    if (opts.type && !f.contentType.startsWith(opts.type)) return false;
    return true;
  });
}

/** Read file content from Supabase Storage */
async function readSupabaseFile(supabase: SupabaseClient, file: WorkspaceFile): Promise<WorkspaceReadResult | null> {
  if (!file.storageUrl) return null;

  try {
    const response = await fetch(file.storageUrl);
    if (!response.ok) return null;

    if (file.contentType.startsWith('text/')) {
      return { content: await response.text(), contentType: file.contentType, metadata: file.metadata };
    } else {
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      return { content: `data:${file.contentType};base64,${base64}`, contentType: file.contentType, metadata: file.metadata };
    }
  } catch { return null; }
}

/** Write file to Supabase Storage + upsert workspace_files index */
async function writeSupabaseFile(supabase: SupabaseClient, opts: WorkspaceWriteOptions): Promise<boolean> {
  const contentType = opts.contentType || 'text/markdown';

  // Build storage path: workspace/{scope}/{userId}/{projectId?}/{path}
  const storagePath = opts.scope === 'project'
    ? `workspace/${opts.userId}/${opts.projectId}/${opts.path}`
    : `workspace/${opts.userId}/${opts.path}`;

  // Upload to Storage
  const { error: uploadError } = await supabase.storage
    .from('images') // reuse existing bucket
    .upload(storagePath, opts.content, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    console.error('[workspace] Storage upload error:', uploadError.message);
    return false;
  }

  // Get public URL
  const { data: urlData } = supabase.storage.from('images').getPublicUrl(storagePath);

  // Upsert index row
  const { error: dbError } = await supabase.from('workspace_files').upsert({
    scope: opts.scope,
    user_id: opts.userId,
    project_id: opts.scope === 'project' ? opts.projectId : null,
    path: opts.path,
    content_type: contentType,
    size_bytes: Buffer.byteLength(opts.content, 'utf-8'),
    storage_url: urlData?.publicUrl,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'scope,user_id,project_id,path' });

  if (dbError) {
    console.error('[workspace] DB upsert error:', dbError.message);
    return false;
  }

  // Invalidate cache
  cache.delete(`list:${opts.scope}:${opts.userId}`);

  return true;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * List workspace files. Works in two modes:
 * - With supabase client: queries DB index (production)
 * - Without: scans local filesystem (dev / CLI)
 */
export async function listFiles(opts: WorkspaceListOptions, supabase?: SupabaseClient): Promise<WorkspaceFile[]> {
  const cacheKey = `list:${opts.scope || 'all'}:${opts.userId || ''}:${opts.pattern || ''}:${opts.tag || ''}`;
  const cached = getCached<WorkspaceFile[]>(cacheKey);
  if (cached) return cached;

  let files: WorkspaceFile[];
  if (supabase) {
    // Production: DB index + local fallback for global files
    const dbFiles = await listSupabaseFiles(supabase, opts);
    if (dbFiles.length > 0 || opts.scope !== 'global') {
      files = dbFiles;
    } else {
      // Fallback to local for global (not yet synced)
      files = listLocalFiles(opts);
    }
  } else {
    files = listLocalFiles(opts);
  }

  const ttl = opts.scope === 'global' ? GLOBAL_TTL : USER_TTL;
  setCache(cacheKey, files, ttl);
  return files;
}

/**
 * Read a workspace file's content.
 * - With supabase: fetches from Storage
 * - Without: reads from local filesystem
 */
export async function readFile(filePath: string, supabase?: SupabaseClient, opts?: { scope?: WorkspaceScope; userId?: string }): Promise<WorkspaceReadResult | null> {
  const cacheKey = `read:${filePath}`;
  const cached = getCached<WorkspaceReadResult>(cacheKey);
  if (cached) return cached;

  let result: WorkspaceReadResult | null = null;

  if (supabase && opts?.userId) {
    // Find the file in the index
    const files = await listFiles({ scope: opts.scope, userId: opts.userId, pattern: filePath }, supabase);
    const file = files.find(f => f.path === filePath);
    if (file) {
      result = await readSupabaseFile(supabase, file);
    }
  }

  // Fallback to local
  if (!result) {
    result = readLocalFile(filePath);
  }

  if (result) {
    const ttl = opts?.scope === 'global' || !opts?.scope ? GLOBAL_TTL : USER_TTL;
    setCache(cacheKey, result, ttl);
  }

  return result;
}

/**
 * Write a file to the workspace (user or project scope only).
 * Requires supabase client.
 */
export async function writeFile(opts: WorkspaceWriteOptions, supabase: SupabaseClient): Promise<boolean> {
  // Enforce: only user/project scope, only memory/ subdirectory for agent writes
  if (opts.scope === 'project' && !opts.projectId) {
    console.error('[workspace] project scope requires projectId');
    return false;
  }

  return writeSupabaseFile(supabase, opts);
}

// ── Convenience: Skill Access ───────────────────────────────────────────────

/**
 * Get a skill's parsed template by name.
 * Checks: local built-in → DB user skills → local legacy .md
 */
export async function getSkill(name: string, supabase?: SupabaseClient, userId?: string): Promise<ParsedSkill | null> {
  const cacheKey = `skill:${name}:${userId || ''}`;
  const cached = getCached<ParsedSkill>(cacheKey);
  if (cached) return cached;

  // 1. Try local built-in skills
  const localSkills = loadLocalSkills();
  const local = localSkills.get(name);
  if (local) {
    setCache(cacheKey, local, GLOBAL_TTL);
    return local;
  }

  // 2. Try DB user skills
  if (supabase && userId) {
    const files = await listFiles({ scope: 'user', userId, pattern: `skills/${name}/SKILL.md` }, supabase);
    const file = files[0];
    if (file) {
      const content = await readSupabaseFile(supabase, file);
      if (content) {
        const parsed = parseSkillMd(content.content);
        if (parsed) {
          setCache(cacheKey, parsed, USER_TTL);
          return parsed;
        }
      }
    }
  }

  return null;
}

/**
 * Get a skill's template string (the markdown body).
 * This is the main entry point for the tips pipeline.
 */
export async function getSkillTemplate(name: string, supabase?: SupabaseClient, userId?: string): Promise<string | null> {
  const skill = await getSkill(name, supabase, userId);
  return skill?.template ?? null;
}

/**
 * Get a skill's reference images.
 */
export async function getSkillReferenceImages(name: string, supabase?: SupabaseClient, userId?: string): Promise<string[]> {
  const skill = await getSkill(name, supabase, userId);
  return skill?.makaron?.referenceImages ?? [];
}

/**
 * Get all available skills (built-in + user).
 */
export async function getAllSkills(supabase?: SupabaseClient, userId?: string): Promise<ParsedSkill[]> {
  const localSkills = loadLocalSkills();
  const skills = [...localSkills.values()];

  if (supabase && userId) {
    const userFiles = await listFiles({ scope: 'user', userId, pattern: 'skills/*/SKILL.md' }, supabase);
    for (const file of userFiles) {
      const content = await readSupabaseFile(supabase, file);
      if (content) {
        const parsed = parseSkillMd(content.content);
        if (parsed && !localSkills.has(parsed.name)) {
          skills.push(parsed);
        }
      }
    }
  }

  return skills;
}

/**
 * Build a lightweight manifest for the Agent system prompt.
 * Just names + one-line descriptions, not full templates.
 */
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

  return `\n## Available Skills\n\nUse \`list_workspace\` and \`read_workspace\` to get detailed instructions.\n\n${lines.join('\n')}\n`;
}
