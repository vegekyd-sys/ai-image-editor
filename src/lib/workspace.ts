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

import { createWriteStream, existsSync } from 'fs';
import { createHash } from 'crypto';
import { mkdir, open, readFile as readLocalFile, stat, writeFile as writeLocalFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { parseSkillMd, type ParsedSkill } from './skill-registry';
import builtInSkillManifest from '../generated/built-in-skill-manifest.json';


type SupabaseClient = any;

interface BuiltInSkillManifestEntry {
  name: string;
  description: string;
  referenceImages?: string[];
  modelPreference?: string[];
  studioRunRecipe?: string;
  studioRunProfile?: string;
  sourceMediaRequired?: boolean;
}

interface UserSkillManifestEntry {
  schemaVersion: 1;
  name: string;
  path: string;
  description: string;
  triggers: string[];
  modelPreference: string[];
  referenceImages: string[];
  contentHash: string;
  contentHashSource: 'skill-md' | 'frontmatter-and-workspace-metadata';
  sourceSize?: number;
  sourceUpdatedAt?: string;
}

const USER_SKILL_INDEX_FILENAME = '.makaron-skill-index.json';
const USER_SKILL_FRONTMATTER_CHUNK_BYTES = 512;
const USER_SKILL_FRONTMATTER_MAX_BYTES = 16 * 1024;
const USER_SKILL_INDEX_MAX_BYTES = 32 * 1024;

// ── Types ───────────────────────────────────────────────────────────────────

export interface WorkspaceFile {
  path: string;
  contentType: string;
  size?: number;
  storageUrl?: string;
  updatedAt?: string;
  isBuiltIn?: boolean;  // true for src/skills/ files
  localPath?: string;
  localAvailable?: boolean;
}

export interface WorkspaceReadResult {
  content: string;       // text content or data:... URL for binary
  contentType: string;
  storageUrl?: string;
  path?: string;
  localPath?: string;
}

export interface WorkspaceFileHandle {
  path: string;
  contentType: string;
  size?: number;
  storageUrl?: string;
  updatedAt?: string;
  localPath?: string;
  localAvailable: boolean;
  hydrated?: boolean;
  isBuiltIn?: boolean;
}

export interface WorkspaceWriteResult {
  success: boolean;
  storageUrl?: string;
  localPath?: string;
  size?: number;
  updatedAt?: string;
  error?: string;
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

function userSkillNameFromPath(filePath: string): string | null {
  return filePath.match(/^skills\/([^/]+)\/SKILL\.md$/)?.[1] || null;
}

function userSkillIndexPath(skillName: string): string {
  return `skills/${skillName}/${USER_SKILL_INDEX_FILENAME}`;
}

function isUserSkillIndexPath(filePath: string): boolean {
  return filePath.endsWith(`/${USER_SKILL_INDEX_FILENAME}`);
}

function compactSemanticText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function compactStringList(values: unknown, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(values)) return [];
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const compact = compactSemanticText(value, maxItemLength);
    if (compact) unique.add(compact);
    if (unique.size >= maxItems) break;
  }
  return [...unique];
}

function skillContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function buildUserSkillManifestEntry(
  filePath: string,
  skillMd: string,
  source: Pick<WorkspaceFile, 'size' | 'updatedAt'> = {},
  hashOverride?: string,
): UserSkillManifestEntry | null {
  const pathName = userSkillNameFromPath(filePath);
  const parsed = parseSkillMd(skillMd);
  if (!pathName || !parsed) return null;

  const description = compactSemanticText(parsed.description, 2_400);
  if (!description) return null;
  const triggers = compactStringList(
    [...(parsed.makaron.triggers || []), ...(parsed.makaron.tags || [])],
    32,
    240,
  );

  return {
    schemaVersion: 1,
    name: pathName,
    path: filePath,
    description,
    triggers,
    modelPreference: compactStringList(parsed.makaron.modelPreference, 8, 120),
    referenceImages: compactStringList(parsed.makaron.referenceImages, 16, 2_000),
    contentHash: hashOverride || skillContentHash(skillMd),
    contentHashSource: hashOverride ? 'frontmatter-and-workspace-metadata' : 'skill-md',
    ...(source.size != null ? { sourceSize: source.size } : {}),
    ...(source.updatedAt ? { sourceUpdatedAt: source.updatedAt } : {}),
  };
}

