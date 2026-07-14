import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import sharp from 'sharp';
import { findFfmpeg, probeVideoFile } from '../ffmpeg-runtime';
import type { VisualAssetQuality } from './contracts';
import { colorDistance, colorToHex, parseHexColor, type RgbColor } from './image-cutout';

const execFileAsync = promisify(execFile);

export interface EdgeFrameStats {
  color: string;
  standardDeviation: number;
  highDetailRatio: number;
}

export interface EdgeVideoAnalysis {
  width: number;
  height: number;
  durationSeconds: number;
  fps?: number;
  targetBackground: string;
  edgePalette: string[];
  recommendedFeatherPx: number;
  frameStats: EdgeFrameStats[];
  quality: VisualAssetQuality;
}

export interface EdgeVideoInspection extends EdgeVideoAnalysis {
  frames: Buffer[];
  contactSheet: Buffer;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

async function analyzeFrame(frame: Buffer): Promise<{ width: number; height: number; color: RgbColor; standardDeviation: number; highDetailRatio: number }> {
  const { data, info } = await sharp(frame).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.04));
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 240));
  const samples: RgbColor[] = [];

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      const offset = (y * width + x) * channels;
      samples.push({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
    }
  }
  if (samples.length === 0) throw new Error('Cannot sample video frame edges');
  const color = {
    r: median(samples.map(sample => sample.r)),
    g: median(samples.map(sample => sample.g)),
    b: median(samples.map(sample => sample.b)),
  };
  const distances = samples.map(sample => colorDistance(sample, color));
  const variance = distances.reduce((sum, value) => sum + value ** 2, 0) / distances.length;
  return {
    width,
    height,
    color,
    standardDeviation: Math.sqrt(variance),
    highDetailRatio: distances.filter(distance => distance > 52).length / distances.length,
  };
}

export async function analyzeEdgeFrameBuffers(
  frames: Buffer[],
  targetBackground?: string,
): Promise<EdgeVideoAnalysis> {
  if (frames.length < 2) throw new Error('Edge-video analysis needs at least two frames');
  const analyzed = await Promise.all(frames.map(analyzeFrame));
  const width = analyzed[0].width;
  const height = analyzed[0].height;
  if (analyzed.some(frame => frame.width !== width || frame.height !== height)) {
    throw new Error('Edge-video sample frames must share dimensions');
  }

  const target = targetBackground
    ? parseHexColor(targetBackground)
    : {
      r: median(analyzed.map(frame => frame.color.r)),
      g: median(analyzed.map(frame => frame.color.g)),
      b: median(analyzed.map(frame => frame.color.b)),
    };
  const targetHex = colorToHex(target);
  const targetDistances = analyzed.map(frame => colorDistance(frame.color, target));
  const maxTargetDistance = Math.max(...targetDistances);
  const meanTargetDistance = targetDistances.reduce((sum, value) => sum + value, 0) / targetDistances.length;
  const maxStandardDeviation = Math.max(...analyzed.map(frame => frame.standardDeviation));
  const maxHighDetailRatio = Math.max(...analyzed.map(frame => frame.highDetailRatio));
  const palette = [...new Set(analyzed.map(frame => colorToHex(frame.color)))];
  const temporalSpread = Math.max(
    ...analyzed.flatMap((frame, index) => analyzed.slice(index + 1).map(other => colorDistance(frame.color, other.color))),
    0,
  );
  const stableMatchingEdge = maxTargetDistance <= 20
    && meanTargetDistance <= 14
    && temporalSpread <= 18;
  const moderateEdgeDetail = maxStandardDeviation <= 56 && maxHighDetailRatio <= 0.16;
  const needsWideFeather = stableMatchingEdge
    && (maxStandardDeviation > 46 || maxHighDetailRatio > 0.14);
  const issues: string[] = [];
  if (maxTargetDistance > 48) issues.push('Video border color drifts too far from the intended composition background.');
  if ((maxStandardDeviation > 46 || maxHighDetailRatio > 0.14) && !(stableMatchingEdge && moderateEdgeDetail)) {
    issues.push('Video borders contain too much detail or contrast to blend cleanly.');
  }
  if (palette.length > 1) {
    if (temporalSpread > 38) issues.push('Video border color changes too much over time and may reveal the rectangular boundary.');
  }

  return {
    width,
    height,
    durationSeconds: 1,
    targetBackground: targetHex,
    edgePalette: palette,
    recommendedFeatherPx: Math.max(20, Math.min(96, Math.round(Math.min(width, height) * (needsWideFeather ? 0.09 : 0.045)))),
    frameStats: analyzed.map(frame => ({
      color: colorToHex(frame.color),
      standardDeviation: frame.standardDeviation,
      highDetailRatio: frame.highDetailRatio,
    })),
    quality: {
      status: issues.length === 0 ? 'pass' : 'revise',
      issues,
      metrics: {
        meanTargetDistance,
        maxTargetDistance,
        maxEdgeStandardDeviation: maxStandardDeviation,
        maxHighDetailRatio,
        temporalEdgeColorSpread: temporalSpread,
        wideFeatherRequired: needsWideFeather ? 1 : 0,
      },
    },
  };
}

