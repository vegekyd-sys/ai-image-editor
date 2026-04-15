/**
 * Create a Vercel Sandbox Snapshot with Chrome + Remotion bundle + fonts pre-installed.
 * Renders a design with 30 commonly used fonts to warm Chrome's font cache.
 * Snapshot includes cached fonts → subsequent renders skip font download.
 *
 * Run: node scripts/create-remotion-snapshot.mjs
 * Output: Snapshot ID to set as REMOTION_SNAPSHOT_ID env var.
 *
 * Re-run when:
 * - Remotion version is bumped
 * - src/remotion/ code changes (index.tsx, DynamicDesign.tsx)
 * - You want to add more pre-cached fonts
 */

import path from 'path';
import { readdir, readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── 30 fonts to pre-cache ────────────────────────────────────────────────
// CJK (Chinese Simplified, Traditional, Japanese, Korean)
// + Chinese decorative + Popular English design fonts
const PRELOAD_FONTS = [
  // Chinese Simplified
  'Noto Sans SC', 'Noto Serif SC',
  // Chinese Traditional
  'Noto Sans TC', 'Noto Serif TC',
  // Japanese
  'Noto Sans JP', 'Noto Serif JP',
  // Korean
  'Noto Sans KR', 'Noto Serif KR',
  // Chinese decorative
  'ZCOOL KuaiLe', 'ZCOOL XiaoWei', 'ZCOOL QingKe HuangYou',
  'Ma Shan Zheng', 'Liu Jian Mao Cao', 'Long Cang', 'Zhi Mang Xing',
  'LXGW WenKai TC',
  // English display/design
  'Playfair Display', 'Montserrat', 'Oswald', 'Poppins',
  'Lato', 'Inter', 'Roboto', 'Bebas Neue',
  'Dancing Script', 'Pacifico', 'Lobster', 'Anton',
  'Caveat', 'Raleway',
];

// ─── Step 1: Bundle ───────────────────────────────────────────────────────

console.log('📦 Step 1: Bundling Remotion entry point...');
const t0 = Date.now();
const { bundle } = await import('@remotion/bundler');
const entryPoint = path.resolve(ROOT, 'src/remotion/index.tsx');
const outDir = path.resolve(ROOT, '.remotion-bundle');
const bundleDir = await bundle({ entryPoint, outDir, onProgress: () => {} });
const relativeBundleDir = path.relative(ROOT, bundleDir);
console.log(`✅ Bundle: ${((Date.now() - t0) / 1000).toFixed(1)}s → ${relativeBundleDir}\n`);

// ─── Step 2: Create Sandbox ──────────────────────────────────────────────

console.log('🖥️ Step 2: Creating Vercel Sandbox (full cold start)...');
const t1 = Date.now();
const { createSandbox, renderStillOnVercel } = await import('@remotion/vercel');
const sandbox = await createSandbox({ resources: { vcpus: 4 } });
console.log(`✅ Sandbox created: ${((Date.now() - t1) / 1000).toFixed(1)}s (${sandbox.sandboxId})\n`);

// ─── Step 3: Upload bundle ───────────────────────────────────────────────

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

// ─── Step 4: Pre-cache fonts by rendering ────────────────────────────────

console.log(`🔤 Step 4: Pre-caching ${PRELOAD_FONTS.length} fonts...`);
const t3 = Date.now();

// Build design code that references all fonts — DynamicDesign will auto-load them via @remotion/google-fonts
const fontLines = PRELOAD_FONTS.map((f, i) =>
  `React.createElement('div', { key: ${i}, style: { fontFamily: "'${f}', sans-serif", fontSize: 24, color: 'white' } }, '${f} 字体预载 AaBb 你好世界 こんにちは 안녕하세요')`
).join(',\n      ');

const preloadCode = `function Design() {
  return React.createElement(AbsoluteFill, {
    style: { background: '#111', padding: 40, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }
  },
      ${fontLines}
  );
}`;

try {
  await renderStillOnVercel({
    sandbox,
    compositionId: 'dynamic-design',
    inputProps: {
      code: preloadCode,
      designProps: {},
      fps: 30, durationInFrames: 1, width: 1080, height: 2400,
    },
    imageFormat: 'jpeg', jpegQuality: 50,
    frame: 0, outputFile: '/tmp/font-preload.jpeg',
    timeoutInMilliseconds: 120000, // 2 min — CJK fonts are large
  });
  console.log(`✅ Fonts pre-cached: ${((Date.now() - t3) / 1000).toFixed(1)}s\n`);
} catch (e) {
  console.warn(`⚠️ Font pre-cache render failed (non-fatal): ${e.message}`);
  console.log(`  Fonts may still be partially cached.\n`);
}

// ─── Step 5: Snapshot ────────────────────────────────────────────────────

console.log('📸 Step 5: Creating permanent snapshot (with font cache)...');
const t4 = Date.now();
const snapshot = await sandbox.snapshot({ expiration: 0 });
console.log(`✅ Snapshot created: ${((Date.now() - t4) / 1000).toFixed(1)}s\n`);

console.log('='.repeat(50));
console.log(`Snapshot ID: ${snapshot.snapshotId}`);
console.log(`Fonts cached: ${PRELOAD_FONTS.length}`);
console.log('='.repeat(50));
console.log(`\nSet this as environment variable:`);
console.log(`  printf '${snapshot.snapshotId}' | npx vercel env add REMOTION_SNAPSHOT_ID preview --force`);
console.log(`  printf '${snapshot.snapshotId}' | npx vercel env add REMOTION_SNAPSHOT_ID production --force`);
console.log(`\nTotal time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
