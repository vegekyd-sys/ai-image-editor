/**
 * Skill Registry — loads and manages SKILL.md files.
 *
 * SKILL.md format: YAML frontmatter (---...---) + markdown body.
 * The frontmatter follows the AgentSkills standard with Makaron extensions
 * under metadata.makaron.
 */

// fs/path are used server-side only — dynamic require to avoid client bundle issues
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = typeof window === 'undefined' ? require('fs') as typeof import('fs') : null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = typeof window === 'undefined' ? require('path') as typeof import('path') : null;

export interface MakaronSkillMeta {
  icon?: string;
  color?: string;
  tipsEnabled?: boolean;
  tipsCount?: number;
  builtIn?: boolean;
  modelPreference?: string[];
  faceProtection?: 'strict' | 'default' | 'none';
  defaultAspectRatio?: string;
  referenceImages?: string[];
  tags?: string[];
}

export interface ParsedSkill {
  name: string;
  description: string;
  allowedTools?: string[];
  makaron: MakaronSkillMeta;
  template: string; // markdown body (the actual instructions)
}

/** Parse a SKILL.md string into structured data */
export function parseSkillMd(content: string): ParsedSkill | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const body = fmMatch[2].trim();

  // Simple YAML parser for our known fields (no dependency needed)
  const get = (key: string): string | undefined => {
    // Multi-line value (>)
    const multiMatch = frontmatter.match(new RegExp(`^${key}:\\s*>\\s*\\n((?:\\s{2,}.+\\n?)+)`, 'm'));
    if (multiMatch) return multiMatch[1].replace(/^\s{2,}/gm, '').trim();
    // Single-line value
    const singleMatch = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return singleMatch?.[1]?.replace(/^["']|["']$/g, '').trim();
  };

  const getList = (key: string): string[] => {
    const val = get(key);
    if (!val) return [];
    // space-separated (allowed-tools) or yaml array [a, b]
    if (val.startsWith('[')) return val.slice(1, -1).split(',').map(s => s.trim());
    return val.split(/\s+/);
  };

  const name = get('name');
  const description = get('description');
  if (!name || !description) return null;

  // Parse metadata.makaron block
  const makaronBlock = frontmatter.match(/metadata:\s*\n\s+makaron:\s*\n((?:\s{4,}.+\n?)*)/);
  const makaron: MakaronSkillMeta = {};
  if (makaronBlock) {
    const lines = makaronBlock[1].split('\n');
    let currentListKey: string | null = null;
    let currentList: string[] = [];
    const flushList = () => {
      if (currentListKey && currentList.length) {
        (makaron as Record<string, unknown>)[currentListKey] = currentList;
      }
      currentListKey = null;
      currentList = [];
    };
    for (const line of lines) {
      // YAML list item: "      - value"
      const listItem = line.match(/^\s+-\s+(.+)$/);
      if (listItem && currentListKey) {
        currentList.push(listItem[1].replace(/^["']|["']$/g, '').trim());
        continue;
      }
      // Key: value line
      const m = line.match(/^\s+(\w+):\s*(.*)$/);
      if (!m) continue;
      flushList();
      const [, k, rawV] = m;
      const clean = rawV.replace(/^["']|["']$/g, '').trim();
      if (k === 'icon') makaron.icon = clean;
      else if (k === 'color') makaron.color = clean;
      else if (k === 'tipsEnabled') makaron.tipsEnabled = clean === 'true';
      else if (k === 'tipsCount') makaron.tipsCount = parseInt(clean);
      else if (k === 'builtIn') makaron.builtIn = clean === 'true';
      else if (k === 'faceProtection') makaron.faceProtection = clean as 'strict' | 'default' | 'none';
      else if (k === 'defaultAspectRatio') makaron.defaultAspectRatio = clean;
      else if (k === 'modelPreference' || k === 'tags' || k === 'referenceImages') {
        if (clean.startsWith('[')) {
          (makaron as Record<string, unknown>)[k] = clean.slice(1, -1).split(',').map(s => s.trim());
        } else if (!clean) {
          // Empty value = YAML list follows on next lines
          currentListKey = k;
          currentList = [];
        }
      }
    }
    flushList();
  }

  return {
    name,
    description,
    allowedTools: getList('allowed-tools'),
    makaron,
    template: body,
  };
}

// ── Registry ────────────────────────────────────────────────────────────────

let _skills: Map<string, ParsedSkill> | null = null;

/** Clear cached skills (for dev hot-reload) */
export function clearSkillCache() { _skills = null; }

/** Load all built-in skills from src/skills/{name}/SKILL.md */
export function loadBuiltInSkills(): Map<string, ParsedSkill> {
  // Dev mode: always re-read so SKILL.md edits take effect immediately
  if (_skills && process.env.NODE_ENV !== 'development') return _skills;
  _skills = new Map();
  if (!fs || !path) return _skills; // client-side: no skills

  const candidates = [
    path.join(process.cwd(), 'src', 'skills'),
    path.join(__dirname, '..', '..', 'skills'),
  ];

  for (const base of candidates) {
    if (!fs.existsSync(base)) continue;
    const dirs = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      const skillPath = path.join(base, dir.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      try {
        const content = fs.readFileSync(skillPath, 'utf-8');
        const skill = parseSkillMd(content);
        if (skill) _skills.set(skill.name, skill);
      } catch { /* skip unreadable */ }
    }
    if (_skills.size > 0) break;
  }

  return _skills;
}

/** Get a skill by name (built-in only; for user skills use getSkillFromAll) */
export function getSkill(name: string): ParsedSkill | undefined {
  return loadBuiltInSkills().get(name);
}

/** Get all loaded built-in skills */
export function getAllSkills(): ParsedSkill[] {
  return [...loadBuiltInSkills().values()];
}

// ── User skills (from DB) ───────────────────────────────────────────────────

/** Load user skills from Supabase user_skills table */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadUserSkills(supabase: any, userId: string): Promise<ParsedSkill[]> {
  const { data } = await supabase
    .from('user_skills')
    .select('name, skill_md')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (!data) return [];
  return (data as { name: string; skill_md: string }[])
    .map(row => parseSkillMd(row.skill_md))
    .filter((s): s is ParsedSkill => s !== null);
}

/** Get skill by name from built-in + user skills */
export function getSkillFromAll(name: string, userSkills?: ParsedSkill[]): ParsedSkill | undefined {
  return loadBuiltInSkills().get(name) || userSkills?.find(s => s.name === name);
}