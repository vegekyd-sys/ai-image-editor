#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const invocationRepo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const command = args[0] || 'help';

function usage() {
  console.log(`Makaron fixed runtime runner

Usage:
  node scripts/makaron-runner.mjs setup [--path <runner>] [--base dev]
  node scripts/makaron-runner.mjs status [--path <runner>]
  node scripts/makaron-runner.mjs test <ref> [--path <runner>]
  node scripts/makaron-runner.mjs dev <ref> [--path <runner>] [--port 3039]
  node scripts/makaron-runner.mjs preview <ref> [--path <runner>] [--skip-check]

Contract:
  - Feature worktrees stay code-only and do not create their own .next directory.
  - The fixed runner reuses one .next cache across committed refs.
  - The runner symlinks ignored local env files and copies Vercel project identity
    from the canonical dev worktree.
  - When package-lock.json matches dev, the runner shares dev node_modules.
    When it differs, the runner installs a local disposable node_modules.
  - test and preview require a committed ref and a clean runner.
  - preview deploys a Vercel Preview only. Production uses npm run release:prod.
`);
}

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] || fallback;
}

function has(name) {
  return args.includes(name);
}

function run(commandName, commandArgs, options = {}) {
  const result = spawnSync(commandName, commandArgs, {
    cwd: invocationRepo,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    const output = options.stdio === 'pipe'
      ? [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      : '';
    throw new Error(`${commandName} ${commandArgs.join(' ')} failed${output ? `\n${output}` : ''}`);
  }
  return result.stdout || '';
}

function capture(commandName, commandArgs, cwd = invocationRepo) {
  return run(commandName, commandArgs, { cwd, stdio: 'pipe' }).trim();
}

function parseWorktrees() {
  const raw = capture('git', ['worktree', 'list', '--porcelain']);
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
    if (key === 'worktree') current = { path: value };
    else if (current) current[key] = value || true;
  }
  if (current) entries.push(current);
  return entries;
}

function canonicalDevWorktree() {
  const entry = parseWorktrees().find(item => item.branch === 'refs/heads/dev');
  if (!entry) throw new Error('No worktree currently owns the dev branch.');
  return realpathSync(entry.path);
}

function runnerPath() {
  const devPath = canonicalDevWorktree();
  const defaultPath = resolve(dirname(devPath), `${basename(devPath)}-runner`);
  return resolve(argValue('--path', defaultPath));
}

function ensureRunnerExists(path, base = 'dev') {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    run('git', ['worktree', 'add', '--detach', path, base], { cwd: canonicalDevWorktree() });
  }
  const inside = capture('git', ['rev-parse', '--is-inside-work-tree'], path);
  if (inside !== 'true') throw new Error(`Runner path is not a git worktree: ${path}`);
}

function ensureSymlink(source, target) {
  if (!existsSync(source)) return;
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) {
      const resolved = resolve(dirname(target), readlinkSync(target));
      if (resolved === source) return;
      rmSync(target);
    } else {
      throw new Error(`Refusing to replace local config at ${target}. Move it aside first.`);
    }
  }
  symlinkSync(source, target);
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function ensureDependencies(path, devPath) {
  const target = resolve(path, 'node_modules');
  const shared = resolve(devPath, 'node_modules');
  if (!existsSync(shared)) {
    throw new Error(`Canonical dev node_modules is missing: ${shared}`);
  }

  const runnerLock = resolve(path, 'package-lock.json');
  const devLock = resolve(devPath, 'package-lock.json');
  const locksMatch = existsSync(runnerLock)
    && existsSync(devLock)
    && hashFile(runnerLock) === hashFile(devLock);

  if (locksMatch) {
    if (existsSync(target) && !lstatSync(target).isSymbolicLink()) {
      console.log('Dependency lock returned to dev; removing disposable runner node_modules.');
      rmSync(target, { recursive: true, force: true });
    }
    ensureSymlink(shared, target);
    return 'shared';
  }

  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    rmSync(target);
  }
  const marker = resolve(target, '.makaron-package-lock.sha256');
  const expectedHash = existsSync(runnerLock) ? hashFile(runnerLock) : 'missing';
  if (!existsSync(target) || !existsSync(marker) || readFileSync(marker, 'utf8').trim() !== expectedHash) {
    console.log('package-lock.json differs from dev; installing disposable runner-local dependencies.');
    run('npm', ['ci'], { cwd: path });
    writeFileSync(marker, `${expectedHash}\n`);
  }
  return 'local';
}

