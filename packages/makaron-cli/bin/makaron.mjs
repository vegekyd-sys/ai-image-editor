#!/usr/bin/env node
/**
 * Makaron CLI — Talk to Makaron Agent from the terminal.
 *
 * Usage:
 *   npx makaron-cli login
 *   npx makaron-cli create --image photo.jpg
 *   npx makaron-cli chat --project <id> "make it look cinematic"
 *   npx makaron-cli chat --project <id> -b "message"       # background, returns runId
 *   npx makaron-cli responses get <runId> --wait            # poll until done
 *   npx makaron-cli list
 */

import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import { execFileSync } from 'child_process';

// ─── Config ──────────────────────────────────────────────────────────────────

const AUTH_FILE = path.join(process.env.HOME || '~', '.makaron', 'auth.json');
const DEFAULT_URL = 'https://www.makaron.app';
const BASE_URL = process.env.MAKARON_URL || DEFAULT_URL;
const APP_URL = process.env.MAKARON_APP_URL || DEFAULT_URL;

// Public anon key (safe to embed — only enables auth, not data access)
const SUPABASE_URL = 'https://sdyrtztrjgmmpnirswxt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_FJFN2YYaWaQjABUKLqxQcA_fhxPLFDY';

const MAX_VIDEO_UPLOAD_FILE_SIZE_MB = 50;
const MAX_VIDEO_UPLOAD_FILE_SIZE = MAX_VIDEO_UPLOAD_FILE_SIZE_MB * 1024 * 1024;
const MAX_VIDEO_UPLOAD_DURATION = 120;
const MAX_VIDEO_UPLOAD_DURATION_TOLERANCE = 1;
const MAX_VIDEO_PROVIDER_REFERENCE_DURATION = 15;
const MAX_VIDEO_PROVIDER_REFERENCE_DURATION_TOLERANCE = 0.5;
const MAX_VIDEO_FRAME_PIXELS = 2_086_876;
const SEEDANCE_MIN_VIDEO_FRAME_PIXELS = 409_600;
const SEEDANCE_MIN_VIDEO_SIDE = 300;
const SEEDANCE_MAX_VIDEO_SIDE = 6000;
const SEEDANCE_MIN_VIDEO_ASPECT = 0.4;
const SEEDANCE_MAX_VIDEO_ASPECT = 2.5;

function getCliVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds)) return String(seconds);
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1).replace(/\.0$/, '');
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function loadAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveAuth(data) {
  const dir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
}

function buildCookie(tokenJson) {
  const url = tokenJson._supabaseUrl || SUPABASE_URL;
  const ref = url.match(/\/\/([^.]+)\./)?.[1] || '';
  const encoded = encodeURIComponent(JSON.stringify(tokenJson));
  return `sb-${ref}-auth-token=${encoded}`;
}

async function login() {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q) => new Promise(r => rl.question(q, r));

  const email = await ask('Email: ');
  const password = await ask('Password: ');
  rl.close();

  const supabaseUrl = process.env.SUPABASE_URL || SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    console.error('Login failed:', await res.text());
    process.exit(1);
  }

  const tokenJson = await res.json();
  tokenJson._supabaseUrl = supabaseUrl;
  tokenJson._baseUrl = BASE_URL;
  saveAuth(tokenJson);
  console.error(`✅ Logged in as ${email}`);
  console.error(`   Token saved to ${AUTH_FILE}`);
}

function getAuthCookie() {
  const auth = loadAuth();
  if (!auth) {
    console.error('Not logged in. Run: npx makaron-cli login');
    process.exit(1);
  }
  return { cookie: buildCookie(auth), baseUrl: process.env.MAKARON_URL || auth._baseUrl || BASE_URL };
}

function getAuth() {
  const apiKey = process.env.MAKARON_API_KEY;
  if (apiKey) {
    return {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      baseUrl: process.env.MAKARON_URL || DEFAULT_URL,
    };
  }
  const auth = loadAuth();
  if (!auth) {
    console.error('No API key found. Set MAKARON_API_KEY or run:');
    console.error('  npx makaron-cli register --json   (agent self-registration)');
    console.error('  npx makaron-cli login             (human interactive login)');
    process.exit(1);
  }
  // Registered via `register --verify` (saved as _apiKey)
  if (auth._apiKey) {
    return {
      headers: { 'Authorization': `Bearer ${auth._apiKey}` },
      baseUrl: process.env.MAKARON_URL || auth._baseUrl || BASE_URL,
    };
  }
  return {
    headers: { 'Cookie': buildCookie(auth) },
    baseUrl: process.env.MAKARON_URL || auth._baseUrl || BASE_URL,
  };
}

function normalizeRunResponse(data) {
  const projectId = data.projectId || data.project_id;
  if (projectId) {
    data.projectId = projectId;
    data.projectUrl = `${APP_URL}/projects/${projectId}`;
  }
  return data;
}

function collectCompletionActions(data) {
  const items = [];
  const add = (action, source) => {
    if (!action?.label || !action?.prompt) return;
    const key = `${action.label}\n${action.prompt}`;
    if (items.some(i => i.key === key)) return;
    items.push({ key, label: action.label, prompt: action.prompt, description: action.description, source });
  };
  for (const out of data.output || []) {
    for (const action of out.completion_actions || out.completionActions || []) add(action, out.id || out.task_id);
  }
  for (const video of data.result?.videos || []) {
    for (const action of video.completion_actions || video.completionActions || []) add(action, video.taskId);
  }
  return items;
}

function printCompletionActions(data) {
  const projectId = data.projectId || data.project_id;
  const actions = collectCompletionActions(data);
  if (!projectId || actions.length === 0) return;
  process.stderr.write('\nNext steps:\n');
  for (const action of actions) {
    process.stderr.write(`• ${action.label}${action.description ? ` — ${action.description}` : ''}\n`);
    process.stderr.write(`  makaron chat --project ${projectId} ${JSON.stringify(action.prompt)}\n`);
  }
}

function printChatHelp() {
  console.log(`Makaron chat — create and edit with Makaron Agent

Usage:
  makaron chat --project <id|auto> [options] "your message"

Options:
  --project <id|auto>       Project to work in. Use "auto" to create one.
  --image <file|url>        Attach a reference image or screenshot. Repeatable.
  --video <file|url>        Attach a video to the project timeline. Repeatable.
  --skill <name>            Optional: explicitly guide Agent with a workflow.
  --model <name>            Preferred image/model route.
  --video-model <name>      Preferred video model.
  --background, -b          Submit and print a runId.
  --json                    Output structured JSON.
  --stream                  Legacy live SSE stream.
  --help, -h                Show this help.

What you can ask:
  Image edit
    makaron chat --project <id> --image photo.jpg "remove the person in the background"

  Image generation
    makaron chat --project auto "generate a cinematic poster of a rainy Tokyo alley"

  Video from image or timeline
    makaron chat --project <id> "make this into a 5 second cinematic video"

  Screenshot-guided video repair
    makaron chat --project <id> --image screenshot.png "@4 this frame should be Paris; only fix this moment"

  Video cuts and assembly
    makaron chat --project <id> --video clip.mp4 "cut out the dead air and keep the best 20 seconds"

  Music
    makaron chat --project <id> "add calm piano background music"

  Motion design
    makaron chat --project <id> "make an animated Instagram story with this image"

After async generation:
  The CLI waits for video/music tasks. If the result has a natural next step, it prints:
    Next steps:
      makaron chat --project <id> "..."
`);
}

// ─── SSE Consumer ────────────────────────────────────────────────────────────

