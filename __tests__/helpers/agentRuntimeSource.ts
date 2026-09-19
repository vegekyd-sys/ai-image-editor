import fs from 'node:fs';
import path from 'node:path';

const AGENT_RUNTIME_FILES = [
  'src/lib/agent.ts',
  'src/lib/agent-tools.ts',
  'src/lib/agent-tool-guards.ts',
] as const;

export function readAgentRuntimeSource(root = process.cwd()): string {
  return AGENT_RUNTIME_FILES
    .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
    .join('\n');
}

export function readAgentAwareSource(root: string, relativePath: string): string {
  if (relativePath === 'src/lib/agent.ts') return readAgentRuntimeSource(root);
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/** Effective policy across core and explicitly deferred owners. Use the raw
 * source helper above for startup size/routing checks, never this expansion. */
export function readAgentContractSource(root: string, relativePath: string): string {
  const source = readAgentAwareSource(root, relativePath);
  const names = relativePath === 'src/lib/prompts/agent.md'
    ? ['video-workflow', 'coding-workflow']
    : ['src/lib/agent.ts', 'src/lib/agent-tools.ts'].includes(relativePath)
      ? ['video-submission', 'coding-submission', 'workspace-authoring'] : [];
  return source + names.map(name => {
    const text = fs.readFileSync(path.join(root, `src/lib/prompts/${name}.md`), 'utf8');
    return '\n' + (relativePath.endsWith('.ts') ? text.replace(/`/g, '\\`') : text);
  }).join('');
}