function syncIgnoredConfig(path, devPath) {
  for (const name of ['.env.local', '.env.production']) {
    ensureSymlink(resolve(devPath, name), resolve(path, name));
  }
  const sourceProject = resolve(devPath, '.vercel', 'project.json');
  if (existsSync(sourceProject)) {
    const targetDir = resolve(path, '.vercel');
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(sourceProject, resolve(targetDir, 'project.json'));
  }
}

function configureRunner(path) {
  const devPath = canonicalDevWorktree();
  syncIgnoredConfig(path, devPath);
  const dependencyMode = ensureDependencies(path, devPath);
  return { devPath, dependencyMode };
}

function setup() {
  const path = runnerPath();
  ensureRunnerExists(path, argValue('--base', 'dev'));
  const config = configureRunner(path);
  console.log(`runner: ${path}`);
  console.log(`canonical dev: ${config.devPath}`);
  console.log(`dependencies: ${config.dependencyMode}`);
}

function assertClean(path) {
  const status = capture('git', ['status', '--porcelain=v1', '--untracked-files=all'], path);
  if (status) {
    throw new Error(`Runner has tracked or untracked changes and will not switch refs:\n${status}`);
  }
}

function prepareRef(ref) {
  if (!ref || ref.startsWith('--')) throw new Error(`${command} requires a committed git ref.`);
  const path = runnerPath();
  ensureRunnerExists(path);
  assertClean(path);
  run('git', ['switch', '--detach', ref], { cwd: path });
  const config = configureRunner(path);
  const commit = capture('git', ['rev-parse', 'HEAD'], path);
  console.log(`runner prepared: ${path}`);
  console.log(`commit: ${commit}`);
  console.log(`dependencies: ${config.dependencyMode}`);
  return path;
}

function status() {
  const path = runnerPath();
  if (!existsSync(path)) {
    console.log(`runner missing: ${path}`);
    return;
  }
  const commit = capture('git', ['rev-parse', '--short=12', 'HEAD'], path);
  const branch = capture('git', ['branch', '--show-current'], path) || '(detached)';
  const dirty = capture('git', ['status', '--porcelain=v1', '--untracked-files=all'], path);
  const nextPath = resolve(path, '.next');
  console.log(`runner: ${path}`);
  console.log(`ref: ${branch} @ ${commit}`);
  console.log(`worktree: ${dirty ? 'dirty' : 'clean'}`);
  console.log(`next cache: ${existsSync(nextPath) ? nextPath : 'not created'}`);
}

function test() {
  const path = prepareRef(args[1]);
  run('npm', ['run', 'release:check', '--', '--local'], { cwd: path });
}

function dev() {
  const path = prepareRef(args[1]);
  const port = argValue('--port', '3039');
  run('npm', ['run', 'dev', '--', '--port', port], { cwd: path });
}

function preview() {
  const path = prepareRef(args[1]);
  if (!has('--skip-check')) {
    run('npm', ['run', 'release:check', '--', '--local'], { cwd: path });
  }
  run('npx', ['vercel'], { cwd: path });
}

try {
  if (command === 'help' || has('--help') || has('-h')) usage();
  else if (command === 'setup') setup();
  else if (command === 'status') status();
  else if (command === 'test') test();
  else if (command === 'dev') dev();
  else if (command === 'preview') preview();
  else {
    usage();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`\nrunner failed: ${error.message}`);
  process.exitCode = 1;
}
