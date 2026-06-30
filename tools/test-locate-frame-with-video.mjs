#!/usr/bin/env node
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import { GoogleGenAI } from '@google/genai';

const exec = promisify(execFile);

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--video') opts.video = args[++i];
    else if (arg === '--image') opts.image = args[++i];
    else if (arg === '--timestamp') opts.timestamp = Number(args[++i]);
    else if (arg === '--question') opts.question = args[++i];
    else if (arg === '--env-file') opts.envFile = args[++i];
    else if (arg === '--keep-temp') opts.keepTemp = true;
  }
  return opts;
}

function stripJsonFence(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

async function buildSyntheticCase(dir) {
  const video = path.join(dir, 'locate-test.mp4');
  const image = path.join(dir, 'anchor.jpg');
  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=640x360:d=2:r=24',
    '-f', 'lavfi', '-i', 'color=c=green:s=640x360:d=2:r=24',
    '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:d=2:r=24',
    '-filter_complex',
    '[0:v]drawbox=x=250:y=120:w=140:h=90:color=white@0.9:t=fill[v0];[1:v]drawbox=x=60:y=80:w=180:h=140:color=yellow@0.9:t=fill[v1];[2:v]drawbox=x=420:y=160:w=120:h=120:color=cyan@0.9:t=fill[v2];[v0][v1][v2]concat=n=3:v=1:a=0[out]',
    '-map', '[out]', '-pix_fmt', 'yuv420p', video,
  ]);
  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', '2.5', '-i', video, '-frames:v', '1', image,
  ]);
  return { video, image, expected: 2.5 };
}

async function main() {
  const opts = parseArgs();
  loadEnvFile(opts.envFile || path.join(process.cwd(), '.env.local'));
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is required. Pass --env-file /path/to/.env.local or export it.');
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'makaron-locate-frame-'));
  try {
    const input = opts.video && opts.image
      ? { video: opts.video, image: opts.image, expected: opts.timestamp }
      : await buildSyntheticCase(dir);

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    const videoBase64 = (await readFile(input.video)).toString('base64');
    const imageBase64 = (await readFile(input.image)).toString('base64');
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
- Use natural visual judgment. Do not overfit to accidental compression noise.
${opts.question ? `\nUser note about the screenshot: ${opts.question}` : ''}

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
      model: 'gemini-3-flash-preview',
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
      parsed = { parseError: true, raw: text };
    }
    const output = {
      video: input.video,
      image: input.image,
      expectedTimestamp: input.expected ?? null,
      result: parsed,
      usage: result.usageMetadata ? {
        promptTokenCount: result.usageMetadata.promptTokenCount,
        candidatesTokenCount: result.usageMetadata.candidatesTokenCount,
        totalTokenCount: result.usageMetadata.totalTokenCount,
      } : null,
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (!parsed || parsed.parseError || !['located', 'multiple_candidates'].includes(parsed.verdict)) {
      process.exitCode = 2;
    }
  } finally {
    if (!opts.keepTemp) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