function parseUserSkillManifestEntry(raw: string, skillFile: WorkspaceFile): UserSkillManifestEntry | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const value = candidate as Record<string, unknown>;
  const expectedName = userSkillNameFromPath(skillFile.path);
  if (
    value.schemaVersion !== 1
    || typeof value.name !== 'string'
    || value.name !== expectedName
    || value.path !== skillFile.path
    || typeof value.description !== 'string'
    || !value.description.trim()
    || typeof value.contentHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.contentHash)
    || (value.contentHashSource !== 'skill-md' && value.contentHashSource !== 'frontmatter-and-workspace-metadata')
  ) {
    return null;
  }
  if (skillFile.size != null && value.sourceSize != null && value.sourceSize !== skillFile.size) return null;
  if (skillFile.updatedAt && value.sourceUpdatedAt && value.sourceUpdatedAt !== skillFile.updatedAt) return null;

  return {
    schemaVersion: 1,
    name: value.name,
    path: skillFile.path,
    description: compactSemanticText(value.description, 2_400),
    triggers: compactStringList(value.triggers, 32, 240),
    modelPreference: compactStringList(value.modelPreference, 8, 120),
    referenceImages: compactStringList(value.referenceImages, 16, 2_000),
    contentHash: value.contentHash,
    contentHashSource: value.contentHashSource,
    ...(typeof value.sourceSize === 'number' ? { sourceSize: value.sourceSize } : {}),
    ...(typeof value.sourceUpdatedAt === 'string' ? { sourceUpdatedAt: value.sourceUpdatedAt } : {}),
  };
}

function extractSkillFrontmatterPrefix(raw: string): string | null {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
  if (!match) return null;
  return match[0].endsWith('\n') ? match[0] : `${match[0]}\n`;
}

async function readLocalSkillFrontmatter(localPath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(localPath, 'r');
    const chunks: Buffer[] = [];
    let offset = 0;
    while (offset < USER_SKILL_FRONTMATTER_MAX_BYTES) {
      const length = Math.min(USER_SKILL_FRONTMATTER_CHUNK_BYTES, USER_SKILL_FRONTMATTER_MAX_BYTES - offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead <= 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      offset += bytesRead;
      const frontmatter = extractSkillFrontmatterPrefix(Buffer.concat(chunks).toString('utf8'));
      if (frontmatter) return frontmatter;
      if (bytesRead < length) break;
    }
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
  return null;
}

async function readRemoteSkillFrontmatter(storageUrl: string): Promise<string | null> {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < USER_SKILL_FRONTMATTER_MAX_BYTES) {
    const end = Math.min(
      offset + USER_SKILL_FRONTMATTER_CHUNK_BYTES - 1,
      USER_SKILL_FRONTMATTER_MAX_BYTES - 1,
    );
    let response: Response;
    try {
      response = await fetch(storageUrl, { headers: { Range: `bytes=${offset}-${end}` } });
    } catch {
      return null;
    }
    // A 200 response may contain the entire SKILL.md. Refuse it on the startup
    // path rather than silently restoring the old full-body download.
    if (response.status !== 206) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const contentRange = response.headers.get('content-range');
    const rangeStart = contentRange?.match(/^bytes\s+(\d+)-/i)?.[1];
    if (rangeStart == null || Number(rangeStart) !== offset) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > USER_SKILL_FRONTMATTER_CHUNK_BYTES) return null;
    chunks.push(buffer);
    offset += buffer.length;
    const frontmatter = extractSkillFrontmatterPrefix(Buffer.concat(chunks).toString('utf8'));
    if (frontmatter) return frontmatter;
    if (buffer.length < USER_SKILL_FRONTMATTER_CHUNK_BYTES) break;
  }
  return null;
}

