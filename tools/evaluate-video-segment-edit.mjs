#!/usr/bin/env node
import { execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';

const exec = promisify(execFile);

function loadEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    cases: 'tools/video-segment-edit-cases.json',
    envFile: '.env.local',
    model: 'gemini-3-flash-preview',
    output: '',
    only: '',
    video: '',
    skipAi: false,
    visualInterval: 0.5,
    visualThreshold: 35,
    keepTemp: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--cases') opts.cases = args[++i];
    else if (arg === '--env-file') opts.envFile = args[++i];
    else if (arg === '--model') opts.model = args[++i];
    else if (arg === '--output') opts.output = args[++i];
    else if (arg === '--only') opts.only = args[++i];
    else if (arg === '--video') opts.video = args[++i];
    else if (arg === '--skip-ai') opts.skipAi = true;
    else if (arg === '--visual-interval') opts.visualInterval = Number(args[++i]);
    else if (arg === '--visual-threshold') opts.visualThreshold = Number(args[++i]);
    else if (arg === '--keep-temp') opts.keepTemp = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

function usage() {
  return `Usage:
  node tools/evaluate-video-segment-edit.mjs [options]

Options:
  --cases <json>       Dataset manifest. Default tools/video-segment-edit-cases.json
  --env-file <path>    Env file with GOOGLE_API_KEY. Default .env.local
  --only <case-id>     Run one case
  --video <path>       Override every case video path
  --skip-ai            Only prepare screenshots and segment windows from expected timestamps
  --visual-interval N  Seconds between local visual-search samples. Default 0.5
  --visual-threshold N RMSE threshold for accepting visual-search fallback. Default 35
  --output <path>      Write JSON report
  --keep-temp          Keep generated screenshots
`;
}

function resolvePath(value) {
  if (!value) return value;
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2));
  if (path.isAbsolute(value)) return value;
  return path.resolve(process.cwd(), value);
}

function stripJsonFence(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function roundTime(value) {
  return Math.round(value * 10) / 10;
}

function planSegmentWindow({ timestamp, modelWindow, modelMinSeconds, maxWindowSeconds, duration, locatedWindow }) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(duration) || duration <= 0) return null;
  let center = timestamp;
  let seconds = modelWindow || modelMinSeconds || 4;
  if (Array.isArray(locatedWindow) && locatedWindow.length === 2) {
    const [start, end] = locatedWindow.map(Number);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      center = (start + end) / 2;
      seconds = Math.max(seconds, end - start);
    }
  }
  if (Number.isFinite(maxWindowSeconds) && maxWindowSeconds > 0) seconds = Math.min(seconds, maxWindowSeconds);
  seconds = Math.max(seconds, modelMinSeconds || 4);
  seconds = Math.min(seconds, duration);

  let start = center - seconds / 2;
  let end = center + seconds / 2;
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > duration) {
    start = Math.max(0, start - (end - duration));
    end = duration;
  }
  return {
    start: roundTime(start),
    end: roundTime(end),
    duration: roundTime(end - start),
    containsTimestamp: timestamp >= start && timestamp <= end,
  };
}

async function probeDuration(video) {
  const { stdout } = await exec('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nk=1:nw=1',
    video,
  ]);
  return Number(stdout.trim());
}

async function extractFrame(video, timestamp, output) {
  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(timestamp),
    '-i', video,
    '-frames:v', '1',
    '-q:v', '2',
    output,
  ]);
}

async function imageVector(filePath) {
  return sharp(filePath)
    .resize(160, 90, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .raw()
    .toBuffer();
}

function rmse(a, b) {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const delta = a[i] - b[i];
    sum += delta * delta;
  }
  return Math.sqrt(sum / len);
}

async function prepareVisualIndex({ video, duration, interval, dir }) {
  await mkdir(dir, { recursive: true });
  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', video,
    '-vf', `fps=1/${interval}`,
    '-q:v', '3',
    path.join(dir, 'sample-%06d.jpg'),
  ]);
  const files = (await readdir(dir))
    .filter((file) => /^sample-\d+\.jpg$/.test(file))
    .sort();
  const samples = [];
  for (let i = 0; i < files.length; i += 1) {
    const timestamp = Math.min(duration, i * interval);
    const frame = path.join(dir, files[i]);
    samples.push({
      timestamp: roundTime(timestamp),
      vector: await imageVector(frame),
    });
  }
  return { video, duration, interval, samples };
}

