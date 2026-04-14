/**
 * Create a Vercel Sandbox Snapshot with Chrome + Remotion bundle pre-installed.
 * This snapshot is used for production rendering via REMOTION_SNAPSHOT_ID.
 *
 * Run: node scripts/create-remotion-snapshot.mjs
 * Output: Snapshot ID to set as REMOTION_SNAPSHOT_ID env var.
 *
 * Re-run when:
 * - Remotion version is bumped
 * - src/remotion/ code changes (index.tsx, DynamicDesign.tsx)
 */

import path from 'path';
import { readdir, readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Step 1: Bundle
console.log('📦 Step 1: Bundling Remotion entry point...');
const t0 = Date.now();
const { bundle } = await import('@remotion/bundler');
const entryPoint = path.resolve(ROOT, 'src/remotion/index.tsx');
const outDir = path.resolve(ROOT, '.remotion-bundle');
const bundleDir = await bundle({ entryPoint, outDir, onProgress: () => {} });
const relativeBundleDir = path.relative(ROOT, bundleDir);
console.log(`✅ Bundle: ${((Date.now() - t0) / 1000).toFixed(1)}s → ${relativeBundleDir}\n`);

// Step 2: Create full sandbox (cold start — OK, one-time cost)
console.log('🖥️ Step 2: Creating Vercel Sandbox (full cold start)...');
const t1 = Date.now();
const { createSandbox } = await import('@remotion/vercel');
const sandbox = await createSandbox({ resources: { vcpus: 2 } });
console.log(`✅ Sandbox created: ${((Date.now() - t1) / 1000).toFixed(1)}s (${sandbox.sandboxId})\n`);

// Step 3: Upload bundle (with recursive mkdir workaround)
console.log('📤 Step 3: Uploading bundle to Sandbox...');
const t2 = Date.now();
const BUNDLE_ROOT = 'remotion-bundle';
const fullBundleDir = path.resolve(ROOT, relativeBundleDir);
const files = [];
async function walk(dir, base = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) await walk(full, rel);
    else files.push({ path: rel, content: await readFile(full) });
  }
}
await walk(fullBundleDir);
const dirs = new Set();
for (const f of files) {
  const d = path.dirname(f.path);
  if (d && d !== '.') {
    const parts = d.split(path.sep);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
}
await sandbox.mkDir(BUNDLE_ROOT);
for (const d of Array.from(dirs).sort()) await sandbox.mkDir(`${BUNDLE_ROOT}/${d}`);
await sandbox.writeFiles(files.map(f => ({ path: `${BUNDLE_ROOT}/${f.path}`, content: f.content })));
console.log(`✅ Bundle uploaded: ${((Date.now() - t2) / 1000).toFixed(1)}s (${files.length} files)\n`);

// Step 4: Take snapshot (permanent)
console.log('📸 Step 4: Creating permanent snapshot...');
const t3 = Date.now();
const snapshot = await sandbox.snapshot({ expiration: 0 });
console.log(`✅ Snapshot created: ${((Date.now() - t3) / 1000).toFixed(1)}s\n`);

console.log('='.repeat(50));
console.log(`Snapshot ID: ${snapshot.snapshotId}`);
console.log('='.repeat(50));
console.log(`\nSet this as environment variable:`);
console.log(`  printf '${snapshot.snapshotId}' | npx vercel env add REMOTION_SNAPSHOT_ID preview --force`);
console.log(`  printf '${snapshot.snapshotId}' | npx vercel env add REMOTION_SNAPSHOT_ID production --force`);
console.log(`\nTotal time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