async function abortRun(baseUrl, headers, runId) {
  try {
    await fetch(`${baseUrl}/api/agent/abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ runId }),
    });
  } catch { /* best effort */ }
}

async function streamAgent(baseUrl, headers, projectId, prompt) {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      projectId,
      prompt,
      headless: true,
    }),
    signal: controller.signal,
  });

  if (!res.ok) {
    console.error(`Error ${res.status}:`, await res.text());
    process.exit(1);
  }

  const runId = res.headers.get('X-Agent-Run-Id');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Ctrl+C → abort agent on server, then exit
  const sigintHandler = async () => {
    process.stderr.write('\n⏹️  Aborting...\n');
    controller.abort();
    if (runId) await abortRun(baseUrl, headers, runId);
    process.exit(0);
  };
  process.on('SIGINT', sigintHandler);

  const results = { images: [], designs: [], animationTasks: [], musicTasks: [], text: '' };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let event;
      try { event = JSON.parse(line.slice(6)); } catch { continue; }

      switch (event.type) {
        case 'content':
          process.stdout.write(event.text);
          results.text += event.text;
          break;

        case 'status':
          process.stderr.write(`\r⏳ ${event.text}`);
          break;

        case 'tool_call':
          process.stderr.write(`\n🔧 ${event.tool}`);
          if (event.input?.editPrompt) process.stderr.write(`\n   editPrompt: ${event.input.editPrompt}`);
          if (event.input?.model) process.stderr.write(`\n   model: ${event.input.model}`);
          if (event.input?.skill) process.stderr.write(`\n   skill: ${event.input.skill}`);
          if (event.input?.description) process.stderr.write(`: ${event.input.description.substring(0, 80)}`);
          process.stderr.write('\n');
          break;

        case 'image':
          results.images.push({ snapshotId: event.snapshotId, imageUrl: event.imageUrl });
          process.stderr.write(`\n🖼️  Image: ${event.imageUrl || '(uploading...)'}\n`);
          break;

        case 'render':
          if (event.published) {
            const desc = event.animation
              ? `${event.animation.durationInSeconds}s video (${event.width}x${event.height})`
              : `still design (${event.width}x${event.height})`;
            results.designs.push({ snapshotId: event.snapshotId, desc });
            process.stderr.write(`\n🎨 Design published: ${desc}\n`);
          }
          break;

        case 'animation_task':
          results.animationTasks.push({ taskId: event.taskId, prompt: event.prompt });
          process.stderr.write(`\n🎬 Video submitted: ${event.taskId}\n`);
          break;

        case 'video_snapshot':
          results.animationTasks.push({ taskId: event.taskId, snapshotId: event.snapshotId });
          process.stderr.write(`\n🎬 Video submitted: ${event.taskId} (snapshot: ${event.snapshotId})\n`);
          break;

        case 'music_task':
          results.musicTasks.push({ taskId: event.taskId });
          process.stderr.write(`\n🎵 Music submitted: ${event.taskId}\n`);
          break;

        case 'error':
          process.stderr.write(`\n❌ Error: ${event.message}\n`);
          break;

        case 'done':
          break;
      }
    }
  }

  process.removeListener('SIGINT', sigintHandler);
  if (results.text) process.stdout.write('\n');
  return { runId, results };
}

// ─── Run + Poll (non-blocking) ──────────────────────────────────────────────

async function submitRun(baseUrl, headers, projectId, prompt, opts = {}) {
  const body = { projectId, prompt };
  if (opts.preferredModel) body.preferredModel = opts.preferredModel;
  if (opts.videoModel) body.videoModel = opts.videoModel;
  if (opts.currentSnapshotIndex != null) body.currentSnapshotIndex = opts.currentSnapshotIndex;
  if (opts.isNsfw) body.isNsfw = opts.isNsfw;

  const res = await fetch(`${baseUrl}/api/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Error ${res.status}: ${text}`);
    process.exit(1);
  }

  return await res.json();
}

async function pollRun(baseUrl, headers, runId, opts = {}) {
  const { json = false, waitForArtifacts = false, background = false } = opts;
  if (background) return;

  let lastSeq = -1;
  let printedText = '';
  const start = Date.now();

  while (true) {
    await new Promise(r => setTimeout(r, 3000));
    const elapsed = Math.round((Date.now() - start) / 1000);

    const params = new URLSearchParams({ events: 'true' });
    if (lastSeq >= 0) params.set('after', String(lastSeq));
    if (waitForArtifacts) params.set('wait_for_artifacts', 'true');

    let data;
    try {
      const res = await fetch(`${baseUrl}/api/agent/run/${runId}?${params}`, { headers });
      if (!res.ok) {
        if (elapsed > 800) { process.stderr.write(`\n❌ Timeout after ${elapsed}s\n`); process.exit(1); }
        continue;
      }
      data = await res.json();
    } catch {
      continue;
    }

    // Process incremental events
    if (data.events?.length) {
      for (const ev of data.events) {
        if (ev.seq > lastSeq) lastSeq = ev.seq;
        if (json) continue; // skip printing in json mode
        switch (ev.type) {
          case 'content': {
            const newText = ev.data?.text || '';
            process.stdout.write(newText);
            printedText += newText;
            break;
          }
          case 'status':
            process.stderr.write(`\r⏳ ${ev.data?.text || ''}`);
            break;
          case 'tool_call':
            process.stderr.write(`\n🔧 ${ev.data?.tool || ''}`);
            if (ev.data?.input?.editPrompt) process.stderr.write(`\n   editPrompt: ${ev.data.input.editPrompt}`);
            if (ev.data?.input?.model) process.stderr.write(`\n   model: ${ev.data.input.model}`);
            if (ev.data?.input?.description) process.stderr.write(`: ${ev.data.input.description.substring(0, 80)}`);
            process.stderr.write('\n');
            break;
          case 'image':
            process.stderr.write(`\n🖼️  Image: ${ev.data?.imageUrl || '(uploading...)'}\n`);
            break;
          case 'render':
            if (ev.data?.published) {
              const desc = ev.data.animation
                ? `${ev.data.animation.durationInSeconds}s video (${ev.data.width}x${ev.data.height})`
                : `still design (${ev.data.width}x${ev.data.height})`;
              process.stderr.write(`\n🎨 Design published: ${desc}\n`);
            }
            break;
          case 'animation_task':
            process.stderr.write(`\n🎬 Video submitted: ${ev.data?.taskId}\n`);
            break;
          case 'video_snapshot':
            process.stderr.write(`\n🎬 Video submitted: ${ev.data?.taskId} (snapshot: ${ev.data?.snapshotId})\n`);
            break;
          case 'music_task':
            process.stderr.write(`\n🎵 Music submitted: ${ev.data?.taskId}\n`);
            break;
          case 'error':
            process.stderr.write(`\n❌ Error: ${ev.data?.message}\n`);
            break;
        }
      }
    } else if (!json) {
      process.stderr.write(`\r⏳ Working... ${elapsed}s (${data.eventCount || 0} events)`);
    }

    // Check terminal status
    if (data.status === 'completed' || data.status === 'failed' || data.status === 'aborted') {
      if (printedText && !json) process.stdout.write('\n');

      if (json) {
        // Structured JSON output — add projectUrl
        console.log(JSON.stringify(normalizeRunResponse(data), null, 2));
      } else {
        process.stderr.write('\n━━━ Results ━━━\n');
        if (data.result) {
          for (const img of data.result.images || []) process.stderr.write(`🖼️  Image: ${img.imageUrl}\n`);
          for (const d of data.result.designs || []) process.stderr.write(`🎨  Design (${d.width}x${d.height})\n`);
          for (const v of data.result.videos || []) {
            if (v.videoUrl) process.stderr.write(`🎬  Video: ${v.videoUrl}\n`);
            else if (v.status === 'failed') process.stderr.write(`🎬  Video ${v.taskId}: failed${v.error ? ` — ${v.error}` : ''}\n`);
            else process.stderr.write(`🎬  Video ${v.taskId}: ${v.status || 'submitted'}\n`);
          }
          printCompletionActions(data);
          for (const m of data.result.music || []) {
            if (m.audioUrl) process.stderr.write(`🎵  Music: ${m.audioUrl}\n`);
            else process.stderr.write(`🎵  Music ${m.taskId}: ${m.status || 'submitted'}\n`);
          }
          if (data.result.error) process.stderr.write(`❌  ${data.result.error}\n`);
        }
        process.stderr.write(`🔗  ${APP_URL}/projects/${data.projectId}\n`);
      }

      if (data.status === 'failed') process.exit(1);
      return data;
    }
  }
}

// ─── Pick Helper ────────────────────────────────────────────────────────────

function applyPick(data, field) {
  switch (field) {
    case 'first_image_url': return data.output?.find(o => o.type === 'image')?.url || null;
    case 'image_urls': return (data.output || []).filter(o => o.type === 'image' && o.url).map(o => o.url);
    case 'first_video_url': return data.output?.find(o => o.type === 'video' && o.url)?.url || null;
    case 'video_urls': return (data.output || []).filter(o => o.type === 'video' && o.url).map(o => o.url);
    case 'first_design_url': return data.output?.find(o => o.type === 'design')?.url || null;
    case 'design_urls': return (data.output || []).filter(o => o.type === 'design' && o.url).map(o => o.url);
    case 'first_music_url': return data.output?.find(o => o.type === 'music' && o.url)?.url || null;
    case 'music_urls': return (data.output || []).filter(o => o.type === 'music' && o.url).map(o => o.url);
    case 'next_steps': return collectCompletionActions(data).map(action => ({
      label: action.label,
      prompt: action.prompt,
      description: action.description,
      source: action.source,
    }));
    case 'project_url': return data.project_url || data.projectUrl || null;
    case 'output': return data.output || [];
    case 'text': return data.output?.find(o => o.type === 'text')?.content || null;
    case 'status': return data.status;
    default: return data[field] !== undefined ? data[field] : null;
  }
}

// ─── Watch (incremental event stream) ───────────────────────────────────────

async function watchRun(baseUrl, headers, runId, opts = {}) {
  const { interval = 5000, jsonl = true } = opts;
  let lastOutput = [];
  const start = Date.now();

  while (true) {
    const elapsed = Math.round((Date.now() - start) / 1000);
    let data;
    try {
      const res = await fetch(`${baseUrl}/api/agent/run/${runId}`, { headers });
      if (!res.ok) {
        if (elapsed > 800) { process.stderr.write(`Timeout after ${elapsed}s\n`); process.exit(2); }
        await new Promise(r => setTimeout(r, interval));
        continue;
      }
      data = await res.json();
    } catch {
      await new Promise(r => setTimeout(r, interval));
      continue;
    }

    const currentOutput = data.output || [];

    // Diff: find new or updated items
    for (const item of currentOutput) {
      const prev = lastOutput.find(o => o.id === item.id);
      if (!prev) {
        // New item
        if (jsonl) console.log(JSON.stringify({ event: 'output.added', item }));
        else process.stderr.write(`+ [${item.type}] ${item.url || item.content?.slice(0, 60) || item.status}\n`);
      } else if (JSON.stringify(prev) !== JSON.stringify(item)) {
        // Updated item (e.g. video status changed)
        if (jsonl) console.log(JSON.stringify({ event: 'output.updated', item }));
        else process.stderr.write(`~ [${item.type}] ${item.status} ${item.url || item.error || ''}\n`);
      }
    }

    lastOutput = currentOutput;

    // Check terminal status
    if (!data.incomplete && (data.status === 'completed' || data.status === 'failed' || data.status === 'aborted')) {
      if (jsonl) console.log(JSON.stringify({ event: 'done', status: data.status }));
      if (data.status === 'failed' || data.status === 'aborted') process.exit(1);
      process.exit(0);
    }

    const waitMs = data.next_poll_after_ms || interval;
    await new Promise(r => setTimeout(r, waitMs));
  }
}

// ─── Async Task Polling ──────────────────────────────────────────────────────

async function pollVideo(baseUrl, headers, taskId, snapshotId) {
  const label = snapshotId ? (taskId ? `${taskId} (snapshot)` : snapshotId) : taskId;
  process.stderr.write(`🎬 Waiting for video ${label}...\n`);
  const start = Date.now();
  // v2: poll /api/video-snapshot/[snapshotId]; v1: poll /api/animate/[taskId]
  const endpoint = snapshotId
    ? `${baseUrl}/api/video-snapshot/${snapshotId}`
    : `${baseUrl}/api/animate/${taskId}`;
  while (true) {
    await new Promise(r => setTimeout(r, 10_000));
    const elapsed = Math.round((Date.now() - start) / 1000);
    try {
      const res = await fetch(endpoint, { headers });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.videoUrl) { process.stderr.write(`\r🎬 Video done (${elapsed}s): ${data.videoUrl}\n`); return data.videoUrl; }
      if (data.status === 'failed' || data.status === 'abandoned') { process.stderr.write(`\r🎬 Video ${data.status} (${elapsed}s)${data.error ? `: ${data.error}` : ''}\n`); return null; }
      process.stderr.write(`\r🎬 Video rendering... ${elapsed}s`);
    } catch { /* retry */ }
    if (elapsed > 600) { process.stderr.write(`\r🎬 Video timeout (${elapsed}s)\n`); return null; }
  }
}

async function pollMusic(baseUrl, headers, taskId) {
  process.stderr.write(`🎵 Waiting for music ${taskId}...\n`);
  const start = Date.now();
  while (true) {
    await new Promise(r => setTimeout(r, 5_000));
    const elapsed = Math.round((Date.now() - start) / 1000);
    try {
      const res = await fetch(`${baseUrl}/api/music/${taskId}`, { headers });
      if (!res.ok) continue;
      const data = await res.json();
      const trackUrl = data.audioUrl || data.tracks?.[0]?.audioUrl;
      const streamUrl = data.streamAudioUrl || data.tracks?.[0]?.streamAudioUrl;
      if (data.status === 'completed' || trackUrl) {
        const tracks = data.tracks || [];
        if (tracks.length > 1) {
          process.stderr.write(`\r🎵 Music done (${elapsed}s): ${tracks.length} tracks\n`);
          tracks.forEach((t, i) => process.stderr.write(`   ${i + 1}. ${t.title} (${Math.round(t.duration)}s) — ${t.audioUrl}\n`));
        } else {
          process.stderr.write(`\r🎵 Music done (${elapsed}s): ${trackUrl}\n`);
        }
        return trackUrl;
      }
      if (streamUrl && elapsed > 20) process.stderr.write(`\r🎵 Music streaming: ${streamUrl}\n`);
      if (data.status === 'failed') { process.stderr.write(`\r🎵 Music failed (${elapsed}s)\n`); return null; }
      process.stderr.write(`\r🎵 Music generating... ${elapsed}s`);
    } catch { /* retry */ }
    if (elapsed > 300) { process.stderr.write(`\r🎵 Music timeout (${elapsed}s)\n`); return null; }
  }
}

// ─── Create Project ──────────────────────────────────────────────────────────

async function createProject(baseUrl, headers, opts) {
  const body = {};
  if (opts.imageUrls?.length) {
    body.imageUrls = opts.imageUrls;
  } else if (opts.images?.length) {
    body.imageBase64s = opts.images.map(f => readImageAsDataUrl(f));
  } else if (opts.imageUrl) {
    body.imageUrl = opts.imageUrl;
  } else if (opts.image) {
    body.imageBase64 = readImageAsDataUrl(opts.image);
  }
  if (opts.title) body.title = opts.title;

  const res = await fetch(`${baseUrl}/api/projects/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  if (!res.ok) { console.error('Create failed:', await res.text()); process.exit(1); }

  const data = await res.json();
  console.log(`✅ Project created`);
  console.log(`   ID: ${data.projectId}`);
  if (data.snapshots?.length) {
    console.log(`   Images: ${data.snapshots.length}`);
    data.snapshots.forEach((s, i) => console.log(`   [${i + 1}] ${s.imageUrl}`));
  }
  console.log(`   URL: ${data.projectUrl}`);
  return data;
}

// ─── List Projects ───────────────────────────────────────────────────────────

async function listProjects(baseUrl, headers) {
  const res = await fetch(`${baseUrl}/api/projects/list`, { headers });
  if (!res.ok) { console.error('List failed:', await res.text()); process.exit(1); }
  const { projects } = await res.json();
  if (!projects.length) { console.log('No projects yet. Create one with: makaron create --image <file>'); return; }
  console.log(`📁 ${projects.length} projects\n`);
  for (const p of projects) {
    const age = timeSince(new Date(p.updatedAt));
    console.log(`  ${p.id}  ${p.title.padEnd(30)} ${String(p.snapshotCount).padStart(2)} snaps  ${age}`);
  }
  console.log('');
}

async function listProjectMedia(baseUrl, headers, projectId, opts = {}) {
  const res = await fetch(`${baseUrl}/api/projects/${projectId}/media`, { headers });
  if (!res.ok) { console.error('Project media failed:', await res.text()); process.exit(1); }
  const data = await res.json();
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return data;
  }

  console.log(`🎞️  ${data.title || 'Untitled'}`);
  console.log(`   Project: ${data.projectUrl || `${APP_URL}/projects/${projectId}`}`);
  const media = data.media || [];
  if (!media.length) {
    console.log('   No timeline media yet.');
    return data;
  }
  for (const item of media) {
    const ref = item.ref || `<<<media_${item.index}>>>`;
    const status = item.status && item.status !== 'completed' ? ` ${item.status}` : '';
    const duration = typeof item.duration === 'number' ? ` ${item.duration}s` : '';
    const dimensions = item.width && item.height ? ` ${item.width}x${item.height}` : '';
    const description = item.description ? ` — ${item.description}` : '';
    const url = item.url ? `\n      ${item.url}` : '';
    console.log(`  ${String(item.index).padStart(2)}. ${ref} [${item.type}${status}${duration}${dimensions}]${description}${url}`);
  }
  return data;
}

function timeSince(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ─── MCP Tool Caller ─────────────────────────────────────────────────────────

async function callMcpTool(baseUrl, headers, toolName, args) {
  const res = await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: args } }),
  });
  if (!res.ok) { console.error(`MCP error ${res.status}:`, await res.text()); process.exit(1); }
  const data = await res.json();
  if (data.error) { console.error(`MCP error:`, data.error.message); process.exit(1); }
  return data.result;
}