async function visualSearch({ screenshot, visualIndex }) {
  const anchor = await imageVector(screenshot);
  const candidates = [];
  for (const sample of visualIndex.samples) {
    const distance = rmse(anchor, sample.vector);
    candidates.push({ timestamp: sample.timestamp, score: Math.round(distance * 100) / 100 });
  }
  candidates.sort((a, b) => a.score - b.score);
  const bestScore = candidates[0]?.score ?? null;
  const nearCutoff = Number.isFinite(bestScore) ? bestScore + Math.max(1, bestScore * 0.1) : null;
  const nearMatches = Number.isFinite(nearCutoff)
    ? candidates.filter((candidate) => candidate.score <= nearCutoff)
    : [];
  const nearTimes = nearMatches.map((candidate) => candidate.timestamp);
  const nearMatchSpan = nearTimes.length
    ? Math.round((Math.max(...nearTimes) - Math.min(...nearTimes)) * 100) / 100
    : null;
  return {
    bestTimestamp: candidates[0]?.timestamp ?? null,
    bestScore,
    nearMatchCount: nearMatches.length,
    nearMatchSpan,
    top: candidates.slice(0, 5),
  };
}

async function locateWithGemini({ ai, model, video, image, question }) {
  const videoBase64 = (await readFile(video)).toString('base64');
  const imageBase64 = (await readFile(image)).toString('base64');
  const prompt = `You are locating a user-provided screenshot inside a video for a local video edit.

Inputs:
1. A screenshot image. It may contain user annotations, crop marks, compression artifacts, or UI overlays.
2. The full source video.

Task:
Find where the underlying screenshot content appears in the video. Use the screenshot as the visual anchor. Ignore annotations or UI overlays if present.

Important:
- Return the timestamp in seconds relative to the start of the provided video.
- If the screenshot appears across a continuous moment, return the best center timestamp and a small window around it.
- If there are multiple plausible places, say multiple_candidates and include the strongest window.
- If the match is weak, say uncertain instead of pretending.
- Ground your answer in concrete visual evidence: subject pose, object positions, background layout, camera angle, lighting, and motion state.
- Some videos reuse very similar visual layouts across time. Do not locate using static appearance alone.
- Compare time-specific details: motion phase, object positions, animation progress, camera movement, subject pose, lighting changes, and any visible timeline/player time if present.
- Do not choose the opening frame or 0s just because the broad scene matches. If repeated visuals make the exact moment ambiguous, return multiple_candidates or lower confidence.
- Use natural visual judgment. Do not overfit to accidental compression noise.
${question ? `\nUser note about the screenshot: ${question}` : ''}

Return strict JSON only:
{
  "verdict": "located" | "multiple_candidates" | "not_found" | "uncertain",
  "timestamp": number | null,
  "window": [number, number] | null,
  "confidence": 0.0-1.0,
  "evidence": ["short concrete visual evidence"],
  "concerns": ["short uncertainty or ambiguity notes"]
}`;

  const result = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
      { inlineData: { mimeType: 'video/mp4', data: videoBase64 } },
      { text: prompt },
    ] }],
  });

  const text = result.text || '';
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    parsed = { verdict: 'uncertain', timestamp: null, window: null, confidence: 0, evidence: [], concerns: ['JSON parse failed'], raw: text };
  }
  return {
    parsed,
    usage: result.usageMetadata ? {
      promptTokenCount: result.usageMetadata.promptTokenCount,
      candidatesTokenCount: result.usageMetadata.candidatesTokenCount,
      totalTokenCount: result.usageMetadata.totalTokenCount,
    } : null,
  };
}

