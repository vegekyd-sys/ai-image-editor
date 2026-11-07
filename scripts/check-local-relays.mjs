#!/usr/bin/env node
// Local dev preflight for subscription relays (Codex / Grok).
//
// Why: the Codex relay used to be exposed through a Cloudflare quick tunnel whose URL
// rotated on restart (fixed at codex-relay.tianyi.live since 2026-11-07). Vercel env got the new URL, but `.env.local` keeps the
// old one, so every local Agent turn burns several durable attempts on a dead
// host before falling back. This script makes that drift visible at `npm run dev`
// and can copy the current relay values from Vercel into `.env.local`.
//
//   node scripts/check-local-relays.mjs          # probe, warn only (never fails dev)
//   node scripts/check-local-relays.mjs --sync   # pull relay vars from Vercel into .env.local
//
// Only hostnames are printed; secrets never reach stdout.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const RELAY_KEYS = [
  'CODEX_SUBSCRIPTION_RELAY_URL',
  'CODEX_SUBSCRIPTION_RELAY_SECRET',
  'GROK_SUBSCRIPTION_RELAY_URL',
  'GROK_SUBSCRIPTION_RELAY_SECRET',
];
const URL_KEYS = RELAY_KEYS.filter((key) => key.endsWith('_URL'));
const envPath = resolve(process.cwd(), '.env.local');
const args = new Set(process.argv.slice(2));
const PROBE_TIMEOUT_MS = 4_000;

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value.replace(/\\n$/, '').trim());
  }
  return values;
}

function host(value) {
  try { return new URL(value).host; } catch { return '(invalid URL)'; }
}

async function probe(url) {
  // Any HTTP status proves DNS + TLS + tunnel are alive; only network errors count.
  try {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await response.body?.cancel().catch(() => undefined);
    // Cloudflare answers 530 for a tunnel hostname with no connector behind it.
    if (response.status === 530) return { ok: false, reason: 'HTTP 530 (tunnel has no connector)' };
    return { ok: true, reason: `HTTP ${response.status}` };
  } catch (error) {
    const cause = error?.cause?.code || error?.cause?.message || error?.name || String(error);
    return { ok: false, reason: String(cause) };
  }
}

async function check() {
  if (!existsSync(envPath)) return 0;
  const env = parseEnv(readFileSync(envPath, 'utf8'));
  const targets = URL_KEYS.filter((key) => env.get(key));
  if (!targets.length) return 0;
  const results = await Promise.all(targets.map(async (key) => ({ key, url: env.get(key), ...(await probe(env.get(key))) })));
  const dead = results.filter((result) => !result.ok);
  for (const result of results) {
    if (result.ok) console.log(`[relay-check] ${result.key} ${host(result.url)} reachable (${result.reason})`);
  }
  if (!dead.length) return 0;
  const bar = '='.repeat(78);
  console.warn(`\n${bar}`);
  console.warn('[relay-check] Subscription relay unreachable from .env.local:');
  for (const result of dead) console.warn(`  - ${result.key} → ${host(result.url)}  (${result.reason})`);
  console.warn('  Agent turns on this model will be slow until the URL is fixed (the server');
  console.warn('  retries once, then uses the API backup). If Vercel has a newer value,');
  console.warn('  copy the current values from Vercel with:');
  console.warn('    npm run env:sync-relays');
  console.warn(`${bar}\n`);
  return dead.length;
}

// Feature worktrees symlink `.env.local` from the canonical checkout and are
// usually not `vercel link`ed themselves; run the pull where a link exists.
function vercelLinkedDir() {
  const candidates = [process.cwd(), dirname(realpathSync(envPath))];
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
  if (common.status === 0 && common.stdout.trim()) candidates.push(dirname(common.stdout.trim()));
  return candidates.find((dir) => existsSync(join(dir, '.vercel', 'project.json')));
}

function sync() {
  if (!existsSync(envPath)) {
    console.error(`[relay-sync] ${envPath} not found`);
    process.exit(1);
  }
  const environment = process.env.RELAY_SYNC_ENV || 'preview';
  const dir = mkdtempSync(join(tmpdir(), 'makaron-relay-sync-'));
  const pulled = join(dir, '.env.pulled');
  try {
    const linkedDir = vercelLinkedDir();
    if (!linkedDir) {
      console.error('[relay-sync] No `vercel link`ed checkout found (looked in cwd, the .env.local target, and the main worktree).');
      process.exit(1);
    }
    const result = spawnSync('vercel', ['env', 'pull', pulled, `--environment=${environment}`, '--yes'], {
      cwd: linkedDir,
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    });
    if (result.status !== 0 || !existsSync(pulled)) {
      console.error(`[relay-sync] vercel env pull failed: ${(result.stderr || '').trim().split('\n').pop()}`);
      process.exit(1);
    }
    const remote = parseEnv(readFileSync(pulled, 'utf8'));
    let text = readFileSync(envPath, 'utf8');
    const local = parseEnv(text);
    const changed = [];
    for (const key of RELAY_KEYS) {
      const value = remote.get(key);
      if (!value || local.get(key) === value) continue;
      const line = `${key}=${value}`;
      const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
      text = pattern.test(text) ? text.replace(pattern, () => line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
      changed.push(key.endsWith('_URL') ? `${key}: ${host(local.get(key) || '')} → ${host(value)}` : `${key}: updated`);
    }
    if (!changed.length) {
      console.log(`[relay-sync] .env.local already matches Vercel ${environment} relay settings.`);
      return;
    }
    writeFileSync(envPath, text);
    for (const line of changed) console.log(`[relay-sync] ${line}`);
    console.log('[relay-sync] Restart the dev server to pick up the new values.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (args.has('--sync')) {
  sync();
} else {
  // Never block `npm run dev`; the warning is the point.
  await check().catch((error) => console.warn(`[relay-check] skipped: ${error?.message || error}`));
}