// ─── Image Validation ────────────────────────────────────────────────────────

function detectMime(buf) {
  if (buf[0]===0xFF && buf[1]===0xD8) return 'image/jpeg';
  if (buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47) return 'image/png';
  if (buf[0]===0x52 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x46 && buf[8]===0x57 && buf[9]===0x45 && buf[10]===0x42 && buf[11]===0x50) return 'image/webp';
  if (buf[0]===0x47 && buf[1]===0x49 && buf[2]===0x46) return 'image/gif';
  if (buf.length >= 8 && buf[4]===0x66 && buf[5]===0x74 && buf[6]===0x79 && buf[7]===0x70) return 'image/heic';
  return null;
}

function validateImage(filePath) {
  if (!fs.existsSync(filePath)) return { error: `File not found: ${filePath}` };
  const stat = fs.statSync(filePath);
  if (stat.size === 0) return { error: `File is empty: ${filePath}` };
  if (stat.size > 10 * 1024 * 1024) return { error: `File too large: ${(stat.size/1024/1024).toFixed(1)}MB (max 10MB). Resize before uploading.` };
  const header = Buffer.alloc(12);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, header, 0, 12, 0);
  fs.closeSync(fd);
  const mime = detectMime(header);
  if (!mime) return { error: `Unsupported format: ${path.extname(filePath)}. Supported: JPEG, PNG, WebP` };
  if (mime === 'image/heic') return { error: `HEIC format not supported via CLI. Convert first:\n   sips -s format jpeg "${filePath}" --out output.jpg` };
  if (mime === 'image/gif') return { error: `GIF format not supported. Convert to JPEG or PNG first.` };
  return { ok: true, mime };
}

