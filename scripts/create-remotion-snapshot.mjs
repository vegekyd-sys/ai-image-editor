/**
 * Create a Vercel Sandbox Snapshot with Chrome + Remotion bundle + pinned fonts pre-warmed.
 * The exact same content-addressed WOFF2 assets are used by Player and Lambda.
 *
 * Run: node scripts/create-remotion-snapshot.mjs
 * Output: Snapshot ID for an isolated compatibility deployment.
 *
 * Do not assign an experimental snapshot to the project-wide Preview or
 * Production REMOTION_SNAPSHOT_ID. Vercel Preview env is shared by every
 * worktree/thread and older application deployments must remain compatible.
 *
 * Re-run when:
 * - Remotion version is bumped
 * - src/remotion/ code changes (index.tsx, DynamicDesign.tsx)
 * - You want to add more pre-cached fonts
 */

import path from 'path';
import { readdir, readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
loadEnv({ path: path.resolve(ROOT, '.env.local'), quiet: true });
loadEnv({ path: path.resolve(ROOT, '.env.vercel-oidc.local'), quiet: true });

const catalog = JSON.parse(await readFile(path.resolve(ROOT, 'src/remotion/font-catalog.json'), 'utf8'));
const CORE_PRELOAD_FAMILIES = new Set([
  'Inter',
  'Noto Sans SC',
  'Noto Serif SC',
  'Noto Color Emoji',
  'Ma Shan Zheng',
  'GFS Didot',
  'Playfair Display',
  'Montserrat',
]);
const PRELOAD_FONTS = catalog.families
  .map((font) => font.family)
  .filter((family) => CORE_PRELOAD_FAMILIES.has(family));

function cleanEnv(value) {
  return value?.replace(/\\[rn]|[\u0000-\u001F\u007F]/g, '').trim() || undefined;
}

function resolveManifestUrl() {
  const explicit = cleanEnv(process.env.REMOTION_FONT_MANIFEST_URL);
  if (explicit) return explicit;
  const serveUrl = cleanEnv(process.env.REMOTION_LAMBDA_SERVE_URL);
  if (!serveUrl) throw new Error('REMOTION_FONT_MANIFEST_URL or REMOTION_LAMBDA_SERVE_URL is required');
  return `${new URL(serveUrl).origin}/sites/_font-catalog/${catalog.version}/manifest.json`;
}

const fontManifestUrl = resolveManifestUrl();

// ─── Step 1: Bundle ───────────────────────────────────────────────────────

console.log('📦 Step 1: Bundling Remotion entry point...');
const t0 = Date.now();
const { bundle } = await import('@remotion/bundler');
const entryPoint = path.resolve(ROOT, 'src/remotion/index.tsx');
const outDir = path.resolve(ROOT, '.remotion-bundle');
const bundleDir = await bundle({
  entryPoint,
  outDir,
  onProgress: () => {},
  webpackOverride: (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        '@': path.resolve(ROOT, 'src'),
      },
    },
  }),
});
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

// DynamicDesign rewrites these public names to versioned internal family names,
// then loads the exact content-addressed assets from the shared manifest.
const fontLines = PRELOAD_FONTS.map((f, i) =>
  `React.createElement('div', { key: ${i}, style: { fontFamily: '${f}, sans-serif', fontSize: 24, color: 'white' } }, '${f} 字体预载 AaBb 你好世界 こんにちは 안녕하세요 😀')`
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
      fontManifestUrl,
      fontSubstitutions: {},
      fps: 30, durationInFrames: 1, width: 1080, height: 2400,
    },
    imageFormat: 'jpeg', jpegQuality: 50,
    chromiumOptions: { disableWebSecurity: true, gl: null },
    frame: 0, outputFile: '/tmp/font-preload.jpeg',
    timeoutInMilliseconds: 120000, // 2 min — CJK fonts are large
  });
  console.log(`✅ Fonts pre-cached: ${((Date.now() - t3) / 1000).toFixed(1)}s\n`);
} catch (e) {
  throw new Error(`Pinned font pre-warm failed; refusing to snapshot a partial cache: ${e.message}`);
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
console.log(`\nTest this snapshot in an isolated Preview deployment:`);
console.log(`  npx vercel -e REMOTION_SNAPSHOT_ID='${snapshot.snapshotId}' --yes`);
console.log(`\nDo not overwrite the project-wide Preview or Production REMOTION_SNAPSHOT_ID.`);
console.log(`Promote only after legacy and candidate application builds both pass real run_code + preview_frame smokes.`);
console.log(`\nTotal time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
