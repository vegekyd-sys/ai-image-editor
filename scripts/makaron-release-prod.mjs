#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    const output = options.stdio === 'pipe'
      ? [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      : '';
    throw new Error(`${command} ${commandArgs.join(' ')} failed${output ? `\n${output}` : ''}`);
  }
  return result.stdout || '';
}

function capture(command, commandArgs) {
  return run(command, commandArgs, { stdio: 'pipe' }).trim();
}

function devWorktreePath() {
  const raw = capture('git', ['worktree', 'list', '--porcelain']);
  const blocks = raw.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
    if (!lines.includes('branch refs/heads/dev')) continue;
    const worktreeLine = lines.find(line => line.startsWith('worktree '));
    if (worktreeLine) return realpathSync(worktreeLine.slice('worktree '.length));
  }
  throw new Error('No worktree currently owns the dev branch.');
}

function preflight() {
  const canonical = devWorktreePath();
  const current = realpathSync(process.cwd());
  if (current !== canonical) {
    throw new Error(`Production deploy is only allowed from the canonical dev worktree:\n${canonical}\nCurrent directory:\n${current}`);
  }
  const branch = capture('git', ['branch', '--show-current']);
  if (branch !== 'dev') throw new Error(`Production deploy requires branch dev, found ${branch || '(detached)'}.`);
  const status = capture('git', ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) throw new Error(`Production deploy requires a clean dev worktree:\n${status}`);
  if (!existsSync(resolve(current, '.vercel', 'project.json'))) {
    throw new Error('Production deploy requires .vercel/project.json in the canonical dev worktree.');
  }
  const commit = capture('git', ['rev-parse', 'HEAD']);
  console.log(`Production preflight passed: dev @ ${commit}`);
  return commit;
}

try {
  preflight();
  if (args.includes('--check-only')) {
    console.log('Check-only mode: no tests or deployment were started.');
  } else {
    run('npm', ['run', 'release:check', '--', '--local']);
    run('npx', ['vercel', '--prod']);
    run('npm', ['run', 'release:check', '--', '--health']);
  }
} catch (error) {
  console.error(`\nproduction release blocked: ${error.message}`);
  process.exitCode = 1;
}