function readImageAsDataUrl(filePath) {
  const v = validateImage(filePath);
  if (!v.ok) { console.error(`❌ Cannot upload: ${path.basename(filePath)}\n   ${v.error}`); process.exit(1); }
  const buf = fs.readFileSync(filePath);
  return `data:${v.mime};base64,${buf.toString('base64')}`;
}

/**
 * Upload a local file via signed URL (works for both images and videos).
 * 1. POST /api/storage/upload-url → get signed URL + public URL
 * 2. PUT file directly to Supabase Storage (no Vercel body limit)
 * Returns public URL on success, null on failure.
 */
async function uploadFileViaSignedUrl(baseUrl, headers, projectId, filePath, contentType) {
  const filename = path.basename(filePath);
  // Step 1: get signed upload URL
  const urlRes = await fetch(`${baseUrl}/api/storage/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ projectId, filename, contentType }),
  });
  if (!urlRes.ok) {
    process.stderr.write(`⚠️ Failed to get upload URL: ${await urlRes.text()}\n`);
    return null;
  }
  const { uploadUrl, token, publicUrl } = await urlRes.json();

  // Step 2: PUT file directly to Supabase Storage
  const buf = fs.readFileSync(filePath);
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Authorization': `Bearer ${token}`,
    },
    body: buf,
  });
  if (!putRes.ok) {
    process.stderr.write(`⚠️ Failed to upload file: ${await putRes.text()}\n`);
    return null;
  }
  return publicUrl;
}

function imageToArg(imgPath) {
  if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) return imgPath;
  return readImageAsDataUrl(imgPath);
}

function isHttpUrl(value) {
  return value?.startsWith('http://') || value?.startsWith('https://');
}

function probeVideoWithFfprobe(videoPath) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      videoPath,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const data = JSON.parse(out);
    const stream = data.streams?.[0] || {};
    const duration = Number(data.format?.duration);
    const width = Number(stream.width);
    const height = Number(stream.height);
    if (Number.isFinite(duration) && width > 0 && height > 0) {
      return { duration, width, height };
    }
  } catch { /* ffprobe unavailable or file unsupported */ }
  return null;
}

function probeVideoWithFfmpeg(videoPath) {
  try {
    const out = execFileSync('ffmpeg', ['-i', videoPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseFfmpegProbe(out);
  } catch (e) {
    const text = `${e.stdout || ''}\n${e.stderr || ''}`;
    return parseFfmpegProbe(text);
  }
}

function parseFfmpegProbe(text) {
  const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const sizeMatch = text.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  if (!durationMatch || !sizeMatch) return null;
  const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  const width = Number(sizeMatch[1]);
  const height = Number(sizeMatch[2]);
  if (!Number.isFinite(duration) || width <= 0 || height <= 0) return null;
  return { duration, width, height };
}

function probeLocalVideo(videoPath) {
  return probeVideoWithFfprobe(videoPath) || probeVideoWithFfmpeg(videoPath);
}

function validateVideoFile(videoPath, options = {}) {
  const maxDuration = options.maxDuration ?? MAX_VIDEO_UPLOAD_DURATION;
  const durationTolerance = options.durationTolerance ?? MAX_VIDEO_UPLOAD_DURATION_TOLERANCE;
  const minFramePixels = options.minFramePixels ?? 0;
  const minSide = options.minSide ?? 0;
  const maxSide = options.maxSide ?? Infinity;
  const minAspect = options.minAspect ?? 0;
  const maxAspect = options.maxAspect ?? Infinity;
  if (!fs.existsSync(videoPath)) {
    return { ok: false, error: `Video file not found: ${videoPath}` };
  }
  const stat = fs.statSync(videoPath);
  if (stat.size > MAX_VIDEO_UPLOAD_FILE_SIZE) {
    return { ok: false, error: `Video too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB (max ${MAX_VIDEO_UPLOAD_FILE_SIZE_MB}MB). The CLI uploads directly to Storage; use the frontend to transcode larger videos first.` };
  }
  const ext = path.extname(videoPath).slice(1).toLowerCase();
  if (!['mp4', 'mov', 'webm'].includes(ext)) {
    return { ok: false, error: `Unsupported video format: .${ext}. Use MP4, MOV, or WebM.` };
  }
  const meta = probeLocalVideo(videoPath);
  if (!meta) {
    return { ok: false, error: 'Cannot read video duration/resolution. Install ffmpeg/ffprobe or use the normal frontend upload flow.' };
  }
  if (meta.duration > maxDuration + durationTolerance) {
    return { ok: false, error: `Video too long: ${formatSeconds(meta.duration)}s (max ${maxDuration}s, with ${durationTolerance}s metadata tolerance)` };
  }
  if (meta.width * meta.height > MAX_VIDEO_FRAME_PIXELS) {
    return { ok: false, error: `Video resolution too high: ${meta.width}x${meta.height} (${meta.width * meta.height} px). Max is <=1080p (${MAX_VIDEO_FRAME_PIXELS} px). Re-upload through the frontend to transcode, or export a smaller video.` };
  }
  const framePixels = meta.width * meta.height;
  const aspect = meta.width / meta.height;
  if (
    framePixels < minFramePixels ||
    meta.width < minSide ||
    meta.height < minSide ||
    meta.width > maxSide ||
    meta.height > maxSide ||
    aspect < minAspect ||
    aspect > maxAspect
  ) {
    return { ok: false, error: `Video size does not meet provider limits: ${meta.width}x${meta.height} (${framePixels} px, aspect ${aspect.toFixed(2)}). Required: frame pixels >=${minFramePixels}, sides ${minSide}-${Number.isFinite(maxSide) ? maxSide : '∞'}px, aspect ${minAspect}-${Number.isFinite(maxAspect) ? maxAspect : '∞'}. Resize/pad with FFmpeg before submitting.` };
  }
  const mime = ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'video/mp4';
  return { ok: true, mime, meta };
}

function validateVideoFileForAnalysis(videoPath) {
  if (!fs.existsSync(videoPath)) {
    return { ok: false, error: `Video file not found: ${videoPath}` };
  }
  const stat = fs.statSync(videoPath);
  if (stat.size === 0) {
    return { ok: false, error: `Video file is empty: ${videoPath}` };
  }
  if (stat.size > MAX_VIDEO_UPLOAD_FILE_SIZE) {
    return { ok: false, error: `Video too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB (max ${MAX_VIDEO_UPLOAD_FILE_SIZE_MB}MB). The CLI uploads directly to Storage; use the frontend to transcode larger videos first.` };
  }
  const ext = path.extname(videoPath).slice(1).toLowerCase();
  if (!['mp4', 'mov', 'webm'].includes(ext)) {
    return { ok: false, error: `Unsupported video format: .${ext}. Use MP4, MOV, or WebM.` };
  }
  const mime = ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'video/mp4';
  return { ok: true, mime };
}

function saveMcpImage(result, outputPath) {
  const content = result?.content || [];
  const textBlock = content.find(c => c.type === 'text');
  const imageBlock = content.find(c => c.type === 'image');
  if (textBlock) process.stderr.write(`${textBlock.text}\n`);
  if (imageBlock) {
    const out = outputPath || `makaron-output-${Date.now()}.jpg`;
    fs.writeFileSync(out, Buffer.from(imageBlock.data, 'base64'));
    console.log(out);
    return out;
  }
  if (textBlock) console.log(textBlock.text);
  return null;
}

async function analyzeVideoCli(baseUrl, headers, rawVideo, questionParts) {
  if (!rawVideo) {
    console.error('Usage: makaron analyze --video <file|url> ["question"]');
    process.exit(1);
  }
  let videoUrl = isHttpUrl(rawVideo) ? rawVideo : null;
  if (videoUrl) {
    process.stderr.write('📹 Using public video URL for analysis; provider limits apply.\n');
  } else {
    const valid = validateVideoFileForAnalysis(rawVideo);
    if (!valid.ok) { console.error(`❌ ${valid.error}`); process.exit(1); }
    process.stderr.write(`📹 Uploading ${path.basename(rawVideo)} (${(fs.statSync(rawVideo).size/1024/1024).toFixed(1)}MB)...\n`);
    videoUrl = await uploadFileViaSignedUrl(baseUrl, headers, undefined, rawVideo, valid.mime);
    if (!videoUrl) process.exit(1);
    process.stderr.write(`📹 Uploaded: ${path.basename(rawVideo)}\n`);
  }
  process.stderr.write('🔎 Analyzing video...\n');
  const question = questionParts.join(' ').trim() || undefined;
  const result = await callMcpTool(baseUrl, headers, 'makaron_analyze_video', { videoUrl, question });
  const text = result?.content?.find(c => c.type === 'text')?.text;
  if (text) console.log(text);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

if (command === '--version' || command === '-v' || command === 'version') {
  console.log(getCliVersion());
} else if (command === 'login') {
  await login();
} else if (command === 'create') {
  const { headers, baseUrl } = getAuth();
  const opts = { images: [], imageUrls: [] };
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--image' && args[i + 1]) opts.images.push(args[++i]);
    else if (args[i] === '--image-url' && args[i + 1]) opts.imageUrls.push(args[++i]);
    else if (args[i] === '--title' && args[i + 1]) opts.title = args[++i];
  }
  if (opts.images.length === 1) { opts.image = opts.images[0]; opts.images = []; }
  if (opts.imageUrls.length === 1) { opts.imageUrl = opts.imageUrls[0]; opts.imageUrls = []; }
  if (!opts.image && !opts.imageUrl && !opts.images.length && !opts.imageUrls.length && !opts.title) {
    console.error('Usage: makaron create --image <file> [--image <file2>] or --title "name"');
    process.exit(1);
  }
  await createProject(baseUrl, headers, opts);
} else if (command === 'chat') {
  if (args.includes('--help') || args.includes('-h')) {
    printChatHelp();
    process.exit(0);
  }
  let projectId = null;
  const chatImages = [];
  const chatVideos = [];
  const promptParts = [];
  let useStream = false;
  let background = false;
  let jsonOutput = false;
  let activeSkill = undefined;
  let videoModel = undefined;
  let preferredModel = undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) projectId = args[++i];
    else if (args[i] === '--image' && args[i + 1]) chatImages.push(args[++i]);
    else if (args[i] === '--video' && args[i + 1]) chatVideos.push(args[++i]);
    else if (args[i] === '--skill' && args[i + 1]) activeSkill = args[++i];
    else if (args[i] === '--stream') useStream = true;
    else if (args[i] === '--background' || args[i] === '-b') background = true;
    else if (args[i] === '--json') jsonOutput = true;
    else if (args[i] === '--video-model' && args[i + 1]) videoModel = args[++i];
    else if (args[i] === '--model' && args[i + 1]) preferredModel = args[++i];
    else promptParts.push(args[i]);
  }
  const prompt = promptParts.join(' ');
  if (!prompt) {
    console.error('Usage: makaron chat --project <id|auto> [options] "your message"');
    console.error('Run: makaron chat --help');
    process.exit(1);
  }
  const { headers, baseUrl } = getAuth();
  // Split images into URLs vs local files
  const imageUrlList = chatImages.filter(p => p.startsWith('http://') || p.startsWith('https://'));
  const imageFileList = chatImages.filter(p => !p.startsWith('http://') && !p.startsWith('https://'));
  const prevalidatedVideoUrlList = chatVideos.filter(p => p.startsWith('http://') || p.startsWith('https://'));
  const prevalidatedVideoFileList = chatVideos.filter(p => !p.startsWith('http://') && !p.startsWith('https://'));
  const prevalidatedVideoMetas = new Map();
  for (const videoPath of prevalidatedVideoFileList) {
    const valid = validateVideoFile(videoPath);
    if (!valid.ok) {
      process.stderr.write(`❌ ${valid.error}\n`);
      process.exit(1);
    }
    prevalidatedVideoMetas.set(videoPath, valid.meta);
  }

  // --project auto: create a new project (with images/videos if provided)
  if (!projectId || projectId === 'auto') {
    if (chatImages.length === 0) {
      // Create empty project (videos will be uploaded separately after)
      process.stderr.write(`📦 Creating new project...\n`);
      const res = await fetch(`${baseUrl}/api/projects/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ title: prompt.slice(0, 50) }),
      });
      if (!res.ok) { process.stderr.write(`❌ Failed to create project: ${await res.text()}\n`); process.exit(1); }
      const data = await res.json();
      projectId = data.projectId;
      process.stderr.write(`📦 Project created: ${projectId}\n`);
    } else {
      // Create project with images (URLs and/or local files)
      const base64s = imageFileList.map(imgPath => {
        process.stderr.write(`📤 Uploading ${path.basename(imgPath)}...\n`);
        return readImageAsDataUrl(imgPath);
      });
      if (imageUrlList.length) process.stderr.write(`📤 Attaching ${imageUrlList.length} URL image(s)...\n`);
      const body = {};
      if (base64s.length) body.imageBase64s = base64s;
      if (imageUrlList.length) body.imageUrls = imageUrlList;
      const res = await fetch(`${baseUrl}/api/projects/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      if (!res.ok) { process.stderr.write(`❌ Failed to create project: ${await res.text()}\n`); process.exit(1); }
      const data = await res.json();
      projectId = data.projectId;
      process.stderr.write(`📦 Project created: ${projectId} (${data.snapshots?.length || 0} images)\n`);
    }
    chatImages.length = 0;
    imageUrlList.length = 0;
    imageFileList.length = 0;
  }
  // Upload additional images to existing project
  if (imageFileList.length > 0 || imageUrlList.length > 0) {
    const base64s = imageFileList.map(imgPath => {
      process.stderr.write(`📤 Uploading ${path.basename(imgPath)}...\n`);
      return readImageAsDataUrl(imgPath);
    });
    if (imageUrlList.length) process.stderr.write(`📤 Attaching ${imageUrlList.length} URL image(s)...\n`);
    const body = { _addToProject: projectId };
    if (base64s.length) body.imageBase64s = base64s;
    if (imageUrlList.length) body.imageUrls = imageUrlList;
    const res = await fetch(`${baseUrl}/api/projects/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      process.stderr.write(`📤 Added ${data.snapshots?.length || 0} image(s) to project\n`);
    } else {
      process.stderr.write(`⚠️ Failed to upload images: ${await res.text()}\n`);
    }
  }

  // Upload videos to project timeline (via /api/projects/create with videoUrls)
  let finalPrompt = activeSkill ? `[Active skill: ${activeSkill}]\n${prompt}` : prompt;
  if (chatVideos.length > 0) {
    // Upload local files via signed URL (no size limit, works with API key auth)
    const uploadedVideoUrls = [...prevalidatedVideoUrlList];
    const uploadedVideoMetas = prevalidatedVideoUrlList.map(() => null);
    if (prevalidatedVideoUrlList.length) {
      process.stderr.write(`📹 Assuming public video URL(s) already match Makaron upload limits: ≤${MAX_VIDEO_UPLOAD_DURATION}s, ≤${MAX_VIDEO_UPLOAD_FILE_SIZE_MB}MB, ≤1080p.\n`);
    }
    for (const videoPath of prevalidatedVideoFileList) {
      process.stderr.write(`📹 Uploading ${path.basename(videoPath)} (${(fs.statSync(videoPath).size/1024/1024).toFixed(1)}MB)...\n`);
      const ext = path.extname(videoPath).slice(1).toLowerCase();
      const mime = ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'video/mp4';
      const url = await uploadFileViaSignedUrl(baseUrl, headers, projectId, videoPath, mime);
      if (url) {
        uploadedVideoUrls.push(url);
        uploadedVideoMetas.push(prevalidatedVideoMetas.get(videoPath) || null);
        process.stderr.write(`📹 Uploaded: ${path.basename(videoPath)}\n`);
      }
    }

    // Add videos to project via projects/create (same as images)
    if (uploadedVideoUrls.length === 0) {
      process.stderr.write(`❌ No valid videos were uploaded. Local videos must be MP4/MOV/WebM, ≤${MAX_VIDEO_UPLOAD_DURATION}s, ≤${MAX_VIDEO_UPLOAD_FILE_SIZE_MB}MB, and ≤1080p.\n`);
      process.exit(1);
    }

    if (uploadedVideoUrls.length > 0) {
      if (prevalidatedVideoUrlList.length) process.stderr.write(`📹 Adding ${uploadedVideoUrls.length} video(s) to timeline...\n`);
      const res = await fetch(`${baseUrl}/api/projects/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ _addToProject: projectId, videoUrls: uploadedVideoUrls, videoMetas: uploadedVideoMetas }),
      });
      if (res.ok) {
        const data = await res.json();
        const videoSnaps = (data.snapshots || []).filter(s => s.type === 'video');
        process.stderr.write(`📹 Added ${videoSnaps.length} video(s) to timeline\n`);
      } else {
        process.stderr.write(`⚠️ Failed to add videos: ${await res.text()}\n`);
      }
    }

    // Inject hint so Agent knows videos are available
    const hint = `[User uploaded ${chatVideos.length === 1 ? 'a video' : `${chatVideos.length} videos`}. Use analyze_video to understand the content.]`;
    finalPrompt = `${finalPrompt}\n\n${hint}`;
  }

  if (useStream) {
    // Legacy SSE mode
    const { results } = await streamAgent(baseUrl, headers, projectId, finalPrompt);
    process.stderr.write('\n━━━ Results ━━━\n');
    for (const img of results.images) process.stderr.write(`🖼️  Image: ${img.imageUrl}\n`);
    for (const d of results.designs) process.stderr.write(`🎨  ${d.desc}\n`);
    process.stderr.write(`🔗  ${APP_URL}/projects/${projectId}\n`);
    for (const task of results.animationTasks) await pollVideo(baseUrl, headers, task.taskId, task.snapshotId);
    for (const task of results.musicTasks) await pollMusic(baseUrl, headers, task.taskId);
  } else {
    // Default: fire-and-forget + poll
    const { runId } = await submitRun(baseUrl, headers, projectId, finalPrompt, { videoModel, preferredModel });
    if (background) {
      // Just print runId and exit
      if (jsonOutput) {
        console.log(JSON.stringify({ runId, projectId, projectUrl: `${APP_URL}/projects/${projectId}`, status: 'running' }));
      } else {
        console.log(runId);
      }
    } else {
      process.stderr.write(`🚀 Run started: ${runId}\n`);
      await pollRun(baseUrl, headers, runId, { json: jsonOutput });
    }
  }
} else if (command === 'responses' || command === 'run') {
  const { headers, baseUrl } = getAuth();
  const sub = args[1];

  if (sub === 'get') {
    const runId = args[2];
    if (!runId) { console.error('Usage: makaron responses get <runId> [--wait] [--json] [--pick <field>]'); process.exit(1); }
    let wait = false, jsonOutput = false, pick = null;
    for (let i = 3; i < args.length; i++) {
      if (args[i] === '--wait') wait = true;
      if (args[i] === '--json') jsonOutput = true;
      if (args[i] === '--pick' && args[i + 1]) pick = args[++i];
    }

    if (wait) {
      await pollRun(baseUrl, headers, runId, { json: true });
    } else {
      const res = await fetch(`${baseUrl}/api/agent/run/${runId}`, { headers });
      if (!res.ok) { process.stderr.write(`Error ${res.status}: ${await res.text()}\n`); process.exit(1); }
      const data = await res.json();
      normalizeRunResponse(data);
      if (pick) {
        const picked = applyPick(data, pick);
        if (picked !== undefined) console.log(typeof picked === 'string' ? picked : JSON.stringify(picked));
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
      if (data.status === 'failed' || data.status === 'aborted') process.exit(1);
    }

  } else if (sub === 'watch') {
    const runId = args[2];
    if (!runId) { console.error('Usage: makaron responses watch <runId> [--jsonl] [--interval <ms>]'); process.exit(1); }
    let interval = 5000, jsonl = false;
    for (let i = 3; i < args.length; i++) {
      if (args[i] === '--jsonl') jsonl = true;
      if (args[i] === '--interval' && args[i + 1]) interval = parseInt(args[++i]);
    }
    await watchRun(baseUrl, headers, runId, { interval, jsonl });

  } else if (sub === 'list') {
    let projectId = null;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--project' && args[i + 1]) projectId = args[++i];
    }
    if (!projectId) { console.error('Usage: makaron responses list --project <id>'); process.exit(1); }
    const res = await fetch(`${baseUrl}/api/agent/run?projectId=${projectId}`, { headers });
    if (!res.ok) { process.stderr.write(`Error ${res.status}: ${await res.text()}\n`); process.exit(1); }
    const data = await res.json();
    if (data.runs?.length) {
      for (const r of data.runs) {
        const age = timeSince(new Date(r.started_at));
        console.log(`  ${r.id}  ${r.status.padEnd(10)} ${age}  ${(r.prompt || '').slice(0, 50)}`);
      }
    } else {
      console.log('No runs found for this project.');
    }

  } else {
    console.log(`Responses commands:
  responses get <runId>                  Get status and output (JSON)
  responses get <runId> --wait           Poll until completed
  responses get <runId> --pick <field>   Extract: first_image_url, first_video_url, project_url, output
  responses watch <runId> --jsonl        Watch until done (incremental events)
  responses list --project <id>          List runs for a project
`);
  }
} else if (command === 'list' || command === 'ls') {
  const { headers, baseUrl } = getAuth();
  await listProjects(baseUrl, headers);
} else if (command === 'project' || command === 'projects') {
  const { headers, baseUrl } = getAuth();
  const sub = args[1];
  if (sub === 'media') {
    const projectId = args[2];
    if (!projectId) { console.error('Usage: makaron project media <projectId> [--json]'); process.exit(1); }
    const jsonOutput = args.includes('--json');
    await listProjectMedia(baseUrl, headers, projectId, { json: jsonOutput });
  } else {
    console.log(`Project commands:
  project media <projectId> --json      List timeline media for a project
`);
  }
} else if (command === 'abort') {
  const { headers, baseUrl } = getAuth();
  const runId = args[1];
  if (!runId) {
    console.error('Usage: makaron abort <runId>');
    process.exit(1);
  }
  const res = await fetch(`${baseUrl}/api/agent/abort`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ runId }),
  });
  if (res.ok) {
    console.log(`✅ Run ${runId} aborted`);
  } else {
    console.error(`❌ Abort failed:`, await res.text());
  }
} else if (command === 'edit') {
  const { headers, baseUrl } = getAuth();
  const editArgs = {};
  const promptParts = [];
  let outputPath = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--image' && args[i + 1]) editArgs.image = imageToArg(args[++i]);
    else if (args[i] === '--model' && args[i + 1]) editArgs.model = args[++i];
    else if (args[i] === '--skill' && args[i + 1]) editArgs.skill = args[++i];
    else if (args[i] === '--ref' && args[i + 1]) {
      editArgs.referenceImages = editArgs.referenceImages || [];
      editArgs.referenceImages.push(imageToArg(args[++i]));
    }
    else if (args[i] === '--aspect' && args[i + 1]) editArgs.aspectRatio = args[++i];
    else if (args[i] === '--out' && args[i + 1]) outputPath = args[++i];
    else promptParts.push(args[i]);
  }
  editArgs.editPrompt = promptParts.join(' ');
  if (!editArgs.editPrompt) { console.error('Usage: makaron edit [--image <file|url>] [--model gemini|qwen|openai] [--skill enhance|creative|wild|captions] [--ref <file>] [--out <file>] "prompt"'); process.exit(1); }
  process.stderr.write('🎨 Generating...\n');
  const result = await callMcpTool(baseUrl, headers, 'makaron_edit_image', editArgs);
  saveMcpImage(result, outputPath);

} else if (command === 'analyze') {
  const { headers, baseUrl } = getAuth();
  let video = null;
  const questionParts = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--video' && args[i + 1]) video = args[++i];
    else questionParts.push(args[i]);
  }
  await analyzeVideoCli(baseUrl, headers, video, questionParts);

} else if (command === 'video') {
  const { headers, baseUrl } = getAuth();
  const sub = args[1];

  if (sub === 'script') {
    const images = [];
    const promptParts = [];
    let language = 'en';
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--image' && args[i + 1]) images.push(imageToArg(args[++i]));
      else if (args[i] === '--lang' && args[i + 1]) language = args[++i];
      else promptParts.push(args[i]);
    }
    if (!images.length) { console.error('Usage: makaron video script --image <file> [--image <file>] [--lang en|zh] "direction"'); process.exit(1); }
    process.stderr.write('🎬 Writing script...\n');
    const result = await callMcpTool(baseUrl, headers, 'makaron_write_video_script', { images, userRequest: promptParts.join(' ') || undefined, language });
    const text = result?.content?.find(c => c.type === 'text')?.text;
    if (text) console.log(text);

  } else if (sub === 'create') {
    const images = [];
    let script = '', duration = undefined, aspectRatio = undefined, videoModel = undefined, wait = false;
    let video = null, keepOriginalSound = false;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--image' && args[i + 1]) images.push(args[++i]);
      else if (args[i] === '--video' && args[i + 1]) video = args[++i];
      else if (args[i] === '--script' && args[i + 1]) script = args[++i];
      else if (args[i] === '--script-file' && args[i + 1]) script = fs.readFileSync(args[++i], 'utf-8');
      else if (args[i] === '--duration' && args[i + 1]) duration = Number(args[++i]);
      else if (args[i] === '--aspect' && args[i + 1]) aspectRatio = args[++i];
      else if (args[i] === '--model' && args[i + 1]) videoModel = args[++i];
      else if (args[i] === '--keep-original-sound') keepOriginalSound = true;
      else if (args[i] === '--project') {
        console.error('Usage: video create no longer supports --project. Use: makaron chat --project <id> --video <file|url> "your request"');
        process.exit(1);
      }
      else if (args[i] === '--wait') wait = true;
    }
    if ((!images.length && !video) || !script) {
      console.error('Usage: makaron video create --script "..." (--image <url> | --video <public-url>) [--duration 10] [--aspect 9:16] [--model kling|seedance] [--keep-original-sound]');
      process.exit(1);
    }

    if (wait) {
      console.error('Usage: --wait is only supported for project timeline tasks. Use chat --project for project video generation, or poll the returned taskId with video status.');
      process.exit(1);
    }

    let videoUrl = isHttpUrl(video) ? video : null;
    let inputVideoMeta = null;
    const selectedVideoModel = videoModel || 'kling';
    if (videoUrl) {
      process.stderr.write(`📹 Assuming public video URL already matches provider reference limits. Seedance requires ≤${MAX_VIDEO_PROVIDER_REFERENCE_DURATION}s, ≤50MB, sides 300-6000px, frame pixels 409,600-${MAX_VIDEO_FRAME_PIXELS}; Kling requires ≤200MB and ≤2K.\n`);
    }
    if (video && !videoUrl) {
      const valid = validateVideoFile(video, {
        maxDuration: MAX_VIDEO_PROVIDER_REFERENCE_DURATION,
        durationTolerance: MAX_VIDEO_PROVIDER_REFERENCE_DURATION_TOLERANCE,
        ...(selectedVideoModel === 'seedance' ? {
          minFramePixels: SEEDANCE_MIN_VIDEO_FRAME_PIXELS,
          minSide: SEEDANCE_MIN_VIDEO_SIDE,
          maxSide: SEEDANCE_MAX_VIDEO_SIDE,
          minAspect: SEEDANCE_MIN_VIDEO_ASPECT,
          maxAspect: SEEDANCE_MAX_VIDEO_ASPECT,
        } : {}),
      });
      if (!valid.ok) { console.error(`❌ ${valid.error}`); process.exit(1); }
      inputVideoMeta = valid.meta;
      process.stderr.write(`📹 Uploading ${path.basename(video)} (${(fs.statSync(video).size/1024/1024).toFixed(1)}MB)...\n`);
      videoUrl = await uploadFileViaSignedUrl(baseUrl, headers, undefined, video, valid.mime);
      if (!videoUrl) process.exit(1);
      process.stderr.write(`📹 Uploaded: ${path.basename(video)}\n`);
    }
    // Standalone MCP tool (no project timeline write)
    process.stderr.write('🎬 Submitting video...\n');
    const vArgs = videoUrl
      ? { videoUrl, editPrompt: script, images, videoModel: selectedVideoModel, referType: selectedVideoModel === 'seedance' ? 'feature' : 'base' }
      : { script, images };
    const effectiveDuration = duration || (inputVideoMeta?.duration ? Math.min(MAX_VIDEO_PROVIDER_REFERENCE_DURATION, Math.round(inputVideoMeta.duration)) : undefined);
    if (effectiveDuration) vArgs.duration = effectiveDuration;
    if (aspectRatio) vArgs.aspectRatio = aspectRatio;
    if (videoModel && !videoUrl) vArgs.videoModel = videoModel;
    if (keepOriginalSound && videoUrl) vArgs.keepOriginalSound = true;
    const result = await callMcpTool(baseUrl, headers, videoUrl ? 'makaron_edit_video' : 'makaron_create_video', vArgs);
    const text = result?.content?.find(c => c.type === 'text')?.text;
    if (text) {
      console.log(text);
      if (!text.includes('Task ID:')) process.exit(1);
    }

  } else if (sub === 'status') {
    let taskId = null, snapshotId = null, wait = false;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--snapshot' && args[i + 1]) snapshotId = args[++i];
      else if (args[i] === '--wait') wait = true;
      else if (!taskId) taskId = args[i];
    }
    if (!taskId && !snapshotId) { console.error('Usage: makaron video status <taskId> | --snapshot <snapshotId> [--wait]'); process.exit(1); }

    if (snapshotId || (taskId && taskId.length === 36 && taskId.includes('-'))) {
      // v2: poll /api/video-snapshot/[snapshotId]
      const id = snapshotId || taskId;
      if (wait) {
        const url = await pollVideo(baseUrl, headers, null, id);
        if (url) console.log(url);
      } else {
        const res = await fetch(`${baseUrl}/api/video-snapshot/${id}`, { headers });
        if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); process.exit(1); }
        const data = await res.json();
        console.log(JSON.stringify(data, null, 2));
      }
    } else {
      // v1: MCP get_video_status
      if (wait) {
        const url = await pollVideo(baseUrl, headers, taskId);
        if (url) console.log(url);
      } else {
        const result = await callMcpTool(baseUrl, headers, 'makaron_get_video_status', { taskId });
        const text = result?.content?.find(c => c.type === 'text')?.text;
        if (text) console.log(text);
      }
    }

  } else {
    console.log(`Video commands:
  video script --image <file> [--image <file>] "direction"   Write video script
  video create --script "..." --image <url> [--duration 10]  Submit video task
  video create --script "..." --video <public-url> [--model kling|seedance]  Edit a video (standalone)
  video status <taskId>                                      Check video status
  video status --snapshot <snapshotId> [--wait]              Check v2 video snapshot
`);
  }

} else if (command === 'music') {
  const { headers, baseUrl } = getAuth();
  const sub = args[1];

  if (sub === 'create') {
    const promptParts = [];
    let instrumental = true, style = undefined;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--vocals') instrumental = false;
      else if (args[i] === '--style' && args[i + 1]) style = args[++i];
      else promptParts.push(args[i]);
    }
    const prompt = promptParts.join(' ');
    if (!prompt) { console.error('Usage: makaron music create [--vocals] [--style "lo-fi"] "gentle piano"'); process.exit(1); }
    process.stderr.write('🎵 Generating music...\n');
    const mArgs = { prompt, instrumental };
    if (style) mArgs.style = style;
    const result = await callMcpTool(baseUrl, headers, 'makaron_create_music', mArgs);
    const text = result?.content?.find(c => c.type === 'text')?.text;
    if (text) console.log(text);

  } else if (sub === 'status') {
    const taskId = args[2];
    if (!taskId) { console.error('Usage: makaron music status <taskId>'); process.exit(1); }
    const result = await callMcpTool(baseUrl, headers, 'makaron_get_music_status', { taskId });
    const text = result?.content?.find(c => c.type === 'text')?.text;
    if (text) console.log(text);

  } else {
    console.log(`Music commands:
  music create [--vocals] [--style "genre"] "description"    Generate music
  music status <taskId>                                      Check music status
`);
  }

} else if (command === 'admin') {
  const { headers, baseUrl } = getAuth();
  const sub = args[1];

  if (sub === 'skills') {
    const action = args[2]; // add, update, delete, or none (list)
    if (!action) {
      // List all skills
      const res = await fetch(`${baseUrl}/api/admin/home-skills`, { headers });
      if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); process.exit(1); }
      const skills = await res.json();
      console.log(`📋 ${skills.length} skills\n`);
      for (const s of skills) {
        const label = s.labels?.en || s.labels?.zh || '(no label)';
        const active = s.is_active ? '✅' : '❌';
        const hasZip = s.skill_path ? '📦' : '  ';
        console.log(`  ${active} ${hasZip} ${String(s.sort_order).padStart(3)}  ${s.id}  ${label}`);
      }
    } else if (action === 'add') {
      const json = args.slice(3).join(' ');
      if (!json) { console.error('Usage: makaron admin skills add \'{"labels":...,"image":"..."}\''); process.exit(1); }
      let body;
      try { body = JSON.parse(json); } catch { console.error('Invalid JSON'); process.exit(1); }
      const res = await fetch(`${baseUrl}/api/admin/home-skills`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
      });
      if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); process.exit(1); }
      const data = await res.json();
      console.log(`✅ Skill created: ${data.id}`);
    } else if (action === 'update') {
      const id = args[3];
      const json = args.slice(4).join(' ');
      if (!id || !json) { console.error('Usage: makaron admin skills update <id> \'{"field":"value"}\''); process.exit(1); }
      let body;
      try { body = JSON.parse(json); } catch { console.error('Invalid JSON'); process.exit(1); }
      body.id = id;
      const res = await fetch(`${baseUrl}/api/admin/home-skills`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
      });
      if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); process.exit(1); }
      console.log(`✅ Skill ${id} updated`);
    } else if (action === 'delete') {
      const id = args[3];
      if (!id) { console.error('Usage: makaron admin skills delete <id>'); process.exit(1); }
      const res = await fetch(`${baseUrl}/api/admin/home-skills`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ id }),
      });
      if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); process.exit(1); }
      console.log(`✅ Skill ${id} deleted`);
    } else {
      console.error(`Unknown action: ${action}. Use: add, update, delete, or omit to list.`);
      process.exit(1);
    }

  } else if (sub === 'upload') {
    const filePath = args[2];
    const storagePath = args[3];
    if (!filePath || !storagePath) { console.error('Usage: makaron admin upload <local-file> <storage-path>'); process.exit(1); }
    if (!fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1); }

    const buf = fs.readFileSync(filePath);
    const ext = filePath.split('.').pop()?.toLowerCase();
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', zip: 'application/zip' };
    const mime = mimeMap[ext] || 'application/octet-stream';

    const formData = new FormData();
    formData.append('file', new Blob([buf], { type: mime }), path.basename(filePath));
    formData.append('path', storagePath);

    const res = await fetch(`${baseUrl}/api/admin/upload`, { method: 'POST', headers, body: formData });
    if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); process.exit(1); }
    const { url } = await res.json();
    console.log(`✅ Uploaded: ${url}`);

  } else if (sub === 'fetch-skill') {
    const code = args[2];
    if (!code) { console.error('Usage: makaron admin fetch-skill <share-code>'); process.exit(1); }
    // Extract code from full URL if given (e.g., https://www.makaron.app/s/4c4cbd57)
    const shareCode = code.includes('/s/') ? code.split('/s/').pop() : code;

    const res = await fetch(`${baseUrl}/api/skills/share/${shareCode}/download?format=json`, { headers });
    if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); process.exit(1); }
    const { skillName, files } = await res.json();

    // Create output directory
    const outDir = path.resolve(skillName);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    for (const f of files) {
      const filePath = path.join(outDir, f.path);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, Buffer.from(f.data, 'base64'));
    }

    console.log(`✅ Skill "${skillName}" downloaded to ./${skillName}/`);
    console.log(`   Files: ${files.map(f => f.path).join(', ')}`);

  } else if (sub === 'set-admin') {
    const email = args[2];
    if (!email) { console.error('Usage: makaron admin set-admin <email>'); process.exit(1); }
    const res = await fetch(`${baseUrl}/api/admin/set-admin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ email }),
    });
    if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); process.exit(1); }
    console.log(`✅ ${email} is now admin`);

  } else {
    console.log(`Admin commands:
  admin skills                         List all marketplace skills
  admin skills add '<json>'            Add a new skill
  admin skills update <id> '<json>'    Update a skill
  admin skills delete <id>             Delete a skill
  admin upload <file> <storage-path>   Upload file to Storage
  admin fetch-skill <code|url>         Download skill from share link
  admin set-admin <email>              Grant admin access to a user
`);
  }
} else if (command === 'register') {
  const baseUrl = process.env.MAKARON_URL || DEFAULT_URL;
  const isVerify = args.includes('--verify');

  if (isVerify) {
    let challengeId = null, answer = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--challenge-id' && args[i + 1]) challengeId = args[++i];
      else if (args[i] === '--answer' && args[i + 1]) answer = args[++i];
    }
    if (!challengeId || !answer) {
      console.error('Usage: makaron register --verify --challenge-id <id> --answer <number>');
      process.exit(1);
    }
    const res = await fetch(`${baseUrl}/api/agent/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge_id: challengeId, answer }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`Registration failed: ${data.error || data.message || res.status}`);
      process.exit(1);
    }
    // Save key to auth file
    saveAuth({ _apiKey: data.api_key, _baseUrl: baseUrl });
    // Request claim URL
    let claimUrl = null;
    try {
      const claimRes = await fetch(`${baseUrl}/api/agent/claim`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${data.api_key}`, 'Content-Type': 'application/json' },
      });
      const claimData = await claimRes.json();
      if (claimRes.ok) claimUrl = claimData.claim_url;
    } catch { /* non-fatal */ }
    const result = { api_key: data.api_key, credits: data.credits, claim_url: claimUrl };
    console.log(JSON.stringify(result));
    console.error(`✅ Registered! Key saved to ${AUTH_FILE}`);
    if (claimUrl) console.error(`🔗 Claim URL (share with human): ${claimUrl}`);
  } else {
    // Check if already has a key
    const existingKey = process.env.MAKARON_API_KEY;
    const existingAuth = loadAuth();
    if (existingKey) {
      console.error(`Already have API key: ${existingKey.slice(0, 16)}...`);
      process.exit(0);
    }
    if (existingAuth?._apiKey) {
      console.error(`Already registered: ${existingAuth._apiKey.slice(0, 16)}...`);
      process.exit(0);
    }
    // Request challenge
    const res = await fetch(`${baseUrl}/api/agent/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`Registration failed: ${data.error || data.message || res.status}`);
      process.exit(1);
    }
    if (args.includes('--json')) {
      console.log(JSON.stringify(data));
    } else {
      console.log(JSON.stringify(data));
      console.error(`\nChallenge received. Solve and run:`);
      console.error(`  npx makaron-cli register --verify --challenge-id ${data.challenge_id} --answer <your_answer>`);
    }
  }
} else if (command === 'claim') {
  const auth = getAuth();
  const res = await fetch(`${auth.baseUrl}/api/agent/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth.headers },
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Claim failed: ${data.error || data.message || res.status}`);
    process.exit(1);
  }
  console.log(JSON.stringify(data));
  console.error(`🔗 Share this link with a human: ${data.claim_url}`);
} else {
  console.log(`Makaron CLI — Talk to Makaron Agent from the terminal

Commands:
  register --json                    Get challenge for agent self-registration
  register --verify --challenge-id <id> --answer <n>  Verify and save API key
  claim                              Get claim URL for human to link account
  login                              Log in to Makaron (human interactive)
  list (ls)                          List all projects
  project media <projectId> --json    List timeline media for a project
  create --image <file>              Create project from local image
  create --image-url <url>           Create project from URL
  create --title "name"              Create empty project (text-to-image)

  chat --project <id> "message"      Chat (non-blocking, polls for result)
  chat --help                        Show chat capabilities and examples
  chat --project <id> --video <file> Attach video to conversation
  chat --project <id> --skill <name> Optional: guide Agent with a workflow
  chat --project <id> -b "message"   Background: submit and print runId
  chat --project <id> --stream "msg" Legacy: stream SSE in real-time
  chat --project <id> --json "msg"   Output structured JSON result

  responses get <runId>              Get run status and results
  responses get <runId> --wait       Poll until completed
  responses list --project <id>      List runs for a project
  abort <runId>                      Abort a running Agent

  edit [--image <file>] "prompt"     AI image edit / text-to-image
  analyze --video <file|url>         Analyze video content
  video script|create|status         Video generation
  music create|status                Music generation

  admin                              Admin commands (skills, upload, set-admin)

Environment:
  MAKARON_API_KEY  API key (mk_live_xxx) — recommended for agents
  MAKARON_URL      API base (default: ${DEFAULT_URL})
`);
}
