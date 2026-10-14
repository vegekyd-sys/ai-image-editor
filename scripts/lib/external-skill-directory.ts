import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseSkillMd } from '../../src/lib/skill-registry';

export const POLICY = 'config/makaron-external-skills.json';
export const CATALOG = 'packages/makaron-cli/skills/makaron/references/workflow-catalog.json';
const START = '<!-- makaron:workflow-directory:start -->';
const END = '<!-- makaron:workflow-directory:end -->';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
export interface PolicyEntry { name: string; request: {en: string; zh: string}; profile?: string }
export interface DirectoryPolicy { schemaVersion: number; excluded: string[]; entries: PolicyEntry[] }
export function buildCatalog(root: string) {
  const policy: DirectoryPolicy = JSON.parse(fs.readFileSync(path.join(root, POLICY), 'utf8'));
  if (policy.schemaVersion !== 1 || !Array.isArray(policy.entries) || !Array.isArray(policy.excluded)) throw new Error('Invalid external Skill policy');
  const seen = new Set<string>();
  const entries = policy.entries.map(entry => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name) || seen.has(entry.name) || policy.excluded.includes(entry.name)) throw new Error(`Duplicate, invalid or excluded entry: ${entry.name}`);
    seen.add(entry.name);
    if (!entry.request?.en?.trim() || !entry.request?.zh?.trim()) throw new Error(`Missing request label: ${entry.name}`);
    const file = `src/skills/${entry.name}/SKILL.md`;
    const skill = parseSkillMd(fs.readFileSync(path.join(root, file), 'utf8'));
    if (!skill || skill.name !== entry.name || skill.makaron.builtIn !== true || skill.makaron.manifestVisible === false) throw new Error(`Missing, hidden or mismatched built-in entry: ${entry.name}`);
    return { ...entry, description: compact(skill.description), triggers: skill.makaron.triggers || [], tags: skill.makaron.tags || [], sourceMediaRequired: skill.makaron.sourceMediaRequired === true, ...(skill.makaron.inputHint ? {inputHint: compact(skill.makaron.inputHint)} : {}) };
  });
  return { schemaVersion: 1, revision: digest(JSON.stringify({policy, entries})), excluded: policy.excluded, entries };
}
export function renderDirectory(catalog: ReturnType<typeof buildCatalog>, locale: 'en'|'zh') {
  const escape = (s: string) => compact(s).replace(/\|/g, '\\|');
  return [START,
    locale === 'zh' ? '| 需求 | `--skill` |' : '| Request | `--skill` entry |',
    '| --- | --- |',
    locale === 'zh' ? '| 普通图片编辑/生成、音乐、单段视频 | 省略，自动路由 |' : '| Ordinary image editing/generation, music or single-clip video | Omit `--skill` for automatic routing |',
    ...catalog.entries.map(entry => `| ${escape(entry.request[locale])} | \`${entry.name}\`${entry.profile ? (locale === 'zh' ? `，brief 指定 ${entry.profile}` : `; request the ${entry.profile} profile in the brief`) : ''} |`),
    END, ''].join('\n');
}
export function replaceDirectory(source: string, rendered: string) {
  const starts = source.split(START).length-1, ends = source.split(END).length-1;
  if (starts || ends) {
    if (starts !== 1 || ends !== 1 || source.indexOf(END) < source.indexOf(START)) throw new Error('Malformed generated directory markers');
    return source.slice(0, source.indexOf(START)) + rendered.trimEnd() + source.slice(source.indexOf(END)+END.length);
  }
  const pattern = /^\| (?:Request|需求) \| `--skill`(?: entry)? \|\n(?:\|[^\n]*\n)+/gm;
  if ([...source.matchAll(pattern)].length !== 1) throw new Error('Missing or ambiguous workflow table');
  return source.replace(pattern, rendered);
}
export function syncDirectory(root: string, check = false) {
  const catalog = buildCatalog(root);
  const ensure = (relative: string, content: string) => {
    const file = path.join(root, relative);
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) throw new Error(`${relative} is stale; run npm run build:skill-sync`);
    } else { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content); }
  };
  ensure(CATALOG, JSON.stringify(catalog, null, 2)+'\n');
  for (const [file, locale] of [
    ['packages/makaron-cli/skills/makaron/SKILL.md', 'en'], ['packages/makaron-cli/SKILL.md', 'en'],
    ['packages/makaron-cli/README.md', 'en'], ['docs/agent-guidance/makaron-cli-entry.zh.md', 'zh'],
  ] as const) ensure(file, replaceDirectory(fs.readFileSync(path.join(root, file), 'utf8'), renderDirectory(catalog, locale)));
  return catalog;
}
export function routingFingerprint(root: string) {
  const files = [POLICY, 'src/generated/built-in-skill-manifest.json', 'src/lib/prompts/agent.md',
    'src/lib/agent-tools.ts', 'src/lib/agent.ts', 'src/lib/agent-model-runtime.ts', 'src/lib/workspace.ts',
    'src/lib/agent-prompt-bundles.ts', 'benchmarks/external-skill-routing/cases.json',
    'benchmarks/external-skill-routing/preflight.ts'];
  const collect = (dir: string) => { for (const entry of fs.readdirSync(path.join(root,dir), {withFileTypes:true})) {
    const file = `${dir}/${entry.name}`; if(entry.isDirectory()) collect(file); else files.push(file);
  }};
  collect('src/skills');
  const hash = createHash('sha256');
  for (const file of files.sort()) { hash.update(file+'\0'); hash.update(fs.readFileSync(path.join(root,file))); hash.update('\0'); }
  return hash.digest('hex');
}
