#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const invocationRepo = resolve(fileURLToPath(new URL('..', import.meta.url)));

function resolveCanonicalDevRepo(fallback) {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: fallback,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return fallback;
  for (const block of result.stdout.split(/\n\n+/)) {
    const lines = block.split('\n');
    if (!lines.includes('branch refs/heads/dev')) continue;
    const worktreeLine = lines.find(line => line.startsWith('worktree '));
    if (worktreeLine) return resolve(worktreeLine.slice('worktree '.length));
  }
  return fallback;
}

const mainRepo = resolveCanonicalDevRepo(invocationRepo);
const mainNodeModules = resolve(mainRepo, 'node_modules');
const defaultParent = dirname(mainRepo);

const args = process.argv.slice(2);
const command = args[0] || 'help';

function usage() {
  console.log(`Makaron worktree fast path

Usage:
  node scripts/makaron-worktree-fastpath.mjs audit
  node scripts/makaron-worktree-fastpath.mjs link <worktree-path> [--force]
  node scripts/makaron-worktree-fastpath.mjs create <name> [--branch <branch>] [--base <base>] [--path <path>] [--fetch]
  node scripts/makaron-worktree-fastpath.mjs cleanup-candidates [--base dev]

Commands:
  audit              Show worktrees and whether node_modules is shared/local/missing.
  link               Symlink <worktree>/node_modules to the main repo node_modules.
  create             Add a lightweight git worktree, then symlink node_modules.
  cleanup-candidates List clean worktrees whose branch is merged into the base branch.

Safety:
  This script does not remove worktrees or branches.
  link refuses to replace a real node_modules directory unless --force is passed.
  create defaults to ../<repo-name>-<name> and branch <name>.
  create uses the local base ref by default. Pass --fetch only when fresh remote refs are required.
  Feature worktrees should not run Next.js. Use the fixed runtime runner for local UI, build, and Preview tests.
`);
}

function run(commandName, commandArgs, options = {}) {
  const result = spawnSync(commandName, commandArgs, {
    cwd: mainRepo,
    encoding: 'utf8',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${commandName} ${commandArgs.join(' ')} failed\n${output}`);
  }
  return result.stdout;
}

function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] || fallback;
}

function has(name) {
  return args.includes(name);
}

function parseWorktrees() {
  const raw = run('git', ['worktree', 'list', '--porcelain']);
  const entries = [];
  let current = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    const [key, ...rest] = line.split(' ');
    const value = rest.join(' ');
    if (key === 'worktree') {
      current = { path: value };
    } else if (current) {
      current[key] = value || true;
    }
  }
  if (current) entries.push(current);
  return entries;
}

function nodeModulesState(worktreePath) {
  const target = resolve(worktreePath, 'node_modules');
  if (!existsSync(target)) return 'missing';
  const stat = lstatSync(target);
  if (!stat.isSymbolicLink()) return 'local';
  const link = readlinkSync(target);
  const resolved = resolve(dirname(target), link);
  return resolved === mainNodeModules ? 'shared' : `symlink:${resolved}`;
}

function linkNodeModules(worktreePath, { force = false } = {}) {
  const absolutePath = resolve(worktreePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Worktree path does not exist: ${absolutePath}`);
  }
  if (!existsSync(mainNodeModules)) {
    throw new Error(`Main node_modules does not exist: ${mainNodeModules}`);
  }

  const target = resolve(absolutePath, 'node_modules');
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) {
      const linked = resolve(dirname(target), readlinkSync(target));
      if (linked === mainNodeModules) {
        console.log(`already shared: ${target} -> ${mainNodeModules}`);
        return;
      }
      rmSync(target);
    } else {
      if (!force) {
        throw new Error(`Refusing to replace local node_modules at ${target}. Re-run with --force if it is disposable.`);
      }
      rmSync(target, { recursive: true, force: true });
    }
  }
  symlinkSync(mainNodeModules, target, 'dir');
  console.log(`linked: ${target} -> ${mainNodeModules}`);
}

function audit() {
  const entries = parseWorktrees();
  for (const entry of entries) {
    const branch = entry.branch || entry.detached || 'unknown';
    console.log(`${entry.path}\n  ${branch}\n  node_modules: ${nodeModulesState(entry.path)}`);
  }
}

function createWorktree() {
  const name = args[1];
  if (!name || name.startsWith('--')) {
    throw new Error('create requires a worktree name');
  }
  const branch = argValue('--branch', name);
  const base = argValue('--base', 'dev');
  const worktreePath = resolve(argValue('--path', resolve(defaultParent, `${basename(mainRepo)}-${name}`)));

  mkdirSync(dirname(worktreePath), { recursive: true });
  if (has('--fetch')) {
    run('git', ['fetch', '--all', '--prune'], { stdio: 'inherit' });
  }
  run('git', ['worktree', 'add', '-b', branch, worktreePath, base], { stdio: 'inherit' });
  linkNodeModules(worktreePath);
  console.log(`created lightweight worktree: ${worktreePath}`);
  console.log('Commit the feature, then use `npm run runner:test -- <commit>` for full local validation.');
}

function cleanupCandidates() {
  const base = argValue('--base', 'dev');
  const mergedBranches = new Set(
    run('git', ['branch', '--merged', base])
      .split('\n')
      .map((line) => line.replace(/^[* ]+/, '').trim())
      .filter(Boolean),
  );
  const entries = parseWorktrees();
  const candidates = [];
  for (const entry of entries) {
    if (resolve(entry.path) === mainRepo) continue;
    const branch = entry.branch?.replace(/^refs\/heads\//, '');
    if (!branch || !mergedBranches.has(branch)) continue;
    const status = run('git', ['-C', entry.path, 'status', '--porcelain']);
    if (status.trim()) continue;
    candidates.push({ path: entry.path, branch });
  }

  if (candidates.length === 0) {
    console.log(`No clean worktrees merged into ${base}.`);
    return;
  }
  console.log(`Clean worktrees merged into ${base}:`);
  for (const candidate of candidates) {
    console.log(`  ${candidate.path} (${candidate.branch})`);
  }
  console.log('\nReview before deleting. Suggested explicit command:');
  for (const candidate of candidates) {
    console.log(`  git worktree remove ${JSON.stringify(candidate.path)}`);
  }
}

try {
  if (command === 'help' || has('--help') || has('-h')) {
    usage();
  } else if (command === 'audit') {
    audit();
  } else if (command === 'link') {
    const worktreePath = args[1];
    if (!worktreePath) throw new Error('link requires a worktree path');
    linkNodeModules(worktreePath, { force: has('--force') });
  } else if (command === 'create') {
    createWorktree();
  } else if (command === 'cleanup-candidates') {
    cleanupCandidates();
  } else {
    usage();
    process.exit(1);
  }
} catch (error) {
  console.error(`\nworktree fastpath failed: ${error.message}`);
  process.exit(1);
}
