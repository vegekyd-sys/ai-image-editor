import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

describe('Vercel deployment footprint', () => {
  it('keeps local media and generated artifacts out of source uploads and function traces', () => {
    const vercelIgnore = read('.vercelignore');
    const nextConfig = read('next.config.ts');
    const localOnlyDirectories = [
      '.tmp',
      '.remotion-bundle',
      '.codex',
      'artifacts',
      'outputs',
      'screenshots',
      'mcp-output',
      'tmp',
      'testcase',
      'testcase old',
      'app-store-assets',
    ];

    for (const directory of localOnlyDirectories) {
      expect(vercelIgnore).toContain(`${directory}/`);
      expect(nextConfig).toContain(`'./${directory}/**'`);
    }
    expect(vercelIgnore).toContain('*.tsbuildinfo');
  });
});
