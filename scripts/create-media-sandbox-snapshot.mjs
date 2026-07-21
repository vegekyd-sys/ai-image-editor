/**
 * Create the dedicated disposable Node media executor base image.
 *
 * Run:
 *   npm run snapshot:media
 *
 * The printed snapshot ID belongs in MEDIA_SANDBOX_SNAPSHOT_ID. Do not use
 * REMOTION_SNAPSHOT_ID here: Remotion and open Agent code have independent
 * package, font, browser, and lifecycle contracts.
 */

const SANDBOX_ROOT = '/vercel/sandbox';
const SANDBOX_BIN = `${SANDBOX_ROOT}/bin`;
const SNAPSHOT_VERSION = 'media-node24-v1';

const PACKAGES = [
  // File-level media truth.
  'ffmpeg-static@5.3.0',
  'ffprobe-static@3.1.0',
  'sharp@0.34.5',
  'canvas@3.2.1',
  '@napi-rs/canvas@1.0.2',
  'exifr@7.1.3',
  'heic-convert@2.1.0',
  'jszip@3.10.1',
  'music-metadata@11.14.0',
  'file-type@22.0.1',
  'image-size@2.0.2',
  'jimp@1.6.1',
  'pngjs@7.0.0',

  // Natural Agent-authored JS/TS programs.
  'typescript@5.9.3',
  'tsx@4.22.4',
  'sucrase@3.35.1',
  'esbuild@0.28.1',

  // Preserve packages exposed by the previous Node media runtime.
  'remotion@4.0.448',
  '@remotion/media@4.0.448',
  '@remotion/media-utils@4.0.448',
  '@remotion/renderer@4.0.448',
];

const FONT_PACKAGES = [
  'fontconfig',
  'liberation-fonts',
  'dejavu-fonts-all',
  'google-noto-sans-cjk-ttc-fonts',
  'google-noto-emoji-color-fonts',
];

async function command(sandbox, label, cmd, args, options = {}) {
  console.log(`\n▶ ${label}`);
  const result = await sandbox.runCommand({
    cmd,
    args,
    cwd: options.cwd || SANDBOX_ROOT,
    env: {
      HOME: SANDBOX_ROOT,
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      NPM_CONFIG_CACHE: `${SANDBOX_ROOT}/.npm`,
      PATH: `${SANDBOX_BIN}:${SANDBOX_ROOT}/node_modules/.bin:/vercel/runtimes/node24/bin:/usr/local/bin:/usr/bin:/bin`,
      ...options.env,
    },
    ...(options.sudo ? { sudo: true } : {}),
  });
  const stdout = await result.stdout().catch(() => '');
  const stderr = await result.stderr().catch(() => '');
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${result.exitCode}`);
  }
  return result;
}

console.log(`Creating ${SNAPSHOT_VERSION} with ${PACKAGES.length} pinned npm packages...`);
const { Sandbox } = await import('@vercel/sandbox');
const sandbox = await Sandbox.create({
  runtime: 'node24',
  resources: { vcpus: 4 },
  timeout: 15 * 60_000,
});
let snapshotted = false;

try {
  await sandbox.mkDir(SANDBOX_BIN);
  await sandbox.writeFiles([
    {
      path: `${SANDBOX_ROOT}/package.json`,
      content: JSON.stringify({
        name: 'makaron-media-sandbox',
        private: true,
        version: '1.0.0',
        description: SNAPSHOT_VERSION,
      }, null, 2),
    },
    {
      path: `${SANDBOX_ROOT}/MEDIA_SANDBOX_VERSION`,
      content: `${SNAPSHOT_VERSION}\n`,
    },
  ]);

  await command(
    sandbox,
    'Install pinned Node media packages',
    'npm',
    ['install', '--save-exact', '--no-audit', '--no-fund', ...PACKAGES],
  );

  await command(
    sandbox,
    'Install CJK, emoji, and fallback system fonts',
    'sudo',
    ['dnf', 'install', '-y', ...FONT_PACKAGES],
    { sudo: true },
  );

  const linkSource = String.raw`
const fs = require('fs');
const path = require('path');
const root = '/vercel/sandbox';
const bin = path.join(root, 'bin');
fs.mkdirSync(bin, {recursive: true});
const commands = {
  ffmpeg: require('ffmpeg-static'),
  ffprobe: require('ffprobe-static').path,
};
for (const [name, target] of Object.entries(commands)) {
  const link = path.join(bin, name);
  fs.rmSync(link, {force: true});
  fs.symlinkSync(target, link);
  fs.chmodSync(target, 0o755);
}
console.log(JSON.stringify(commands));
`;
  await command(sandbox, 'Expose ffmpeg and ffprobe on PATH', 'node', ['-e', linkSource]);

  const moduleSmoke = String.raw`
const fs = require('fs');
const {execFileSync} = require('child_process');
const sharp = require('sharp');
const canvas = require('@napi-rs/canvas');
require('canvas');
require('exifr');
require('heic-convert');
require('jszip');
require('music-metadata');
require('image-size');
require('jimp');
require('pngjs');

const fontPath = execFileSync('fc-match', ['-f', '%{file}', 'Noto Sans CJK SC'], {encoding: 'utf8'}).trim();
if (!fontPath || !fs.existsSync(fontPath)) throw new Error('Noto Sans CJK SC was not installed');
canvas.GlobalFonts.registerFromPath(fontPath, 'Noto Sans CJK SC');
const image = canvas.createCanvas(720, 240);
const ctx = image.getContext('2d');
ctx.fillStyle = '#111';
ctx.fillRect(0, 0, 720, 240);
ctx.fillStyle = '#fff';
ctx.font = '700 52px Noto Sans CJK SC';
ctx.fillText('方形视频也要稳定 🎬', 36, 138);
fs.writeFileSync('/vercel/sandbox/cjk-smoke.png', image.toBuffer('image/png'));
console.log(JSON.stringify({sharp: sharp.versions.sharp, fontPath, pngBytes: fs.statSync('/vercel/sandbox/cjk-smoke.png').size}));
`;
  await command(sandbox, 'Load media packages and rasterize Chinese text', 'node', ['-e', moduleSmoke]);

  await command(sandbox, 'Generate H.264/AAC square MP4', `${SANDBOX_BIN}/ffmpeg`, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x320:rate=30:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', '-shortest',
    `${SANDBOX_ROOT}/media-smoke.mp4`,
  ]);
  await command(sandbox, 'Probe generated MP4', `${SANDBOX_BIN}/ffprobe`, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams',
    `${SANDBOX_ROOT}/media-smoke.mp4`,
  ]);

  console.log('\nCreating permanent Media Sandbox Snapshot...');
  const snapshot = await sandbox.snapshot({ expiration: 0 });
  snapshotted = true;
  console.log(`\nMEDIA_SANDBOX_SNAPSHOT_ID=${snapshot.snapshotId}`);
  console.log(`MEDIA_SANDBOX_VERSION=${SNAPSHOT_VERSION}`);
} finally {
  if (!snapshotted) await sandbox.stop().catch(() => {});
}
