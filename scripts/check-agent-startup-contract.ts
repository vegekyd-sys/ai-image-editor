import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseSkillMd } from '../src/lib/skill-registry';

const repoRoot = process.cwd();
const generatedPath = path.join(repoRoot, 'src/generated/built-in-skill-manifest.json');
const legacyPromptNames = new Set(['enhance', 'creative', 'wild', 'captions']);

function buildManifest() {
  const skillsRoot = path.join(repoRoot, 'src/skills');
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(skillsRoot, entry.name, 'SKILL.md'))
    .filter(existsSync)
    .map(skillPath => {
      const parsed = parseSkillMd(readFileSync(skillPath, 'utf8'));
      if (!parsed) throw new Error(`Invalid Skill frontmatter: ${path.relative(repoRoot, skillPath)}`);
      return parsed;
    })
    .filter(skill => !legacyPromptNames.has(skill.name) && skill.makaron?.manifestVisible !== false)
    .map(skill => ({
      name: skill.name,
      description: skill.description.trim().split('\n')[0],
      ...(skill.makaron?.referenceImages?.length ? { referenceImages: skill.makaron.referenceImages } : {}),
      ...(skill.makaron?.modelPreference?.length ? { modelPreference: skill.makaron.modelPreference } : {}),
      ...(skill.makaron?.studioRunRecipe ? { studioRunRecipe: skill.makaron.studioRunRecipe } : {}),
      ...(skill.makaron?.studioRunProfile ? { studioRunProfile: skill.makaron.studioRunProfile } : {}),
      ...(skill.makaron?.sourceMediaRequired ? { sourceMediaRequired: true } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function assertStartupArchitecture() {
  const criticalFiles = [
    'src/app/api/agent/route.ts',
    'src/app/api/agent/run/route.ts',
    'src/lib/agent-execution-runner.ts',
    'src/lib/agent.ts',
  ];
  for (const relativePath of criticalFiles) {
    const source = readFileSync(path.join(repoRoot, relativePath), 'utf8');
    for (const forbidden of ['getAllSkills', 'userSkills']) {
      if (source.includes(forbidden)) {
        throw new Error(`${relativePath} must not contain ${forbidden}; Agent startup may use only the lightweight manifest`);
      }
    }
  }

  const agentSource = readFileSync(path.join(repoRoot, 'src/lib/agent.ts'), 'utf8');
  const manifestCalls = agentSource.match(/workspace\.getSkillManifest\(/g)?.length ?? 0;
  if (manifestCalls !== 1) {
    throw new Error(`src/lib/agent.ts must have exactly one getSkillManifest call; found ${manifestCalls}`);
  }

  const workspaceSource = readFileSync(path.join(repoRoot, 'src/lib/workspace.ts'), 'utf8');
  const manifestFunction = workspaceSource.slice(workspaceSource.indexOf('export async function getSkillManifest'));
  for (const forbidden of ['loadBuiltInSkills(', 'getAllSkills(', 'parseSkillMd(', 'readLocalFile(', 'fetchFileContent(']) {
    if (manifestFunction.includes(forbidden)) {
      throw new Error(`getSkillManifest must remain metadata-only; found ${forbidden}`);
    }
  }
}

const expected = `${JSON.stringify(buildManifest(), null, 2)}\n`;
if (process.argv.includes('--write')) {
  mkdirSync(path.dirname(generatedPath), { recursive: true });
  writeFileSync(generatedPath, expected);
} else {
  assertStartupArchitecture();
  const actual = existsSync(generatedPath) ? readFileSync(generatedPath, 'utf8') : '';
  if (actual !== expected) {
    throw new Error('Built-in Skill manifest is stale. Run: npm run build:agent-startup-manifest');
  }
  console.log('Agent startup contract passed: manifest-only Skill loading, no duplicate full Skill reads.');
}