async function readUserSkillIndexFile(file: WorkspaceFile): Promise<string | null> {
  if (file.size != null && file.size > USER_SKILL_INDEX_MAX_BYTES) return null;
  if (file.localAvailable && file.localPath) {
    try {
      const content = await readLocalFile(file.localPath, 'utf8');
      return Buffer.byteLength(content, 'utf8') <= USER_SKILL_INDEX_MAX_BYTES ? content : null;
    } catch { /* fall back to the small remote index */ }
  }
  if (!file.storageUrl) return null;
  try {
    const response = await fetch(file.storageUrl);
    if (!response.ok) return null;
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > USER_SKILL_INDEX_MAX_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const content = await response.text();
    return Buffer.byteLength(content, 'utf8') <= USER_SKILL_INDEX_MAX_BYTES ? content : null;
  } catch {
    return null;
  }
}

// ── Local workspace mirror ──────────────────────────────────────────────────

function localWorkspaceBase(): string {
  return process.env.MAKARON_WORKSPACE_CACHE_DIR || path.join(tmpdir(), 'makaron-workspaces');
}

function safeUserSegment(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function normalizeWorkspacePath(filePath: string): string {
  const normalized = path.posix.normalize(filePath.replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`Invalid workspace path: ${filePath}`);
  }
  return normalized;
}

export function getLocalWorkspaceRoot(userId: string): string {
  return path.join(localWorkspaceBase(), safeUserSegment(userId), 'workspace');
}

export function getLocalWorkspacePath(userId: string, filePath: string): string {
  const normalized = normalizeWorkspacePath(filePath);
  return path.join(getLocalWorkspaceRoot(userId), ...normalized.split('/'));
}

async function localFileMatches(localPath: string, expectedSize?: number): Promise<boolean> {
  try {
    const s = await stat(localPath);
    return expectedSize == null || s.size === expectedSize;
  } catch {
    return false;
  }
}

async function writeLocalMirror(userId: string, filePath: string, body: string | Buffer): Promise<string> {
  const localPath = getLocalWorkspacePath(userId, filePath);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeLocalFile(localPath, body);
  return localPath;
}