async function main() {
  const opts = parseArgs();
  if (opts.help) {
    process.stdout.write(usage());
    return;
  }
  loadEnvFile(resolvePath(opts.envFile));
  if (!opts.skipAi && !process.env.GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is required unless --skip-ai is set.');
  }

  const casesPath = resolvePath(opts.cases);
  const cases = JSON.parse(readFileSync(casesPath, 'utf8'))
    .filter((testCase) => !opts.only || testCase.id === opts.only);
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'makaron-video-segment-edit-'));
  const ai = opts.skipAi ? null : new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  const results = [];
  const visualIndexes = new Map();

  try {
    for (const testCase of cases) {
      const video = resolvePath(opts.video || testCase.video);
      if (!existsSync(video)) {
        results.push({ id: testCase.id, error: `Video not found: ${video}` });
        continue;
      }
      const duration = await probeDuration(video);
      const caseDir = path.join(tempRoot, testCase.id);
      await mkdir(caseDir, { recursive: true });
      let image = testCase.screenshot ? resolvePath(testCase.screenshot) : '';
      if (!image && Number.isFinite(testCase.captureTimestamp)) {
        image = path.join(caseDir, 'anchor.jpg');
        await extractFrame(video, testCase.captureTimestamp, image);
      }
      if (!image || !existsSync(image)) {
        results.push({ id: testCase.id, error: `Screenshot not found: ${image || '(none)'}` });
        continue;
      }

      const locate = opts.skipAi
        ? { parsed: { verdict: 'located', timestamp: testCase.expectedTimestamp, window: null, confidence: 1, evidence: ['skip-ai expected timestamp'], concerns: [] }, usage: null }
        : await locateWithGemini({ ai, model: opts.model, video, image, question: testCase.question });
      const visualInterval = testCase.visualInterval ?? opts.visualInterval;
      const visualKey = `${video}::${visualInterval}`;
      let visualIndex = visualIndexes.get(visualKey);
      if (!visualIndex) {
        visualIndex = await prepareVisualIndex({
          video,
          duration,
          interval: visualInterval,
          dir: path.join(tempRoot, `visual-index-${visualIndexes.size}`),
        });
        visualIndexes.set(visualKey, visualIndex);
      }
      const visual = await visualSearch({ screenshot: image, visualIndex });
      const aiTimestamp = Number(locate.parsed.timestamp);
      const expected = Number(testCase.expectedTimestamp);
      const aiTimestampError = Number.isFinite(aiTimestamp) && Number.isFinite(expected)
        ? Math.abs(aiTimestamp - expected)
        : null;
      const visualTimestampError = Number.isFinite(visual.bestTimestamp) && Number.isFinite(expected)
        ? Math.abs(visual.bestTimestamp - expected)
        : null;
      const tolerance = testCase.toleranceSeconds ?? 1;
      const visualThreshold = testCase.visualThreshold ?? opts.visualThreshold;
      const visualAccepted = Number.isFinite(visual.bestScore) && visual.bestScore <= visualThreshold;
      const visualDistinctive = visualAccepted
        && Number.isFinite(visual.nearMatchSpan)
        && visual.nearMatchSpan <= Math.max(2, tolerance * 2);
      const aiVisualDisagreement = Number.isFinite(aiTimestamp) && Number.isFinite(visual.bestTimestamp)
        ? Math.abs(aiTimestamp - visual.bestTimestamp)
        : null;
      const useVisualFallback = visualDistinctive
        && (aiVisualDisagreement === null || aiVisualDisagreement > tolerance);
      const recommendedTimestamp = useVisualFallback ? visual.bestTimestamp : aiTimestamp;
      const timestampError = Number.isFinite(recommendedTimestamp) && Number.isFinite(expected)
        ? Math.abs(recommendedTimestamp - expected)
        : null;
      const segmentWindow = planSegmentWindow({
        timestamp: Number.isFinite(recommendedTimestamp) ? recommendedTimestamp : expected,
        modelWindow: testCase.modelWindowSeconds,
        modelMinSeconds: testCase.modelMinSeconds ?? 4,
        maxWindowSeconds: testCase.maxWindowSeconds ?? 5,
        duration,
        locatedWindow: useVisualFallback ? null : locate.parsed.window,
      });
      const pass = ['located', 'multiple_candidates'].includes(locate.parsed.verdict)
        && timestampError !== null
        && timestampError <= tolerance
        && !!segmentWindow?.containsTimestamp;
      results.push({
        id: testCase.id,
        video,
        image,
        expectedTimestamp: expected,
        aiTimestamp: Number.isFinite(aiTimestamp) ? aiTimestamp : null,
        aiTimestampError,
        visualSearch: visual,
        visualAccepted,
        visualDistinctive,
        aiVisualDisagreement,
        visualTimestampError,
        usedVisualFallback: useVisualFallback,
        recommendedTimestamp: Number.isFinite(recommendedTimestamp) ? recommendedTimestamp : null,
        timestampError,
        toleranceSeconds: tolerance,
        pass,
        segmentWindow,
        locate: locate.parsed,
        usage: locate.usage,
      });
    }
  } finally {
    if (!opts.keepTemp) await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }

  const summary = {
    cases: results.length,
    passed: results.filter((result) => result.pass).length,
    failed: results.filter((result) => !result.pass).length,
  };
  const report = { summary, results };
  const json = JSON.stringify(report, null, 2);
  if (opts.output) await writeFile(resolvePath(opts.output), `${json}\n`);
  process.stdout.write(`${json}\n`);
  if (summary.failed > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