function labelSvg(width: number, text: string): Buffer {
  const safe = text.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char] || char));
  return Buffer.from(`<svg width="${width}" height="32" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#111318" fill-opacity="0.9"/>
    <text x="12" y="22" fill="#ffffff" font-size="13" font-family="Arial, sans-serif">${safe}</text>
  </svg>`);
}

export async function renderEdgeVideoContactSheet(
  frames: Buffer[],
  analysis: EdgeVideoAnalysis,
): Promise<Buffer> {
  const tileWidth = 360;
  const tileHeight = 240;
  const columns = 3;
  const rows = Math.ceil(frames.length / columns);
  const frameWidth = tileWidth - 34;
  const frameHeight = tileHeight - 54;
  const tiles = await Promise.all(frames.map(async (frame, index) => {
    const resized = await sharp(frame).resize(frameWidth, frameHeight, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
    const stats = analysis.frameStats[index];
    return sharp({ create: { width: tileWidth, height: tileHeight, channels: 4, background: analysis.targetBackground } })
      .composite([
        { input: resized, left: 17, top: 11 },
        { input: labelSvg(tileWidth, `sample ${index + 1}  edge ${stats.color}`), left: 0, top: tileHeight - 32 },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
  }));
  return sharp({ create: { width: tileWidth * columns, height: tileHeight * rows, channels: 4, background: '#17191f' } })
    .composite(tiles.map((input, index) => ({
      input,
      left: index % columns * tileWidth,
      top: Math.floor(index / columns) * tileHeight,
    })))
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function inspectEdgeVideoBuffer(
  video: Buffer,
  targetBackground?: string,
): Promise<EdgeVideoInspection> {
  if (video.length === 0) throw new Error('Edge-video source is empty');
  const dir = await mkdtemp(path.join(tmpdir(), 'makaron-edge-video-'));
  const inputPath = path.join(dir, 'source-video');
  try {
    await writeFile(inputPath, video);
    const probe = await probeVideoFile(inputPath);
    const duration = probe.duration;
    if (!duration || duration <= 0) throw new Error('Could not determine edge-video duration');
    const timestamps = [
      Math.min(0.1, duration * 0.05),
      duration * 0.25,
      duration * 0.5,
      duration * 0.75,
      Math.max(0, duration - Math.min(0.1, duration * 0.05)),
    ];
    const ffmpeg = await findFfmpeg();
    const frames: Buffer[] = [];
    for (const [index, timestamp] of timestamps.entries()) {
      const outputPath = path.join(dir, `frame-${index}.png`);
      await execFileAsync(ffmpeg, [
        '-ss', timestamp.toFixed(3),
        '-i', inputPath,
        '-frames:v', '1',
        '-vf', 'scale=640:-2',
        outputPath,
        '-y',
      ], { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 });
      frames.push(await readFile(outputPath));
    }
    const analysis = await analyzeEdgeFrameBuffers(frames, targetBackground);
    analysis.durationSeconds = duration;
    analysis.fps = probe.fps;
    analysis.width = probe.width || analysis.width;
    analysis.height = probe.height || analysis.height;
    const wideFeather = analysis.quality.metrics?.wideFeatherRequired === 1;
    analysis.recommendedFeatherPx = Math.max(20, Math.min(96, Math.round(Math.min(analysis.width, analysis.height) * (wideFeather ? 0.09 : 0.045))));
    const contactSheet = await renderEdgeVideoContactSheet(frames, analysis);
    return { ...analysis, frames, contactSheet };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
