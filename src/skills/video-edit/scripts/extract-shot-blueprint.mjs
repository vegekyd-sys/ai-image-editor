#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const round = (value, places = 3) => Number(value.toFixed(places));

function usage() {
  return 'Usage: node extract-shot-blueprint.mjs <input.mp4> --output <blueprint.json> [--ffmpeg PATH] [--ffprobe PATH]';
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const input = argv[0];
  const outputIndex = argv.indexOf('--output');
  if (!input || outputIndex < 0 || !argv[outputIndex + 1]) {
    throw new Error(usage());
  }
  const valueAfter = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  return {
    input: resolve(input),
    output: resolve(argv[outputIndex + 1]),
    ffmpeg: valueAfter('--ffmpeg', 'ffmpeg'),
    ffprobe: valueAfter('--ffprobe', 'ffprobe'),
  };
}

function run(binary, args, options = {}) {
  try {
    return execFileSync(binary, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || error?.message || String(error);
    throw new Error(`${binary} failed: ${stderr.trim()}`);
  }
}

function rational(value) {
  if (!value || typeof value !== 'string') return null;
  const [numerator, denominator] = value.split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index];
}

function parseSceneScores(metadataText) {
  const frames = [];
  let currentTime = null;
  for (const line of metadataText.split(/\r?\n/)) {
    const frame = line.match(/pts_time:([0-9.]+)/);
    if (frame) currentTime = Number(frame[1]);
    const score = line.match(/lavfi\.scene_score=([0-9.]+)/);
    if (score && Number.isFinite(currentTime)) {
      frames.push({ time_sec: currentTime, score: Number(score[1]) });
    }
  }
  return frames;
}

function sceneCandidates(frames, duration) {
  const positive = frames.map((frame) => frame.score).filter((score) => score > 0);
  const adaptiveThreshold = Math.max(0.001, percentile(positive, 0.985));
  const threshold = Math.min(0.02, adaptiveThreshold);
  const candidates = [];
  for (let index = 1; index < frames.length - 1; index += 1) {
    const frame = frames[index];
    if (frame.score < threshold) continue;
    if (frame.score < frames[index - 1].score || frame.score < frames[index + 1].score) continue;
    if (frame.time_sec < 0.75 || duration - frame.time_sec < 0.75) continue;
    candidates.push({
      method: 'adaptive_scene_score',
      time_sec: round(frame.time_sec),
      score: round(frame.score, 6),
    });
  }
  return { threshold: round(threshold, 6), candidates };
}

function parseBlackRanges(stderrText, duration) {
  const ranges = [];
  const pattern = /black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)/g;
  for (const match of stderrText.matchAll(pattern)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    const span = Number(match[3]);
    if (start <= 0.05 || duration - end <= 0.05 || span > 2.5) continue;
    ranges.push({
      method: 'blackdetect',
      time_sec: round((start + end) / 2),
      start_sec: round(start),
      end_sec: round(end),
      score: round(Math.min(1, span / 1.5), 6),
    });
  }
  return ranges;
}

function boundarySets(sceneEvidence, blackEvidence, duration) {
  const scenes = sceneEvidence.filter((item) => item.time_sec >= 0.1 && duration - item.time_sec >= 0.1);
  const consumedSceneIndices = new Set();
  const candidates = blackEvidence.map((black) => {
    const nearby = scenes.filter((scene, index) => {
      const withinSpan = scene.time_sec >= black.start_sec - 0.5 && scene.time_sec <= black.end_sec + 0.5;
      if (withinSpan) consumedSceneIndices.add(index);
      return withinSpan;
    });
    return {
      time_sec: black.time_sec,
      kind: 'fade_or_black',
      confidence: nearby.length ? 0.7 : 0.6,
      evidence: [black, ...nearby],
    };
  });

  scenes.forEach((scene, index) => {
    if (consumedSceneIndices.has(index)) return;
    const strongCut = scene.score >= 0.02;
    candidates.push({
      time_sec: scene.time_sec,
      kind: strongCut ? 'cut' : 'unknown',
      confidence: strongCut ? (scene.score >= 0.08 ? 0.75 : 0.65) : 0.45,
      evidence: [scene],
    });
  });

  const sorted = candidates.sort((left, right) => left.time_sec - right.time_sec);
  const deduped = [];
  for (const candidate of sorted) {
    const previous = deduped.at(-1);
    if (previous && candidate.time_sec - previous.time_sec < 0.1) {
      if (candidate.confidence > previous.confidence) deduped[deduped.length - 1] = candidate;
      continue;
    }
    deduped.push(candidate);
  }
  return {
    confirmed: deduped.filter((candidate) => candidate.confidence >= 0.6),
    unresolved: deduped.filter((candidate) => candidate.confidence < 0.6),
  };
}

function gcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function buildBlueprint(probe, sourceName, sceneResult, blackEvidence) {
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  if (!video) throw new Error('The source has no video stream.');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(probe.format?.duration || video.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The source duration is missing or invalid.');
  const width = Number(video.width);
  const height = Number(video.height);
  const divisor = gcd(width, height);
  const boundaryResult = boundarySets(sceneResult.candidates, blackEvidence, duration);
  const boundaries = boundaryResult.confirmed.map((boundary) => ({
    ...boundary,
    confidence: round(boundary.confidence, 2),
  }));
  const unresolvedCandidates = boundaryResult.unresolved.map((boundary) => ({
    ...boundary,
    confidence: round(boundary.confidence, 2),
  }));
  const times = [0, ...boundaries.map((boundary) => boundary.time_sec), round(duration)];
  const shots = times.slice(0, -1).map((start, index) => {
    const end = times[index + 1];
    return {
      id: `shot-${String(index + 1).padStart(3, '0')}`,
      order: index + 1,
      source_range: { start_sec: round(start), end_sec: round(end) },
      duration_sec: round(end - start),
      narrative_role: null,
      subject_action: null,
      composition: null,
      camera_motion: null,
      transition_in: null,
      transition_out: null,
      text_layers: [],
      audio: null,
      style: null,
      preserve: ['duration', 'order'],
      replace: ['subject', 'brand', 'copy'],
      confidence: index === 0 || index === times.length - 2 ? 0.55 : 0.5,
      needs_model_review: true,
    };
  });
  return {
    schema_version: '0.1.0',
    reference: {
      source_name: sourceName,
      duration_sec: round(duration),
      width,
      height,
      fps: round(rational(video.avg_frame_rate) || rational(video.r_frame_rate) || 0),
      video_codec: video.codec_name || null,
      audio: {
        present: Boolean(audio),
        codec: audio?.codec_name || null,
        sample_rate: audio?.sample_rate ? Number(audio.sample_rate) : null,
      },
    },
    analysis: {
      boundary_method: 'adaptive_scene_plus_black',
      asr_status: audio ? 'not_run' : 'not_applicable',
      beat_status: audio ? 'not_run' : 'not_applicable',
      model_review_status: 'required',
      scene_score_threshold: sceneResult.threshold,
      scene_candidate_count: sceneResult.candidates.length,
      black_candidate_count: blackEvidence.length,
      unresolved_boundary_candidates: unresolvedCandidates,
      warnings: [
        'Boundaries are adaptive candidates, not semantic ground truth.',
        'Smooth motion graphics and dark scenes require frame-level model review.',
      ],
    },
    global_dna: {
      aspect_ratio: `${width / divisor}:${height / divisor}`,
      shot_duration_curve_sec: shots.map((shot) => shot.duration_sec),
      cut_rate_per_min: round(boundaries.length / duration * 60, 2),
      style: null,
      audio_arc: null,
    },
    boundaries,
    shots,
    route: null,
    qa_targets: null,
  };
}

function validateBlueprint(blueprint) {
  const tolerance = 0.002;
  const { boundaries, shots, global_dna: globalDna, reference } = blueprint;
  if (shots.length !== boundaries.length + 1) throw new Error('Blueprint shot/boundary counts are inconsistent.');
  if (globalDna.shot_duration_curve_sec.length !== shots.length) throw new Error('Blueprint duration curve length is inconsistent.');
  for (const [index, shot] of shots.entries()) {
    const expectedStart = index === 0 ? 0 : shots[index - 1].source_range.end_sec;
    if (shot.order !== index + 1) throw new Error(`Blueprint shot order is invalid at ${shot.id}.`);
    if (Math.abs(shot.source_range.start_sec - expectedStart) > tolerance) {
      throw new Error(`Blueprint coverage is discontinuous at ${shot.id}.`);
    }
    if (shot.source_range.end_sec <= shot.source_range.start_sec) throw new Error(`Blueprint range is invalid at ${shot.id}.`);
    if (Math.abs(shot.duration_sec - (shot.source_range.end_sec - shot.source_range.start_sec)) > tolerance) {
      throw new Error(`Blueprint duration is inconsistent at ${shot.id}.`);
    }
    if (Math.abs(globalDna.shot_duration_curve_sec[index] - shot.duration_sec) > tolerance) {
      throw new Error(`Blueprint duration curve is inconsistent at ${shot.id}.`);
    }
    if (index < boundaries.length && Math.abs(boundaries[index].time_sec - shot.source_range.end_sec) > tolerance) {
      throw new Error(`Blueprint boundary is inconsistent after ${shot.id}.`);
    }
  }
  if (Math.abs(shots.at(-1).source_range.end_sec - reference.duration_sec) > tolerance) {
    throw new Error('Blueprint does not cover the full reference duration.');
  }
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const work = mkdtempSync(join(tmpdir(), 'makaron-shot-blueprint-'));
  try {
    const probe = JSON.parse(run(args.ffprobe, [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-of', 'json',
      args.input,
    ]));
    const duration = Number(probe.format?.duration || probe.streams?.find((stream) => stream.codec_type === 'video')?.duration);
    const metadataPath = join(work, 'scene-metadata.txt');
    run(args.ffmpeg, [
      '-hide_banner', '-nostdin', '-v', 'error', '-i', args.input,
      '-an', '-vf', `select=gte(scene\\,0),metadata=print:file=${metadataPath}`,
      '-f', 'null', '-',
    ]);
    const sceneResult = sceneCandidates(parseSceneScores(readFileSync(metadataPath, 'utf8')), duration);
    const blackResult = spawnSync(args.ffmpeg, [
      '-hide_banner', '-nostdin', '-v', 'info', '-i', args.input,
      '-an', '-vf', 'blackdetect=d=0.15:pic_th=0.99', '-f', 'null', '-',
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (blackResult.error) throw blackResult.error;
    if (blackResult.status !== 0) throw new Error(`ffmpeg blackdetect failed: ${(blackResult.stderr || '').trim()}`);
    const blackStderr = blackResult.stderr || '';
    const blueprint = buildBlueprint(probe, basename(args.input), sceneResult, parseBlackRanges(blackStderr, duration));
    validateBlueprint(blueprint);
    writeFileSync(args.output, `${JSON.stringify(blueprint, null, 2)}\n`);
    process.stdout.write(`${args.output}\n`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main(process.argv.slice(2));
