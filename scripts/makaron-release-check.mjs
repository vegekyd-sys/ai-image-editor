#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const docsPath = resolve(root, 'docs/makaron-release-checklist.md');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

function usage() {
  console.log(`Makaron release check

Usage:
  node scripts/makaron-release-check.mjs --print
  node scripts/makaron-release-check.mjs --local
  node scripts/makaron-release-check.mjs --health [--base https://www.makaron.app]

Modes:
  --print   Print the release checklist. This is the default.
  --local   Run local pre-merge gates: tsc, test, CLI test, build.
  --health  Check the production/preview base URL and /api/health.

Notes:
  This script never deploys, writes Vercel env vars, publishes npm, or edits memory.
  Production deploy and npm publish remain explicit human/Codex actions.
`);
}

function run(command, commandArgs, options = {}) {
  const label = [command, ...commandArgs].join(' ');
  console.log(`\n$ ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function printChecklist() {
  if (!existsSync(docsPath)) {
    throw new Error(`Missing checklist: ${docsPath}`);
  }
  console.log(readFileSync(docsPath, 'utf8'));
}

function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] || fallback;
}

async function healthCheck() {
  const base = argValue('--base', 'https://www.makaron.app').replace(/\/$/, '');
  console.log(`Checking ${base}`);
  run('curl', ['-sSI', base]);
  run('curl', ['-sS', `${base}/api/health`]);
}

function localCheck() {
  run('npx', ['tsc', '--noEmit']);
  run('npm', ['run', 'test']);
  run('npm', ['run', 'test:cli']);
  run('npm', ['run', 'build']);
}

try {
  if (has('--help') || has('-h')) {
    usage();
  } else if (has('--local')) {
    localCheck();
  } else if (has('--health')) {
    await healthCheck();
  } else {
    printChecklist();
  }
} catch (error) {
  console.error(`\nrelease check failed: ${error.message}`);
  process.exit(1);
}
