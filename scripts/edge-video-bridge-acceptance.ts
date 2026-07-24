import { execFile } from 'child_process';
import { copyFile, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { findFfmpeg } from '../src/lib/ffmpeg-runtime';
import { inspectEdgeVideoBuffer } from '../src/lib/visual-assets/edge-video';

const execFileAsync = promisify(execFile);

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function generateFixture(outputPath: string): Promise<void> {
  const ffmpeg = await findFfmpeg();
  await execFileAsync(ffmpeg, [
    '-f', 'lavfi',
    '-i', 'color=c=0x121826:s=640x360:d=2:r=24',
    '-vf', 'drawbox=x=220:y=92:w=200:h=176:color=0x7c3aed:t=fill,drawbox=x=248:y=122:w=144:h=116:color=0xd946ef:t=fill',
    '-an',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
    '-y',
  ], { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 });
}

async function main() {
  const sourcePath = arg('--source');
  const targetBackground = arg('--target') || '#121826';
  const outDir = path.resolve(arg('--out') || '/tmp/makaron-edge-video-bridge-acceptance');
  await mkdir(outDir, { recursive: true });
  const sourceOutput = path.join(outDir, '01-edge-video-source.mp4');
  if (sourcePath) {
    await copyFile(path.resolve(sourcePath), sourceOutput);
  } else {
    await generateFixture(sourceOutput);
  }

  const inspection = await inspectEdgeVideoBuffer(await readFile(sourceOutput), targetBackground);
  const qaOutput = path.join(outDir, '02-edge-video-qa.jpg');
  const reportOutput = path.join(outDir, 'acceptance.json');
  await Promise.all([
    writeFile(qaOutput, inspection.contactSheet),
    writeFile(reportOutput, JSON.stringify({
      status: inspection.quality.status,
      source: sourcePath ? path.resolve(sourcePath) : 'generated-opaque-edge-video-fixture',
      width: inspection.width,
      height: inspection.height,
      durationSeconds: inspection.durationSeconds,
      fps: inspection.fps,
      targetBackground: inspection.targetBackground,
      edgePalette: inspection.edgePalette,
      recommendedFeatherPx: inspection.recommendedFeatherPx,
      frameStats: inspection.frameStats,
      quality: inspection.quality,
      outputs: { sourceOutput, qaOutput },
    }, null, 2)),
  ]);
  console.log(JSON.stringify({
    status: inspection.quality.status,
    issues: inspection.quality.issues,
    metrics: inspection.quality.metrics,
    targetBackground: inspection.targetBackground,
    edgePalette: inspection.edgePalette,
    outputs: { sourceOutput, qaOutput, reportOutput },
  }, null, 2));
  if (inspection.quality.status !== 'pass') process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
