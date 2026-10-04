import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

// Use the same matcher and options as Next's collect-build-traces implementation.
const require = createRequire(import.meta.url);
const picomatch = require('next/dist/compiled/picomatch');

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

  it.each([
    '/api/agent',
    '/api/agent/run',
    '/api/agent/execution/[id]',
    '/api/remotion/export',
    '/api/remotion/export/[id]',
    '/api/media/materialize',
    '/api/video-snapshot/[snapshotId]',
    '/api/cron/remotion-export',
    '/api/cron/agent-executions',
    '/api/cron/video-poll',
  ])('ships the checksum implementation and dependencies for %s', (route) => {
    const includes = Object.entries(nextConfig.outputFileTracingIncludes ?? {})
      .filter(([glob]) => picomatch(glob, { dot: true, contains: true })(route))
      .flatMap(([, files]) => files);

    for (const dependency of ['@aws-crypto', '@aws-sdk/types', '@smithy', 'tslib']) {
      expect(includes).toContain(`./node_modules/${dependency}/**`);
    }

    // A package.json alone passes module resolution but fails on cold start.
    // Assert that the package's real entry file survives both tracing filters.
    const entry = './node_modules/@aws-crypto/crc32c/build/main/index.js';
    expect(picomatch(includes.map(file => path.resolve(root, file)))(path.resolve(root, entry))).toBe(true);
    const excludes = Object.entries(nextConfig.outputFileTracingExcludes ?? {})
      .filter(([glob]) => picomatch(glob, { dot: true, contains: true })(route))
      .flatMap(([, files]) => files)
      .map(file => path.resolve(root, file));
    expect(picomatch(excludes, { dot: true, contains: true })(path.resolve(root, entry))).toBe(false);
  });
});
