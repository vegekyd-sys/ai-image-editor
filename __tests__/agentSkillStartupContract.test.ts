import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '@/generated/built-in-skill-manifest.json';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('Agent Skill startup contract', () => {
  it('keeps full Skill loading out of every Agent startup entrypoint', () => {
    for (const relativePath of [
      'src/app/api/agent/route.ts',
      'src/app/api/agent/run/route.ts',
      'src/lib/agent-execution-runner.ts',
      'src/lib/agent.ts',
    ]) {
      expect(source(relativePath), relativePath).not.toContain('getAllSkills');
      expect(source(relativePath), relativePath).not.toContain('userSkills');
    }
  });

  it('builds the prompt from exactly one lightweight manifest lookup', () => {
    const agentSource = source('src/lib/agent.ts');
    expect(agentSource.match(/workspace\.getSkillManifest\(/g)).toHaveLength(1);
  });

  it('keeps getSkillManifest metadata-only at runtime', () => {
    const workspaceSource = source('src/lib/workspace.ts');
    const manifestFunction = workspaceSource.slice(workspaceSource.indexOf('export async function getSkillManifest'));
    for (const forbidden of [
      'loadBuiltInSkills(',
      'getAllSkills(',
      'parseSkillMd(',
      'readLocalFile(',
      'fetchFileContent(',
    ]) {
      expect(manifestFunction).not.toContain(forbidden);
    }
    expect(manifest.length).toBeGreaterThan(0);
  });
});
