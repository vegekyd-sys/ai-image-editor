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
