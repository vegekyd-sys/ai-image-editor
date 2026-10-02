import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { checkServerRuntime } = require('../scripts/check-server-runtime.mjs');
const roots: string[] = [];

function fixture(files: string[], entryExists = true) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'makaron-runtime-'));
  roots.push(root);
  const dir = path.join(root, '.next/server/app/api/video-snapshot/[snapshotId]');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'route.js.nft.json'), JSON.stringify({ files }));
  if (entryExists) {
    const entry = path.join(root, 'node_modules/@aws-crypto/crc32c/build/main/index.js');
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, 'exports.crc32c = () => 0;');
  }
  return root;
}

afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

describe('server runtime packaging gate', () => {
  const route = ['video-snapshot/[snapshotId]'];
  const entry = '../../../../../../node_modules/@aws-crypto/crc32c/build/main/index.js';

  it('accepts a traced executable entry', () => {
    expect(checkServerRuntime(fixture([entry]), route)).toBe(1);
  });

  it('rejects the production failure where only package.json was traced', () => {
    const root = fixture(['../../../../../../node_modules/@aws-crypto/crc32c/package.json']);
    expect(() => checkServerRuntime(root, route)).toThrow('missing @aws-crypto/crc32c runtime entry');
  });

  it('rejects an entry listed in the trace but absent from disk', () => {
    expect(() => checkServerRuntime(fixture([entry], false), route)).toThrow('missing @aws-crypto/crc32c runtime entry');
  });

  it('rejects missing API build traces', () => {
    expect(() => checkServerRuntime(fixture([entry]), ['cron/video-poll'])).toThrow('missing build trace');
  });
});