async function hydrateLocalMirror(file: WorkspaceFile, userId: string): Promise<WorkspaceFileHandle> {
  const localPath = getLocalWorkspacePath(userId, file.path);
  if (await localFileMatches(localPath, file.size)) {
    console.log(`[workspace] local hit ${file.path}`);
    return { ...file, localPath, localAvailable: true, hydrated: false };
  }

  if (!file.storageUrl) {
    return { ...file, localPath, localAvailable: false, hydrated: false };
  }

  console.log(`[workspace] hydrate ${file.path}`);
  const response = await fetch(file.storageUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to hydrate workspace file ${file.path}: ${response.status}`);
  }

  await mkdir(path.dirname(localPath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(localPath));
  return { ...file, localPath, localAvailable: true, hydrated: true };
}

// ── MIME type helpers ──────────────────────────────────────────────────────

function extToContentType(ext: string): string {
  const map: Record<string, string> = {
    '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
    '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript', '.jsx': 'text/javascript',
    '.ts': 'text/typescript', '.tsx': 'text/typescript', '.css': 'text/css',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime',
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

  return (data || []).map((row: { path: string; content_type: string; size_bytes: number | null; storage_url: string; updated_at: string | null }) => {
    const localPath = getLocalWorkspacePath(userId, row.path);
    return {
      path: row.path,
      contentType: row.content_type,
      size: row.size_bytes ?? undefined,
      storageUrl: row.storage_url,
      updatedAt: row.updated_at ?? undefined,
      localPath,
      localAvailable: existsSync(localPath),
    };
  });
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
): Promise<WorkspaceWriteResult> {
  const ct = contentType || pathToContentType(path);
  const sp = storagePath(userId, path);
  const isText = ct.startsWith('text/') || ct === 'application/json';
  const body = isText && typeof content === 'string' ? content : (Buffer.isBuffer(content) ? content : Buffer.from(content));
  const sizeBytes = typeof content === 'string' ? Buffer.byteLength(content, 'utf-8') : (Buffer.isBuffer(content) ? content.length : 0);
  let localPath: string | undefined;

  try {
    localPath = await writeLocalMirror(userId, path, body);
    console.log(`[workspace] local write ${path}`);
  } catch (e) {
    console.warn('[workspace] local write failed:', e);
  }

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
  const updatedAt = new Date().toISOString();

  // Upsert index row
  const { error: dbError } = await supabase.from('workspace_files').upsert({
    user_id: userId,
    path,
    content_type: ct,
    size_bytes: sizeBytes,
    storage_url: publicUrl,
    updated_at: updatedAt,
    ...(marketplaceId ? { marketplace_id: marketplaceId } : {}),
  }, { onConflict: 'user_id,path' });

  if (dbError) {
    console.error('[workspace] db upsert error:', dbError.message);
    return { success: false, error: dbError.message };
  }

  cache.clear();
  return { success: true, storageUrl: publicUrl, localPath, size: sizeBytes, updatedAt };
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

async function persistUserSkillManifestEntry(
  entry: UserSkillManifestEntry,
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const result = await dbWriteFile(
    supabase,
    userId,
    userSkillIndexPath(entry.name),
    `${JSON.stringify(entry)}\n`,
    'application/json',
  );
  if (!result.success) {
    console.warn(`[workspace] user Skill index write failed for ${entry.path}: ${result.error || 'unknown error'}`);
  }
  return result.success;
}

async function backfillUserSkillManifestEntry(
  skillFile: WorkspaceFile,
  supabase: SupabaseClient,
  userId: string,
): Promise<UserSkillManifestEntry | null> {
  const cacheKey = `skill:index:legacy:${userId}:${skillFile.path}:${skillFile.size || ''}:${skillFile.updatedAt || ''}`;
  const cached = getCached<UserSkillManifestEntry>(cacheKey);
  if (cached) return cached;

  let frontmatter: string | null = null;
  if (skillFile.localAvailable && skillFile.localPath) {
    frontmatter = await readLocalSkillFrontmatter(skillFile.localPath);
  }
  if (!frontmatter && skillFile.storageUrl) {
    frontmatter = await readRemoteSkillFrontmatter(skillFile.storageUrl);
  }
  if (!frontmatter) return null;

  // Legacy rows predate the sidecar, so a full-body hash is intentionally not
  // available on this path. The source metadata makes this fingerprint stale
  // as soon as the workspace row changes; the next normal SKILL.md write stores
  // the exact full-content hash.
  const legacyHash = skillContentHash(
    `${frontmatter}\0${skillFile.size ?? ''}\0${skillFile.updatedAt ?? ''}`,
  );
  const entry = buildUserSkillManifestEntry(skillFile.path, frontmatter, skillFile, legacyHash);
  if (!entry) return null;

  await persistUserSkillManifestEntry(entry, supabase, userId);
  setCache(cacheKey, entry, 5 * 60 * 1000);
  return entry;
}

async function loadUserSkillManifestEntries(
  supabase: SupabaseClient,
  userId: string,
  excludedNames: ReadonlySet<string>,
): Promise<{ entries: UserSkillManifestEntry[]; unresolved: WorkspaceFile[] }> {
  const [skillFiles, indexFiles] = await Promise.all([
    dbListFiles(supabase, userId, 'skills/%/SKILL.md'),
    dbListFiles(supabase, userId, `skills/%/${USER_SKILL_INDEX_FILENAME}`),
  ]);
  const indexByName = new Map<string, WorkspaceFile>();
  for (const file of indexFiles) {
    const name = file.path.match(/^skills\/([^/]+)\/\.makaron-skill-index\.json$/)?.[1];
    if (name) indexByName.set(name, file);
  }

  const resolved = await Promise.all(skillFiles
    .filter(skillFile => {
      const name = userSkillNameFromPath(skillFile.path);
      return !!name && !excludedNames.has(name);
    })
    .map(async skillFile => {
      const name = userSkillNameFromPath(skillFile.path);
      if (!name) return { entry: null, skillFile };
      const indexFile = indexByName.get(name);
      if (indexFile) {
        const raw = await readUserSkillIndexFile(indexFile);
        const entry = raw ? parseUserSkillManifestEntry(raw, skillFile) : null;
        if (entry) return { entry, skillFile };
      }
      const entry = await backfillUserSkillManifestEntry(skillFile, supabase, userId);
      return { entry, skillFile };
    }));

  return {
    entries: resolved.flatMap(item => item.entry ? [item.entry] : []),
    unresolved: resolved.flatMap(item => item.entry ? [] : [item.skillFile]),
  };
}

function formatUserSkillManifestLine(entry: UserSkillManifestEntry): string {
  const extras: string[] = [];
  if (entry.triggers.length) extras.push(`triggers: ${entry.triggers.join('; ')}`);
  if (entry.referenceImages.length) extras.push('has reference images');
  if (entry.modelPreference.length) extras.push(`prefers: ${entry.modelPreference.join('/')}`);
  const suffix = extras.length ? ` [${extras.join(', ')}]` : '';
  return `- **${entry.name}**: ${entry.description}${suffix}`;
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

export async function resolveWorkspaceFile(
  filePath: string,
  supabase?: SupabaseClient,
  userId?: string,
  options: { hydrate?: boolean } = {},
): Promise<WorkspaceFileHandle | null> {
  if (supabase && userId) {
    const files = await dbListFiles(supabase, userId, filePath);
    const file = files.find(f => f.path === filePath);
    if (file) {
      if (options.hydrate) {
        return hydrateLocalMirror(file, userId);
      }
      const localPath = getLocalWorkspacePath(userId, file.path);
      return {
        ...file,
        localPath,
        localAvailable: await localFileMatches(localPath, file.size),
        hydrated: false,
      };
    }
  }

  const builtIn = readBuiltInFile(filePath);
  if (builtIn) {
    return {
      path: filePath,
      contentType: builtIn.contentType,
      storageUrl: builtIn.storageUrl,
      localAvailable: false,
      isBuiltIn: true,
    };
  }

  return null;
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
    userFiles = (await dbListFiles(supabase, userId, pattern))
      .filter(file => !isUserSkillIndexPath(file.path));
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
    const file = await resolveWorkspaceFile(filePath, supabase, userId, { hydrate: true });
    if (file?.localPath && file.localAvailable) {
      if (file.contentType.startsWith('text/') || file.contentType === 'application/json') {
        const result = { content: await readLocalFile(file.localPath, 'utf-8'), contentType: file.contentType, storageUrl: file.storageUrl, path: file.path, localPath: file.localPath };
        setCache(cacheKey, result);
        return result;
      }
      const buffer = await readLocalFile(file.localPath);
      const result = { content: `data:${file.contentType};base64,${buffer.toString('base64')}`, contentType: file.contentType, storageUrl: file.storageUrl, path: file.path, localPath: file.localPath };
      setCache(cacheKey, result);
      return result;
    }

    if (file?.storageUrl) {
      const result = await fetchFileContent(file.storageUrl, file.contentType);
      if (result) {
        result.path = file.path;
        result.localPath = file.localPath;
        setCache(cacheKey, result);
        return result;
      }
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
): Promise<WorkspaceWriteResult> {
  const result = await dbWriteFile(supabase, userId, filePath, content, contentType, marketplaceId);
  const skillName = userSkillNameFromPath(filePath);
  if (!result.success || !skillName) return result;

  const skillMd = typeof content === 'string' ? content : content.toString('utf8');
  const entry = buildUserSkillManifestEntry(filePath, skillMd, result);
  if (entry) {
    await persistUserSkillManifestEntry(entry, supabase, userId);
  } else {
    // Do not leave stale discovery metadata pointing at an invalid update.
    await dbDeleteFile(supabase, userId, userSkillIndexPath(skillName));
  }
  return result;
}

/**
 * Delete a file from workspace.
 */
export async function deleteFile(filePath: string, supabase: SupabaseClient, userId: string): Promise<boolean> {
  const deleted = await dbDeleteFile(supabase, userId, filePath);
  const skillName = userSkillNameFromPath(filePath);
  if (deleted && skillName) {
    await dbDeleteFile(supabase, userId, userSkillIndexPath(skillName));
  }
  return deleted;
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
  if (!marketplaceId) {
    const existing = await getAllSkills(supabase, userId);
    const existingNames = new Set(existing.map(s => s.name));
    if (existingNames.has(finalName)) {
      let i = 2;
      while (existingNames.has(`${parsed.name}-${i}`)) i++;
      finalName = `${parsed.name}-${i}`;
    }
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
  const cacheKey = `skills:all:${userId || 'anonymous'}`;
  const cached = getCached<ParsedSkill[]>(cacheKey);
  if (cached) return cached;

  const builtIn = loadBuiltInSkills();
  // Filter out legacy prompts — they're for tips pipeline, not user-selectable skills
  const skills = [...builtIn.values()].filter(s => !LEGACY_PROMPTS.has(s.name));

  if (supabase && userId) {
    const userFiles = await dbListFiles(supabase, userId, 'skills/%/SKILL.md');
    const parsedUserSkills = await Promise.all(userFiles.map(async (file) => {
      const pathName = file.path.match(/^skills\/([^/]+)\/SKILL\.md$/)?.[1];
      if (!pathName || builtIn.has(pathName)) return null;

      let content: string | null = null;
      if (file.localAvailable && file.localPath) {
        try {
          content = await readLocalFile(file.localPath, 'utf-8');
        } catch { /* fall back to the provider URL below */ }
      }
      if (!content && file.storageUrl) {
        const result = await fetchFileContent(file.storageUrl, file.contentType);
        content = result?.content || null;
      }
      if (!content) return null;
      const parsed = parseSkillMd(content);
      return parsed && !builtIn.has(parsed.name) ? parsed : null;
    }));
    for (const parsed of parsedUserSkills) {
      if (parsed) {
        skills.push(parsed);
      }
    }
  }

  setCache(cacheKey, skills);
  return skills;
}

/** Build lightweight skill manifest for Agent system prompt. */
export async function getSkillManifest(supabase?: SupabaseClient, userId?: string): Promise<string> {
  const cacheKey = `skills:manifest:${userId || 'anonymous'}`;
  const cached = getCached<string>(cacheKey);
  if (cached !== undefined) return cached;

  // Generated from SKILL.md frontmatter at development time. Do not parse the
  // 69 full built-in Skill bodies on the request path just to build an index.
  const builtIn = builtInSkillManifest as BuiltInSkillManifestEntry[];
  const lines: string[] = builtIn.map(s => {
    const extras: string[] = [];
    if (s.referenceImages?.length) extras.push('has reference images');
    if (s.modelPreference?.length) extras.push(`prefers: ${s.modelPreference.join('/')}`);
    if (s.studioRunRecipe) extras.push(`Studio Run recipe: ${s.studioRunRecipe}`);
    if (s.studioRunProfile) extras.push(`profile: ${s.studioRunProfile}`);
    if (s.sourceMediaRequired) extras.push('requires source media');
    const suffix = extras.length ? ` [${extras.join(', ')}]` : '';
    return `- **${s.name}**: ${s.description.trim().replace(/\s+/g, ' ')}${suffix}`;
  });
  const builtInNames = new Set(builtIn.map(s => s.name));

  if (supabase && userId) {
    const excludedNames = new Set([...builtInNames, ...LEGACY_PROMPTS]);
    const userManifest = await loadUserSkillManifestEntries(supabase, userId, excludedNames);
    for (const entry of userManifest.entries) {
      lines.push(formatUserSkillManifestLine(entry));
    }
    // Safe compatibility fallback for malformed or inaccessible legacy files.
    // It preserves explicit selection by name without downloading a full body.
    for (const file of userManifest.unresolved) {
      const name = userSkillNameFromPath(file.path);
      if (name) lines.push(`- **${name}**: user skill at \`${file.path}\` (read this file before using the skill)`);
    }
  }

  if (lines.length === 0) {
    setCache(cacheKey, '');
    return '';
  }

  const manifest = `\n## Available Skills\n\nThis is the semantic routing index. Select a skill when the user request clearly matches its name, description, or trigger, then read \`skills/{name}/SKILL.md\` before planning or choosing tools. The selected Skill owns its workflow. Every video-model generation reads \`prompts/animate.md\` first; that guide indexes any supplied-video work into \`skills/video-edit/SKILL.md\`, which distinguishes source-preserving edits from shot-grammar replication internally. Without source authority, continue direct generation within the selected model's limit regardless of platform, copy, subtitles, branding, or shot count. A named platform is not by itself a workflow override. Explicit Studio/Remotion/editability and source-led assembly remain Composition routes; longer requests may activate the best matching production Skill.\n\n${lines.join('\n')}\n`;
  setCache(cacheKey, manifest);
  return manifest;
}
