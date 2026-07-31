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
import { fileURLToPath } from 'url';

// ─── Config ──────────────────────────────────────────────────────────────────

const AUTH_FILE = path.join(process.env.HOME || '~', '.makaron', 'auth.json');
const UPDATE_CHECK_FILE = path.join(process.env.HOME || '~', '.makaron', 'update-check.json');
const DEFAULT_URL = 'https://www.makaron.app';
const BASE_URL = process.env.MAKARON_URL || DEFAULT_URL;
const APP_URL = process.env.MAKARON_APP_URL || DEFAULT_URL;
const NPM_PACKAGE_NAME = 'makaron-cli';
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 400;
const AGENT_WAIT_TIMEOUT_SECONDS = Math.max(900, Number(process.env.MAKARON_AGENT_WAIT_TIMEOUT_SECONDS || 10_800));

// Public anon key (safe to embed — only enables auth, not data access)
const SUPABASE_URL = 'https://sdyrtztrjgmmpnirswxt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_FJFN2YYaWaQjABUKLqxQcA_fhxPLFDY';

const MAX_VIDEO_UPLOAD_FILE_SIZE_MB = 50;
const MAX_VIDEO_UPLOAD_FILE_SIZE = MAX_VIDEO_UPLOAD_FILE_SIZE_MB * 1024 * 1024;
const MAX_VIDEO_UPLOAD_DURATION = 120;
const MAX_VIDEO_UPLOAD_DURATION_TOLERANCE = 1;
const MAX_VIDEO_PROVIDER_REFERENCE_DURATION = 15;
const MAX_VIDEO_PROVIDER_REFERENCE_DURATION_TOLERANCE = 0.5;
const MIN_AUDIO_REFERENCE_DURATION = 2;
const MAX_AUDIO_REFERENCE_DURATION = 15;
const MAX_AUDIO_REFERENCE_DURATION_TOLERANCE = 0.5;
const MAX_AUDIO_REFERENCE_FILE_SIZE_MB = 15;
const MAX_AUDIO_REFERENCE_FILE_SIZE = MAX_AUDIO_REFERENCE_FILE_SIZE_MB * 1024 * 1024;
const MAX_VIDEO_FRAME_PIXELS = 2_086_876;
const SEEDANCE_MIN_VIDEO_FRAME_PIXELS = 409_600;
const SEEDANCE_MIN_VIDEO_SIDE = 300;
const SEEDANCE_MAX_VIDEO_SIDE = 6000;
const SEEDANCE_MIN_VIDEO_ASPECT = 0.4;
const SEEDANCE_MAX_VIDEO_ASPECT = 2.5;

function warnLegacyModelFlag(replacement) {
  process.stderr.write(`⚠️  --model is deprecated here; use ${replacement}.\n`);
}

function getCliVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function compareVersions(a, b) {
  const parse = (version) => String(version || '')
    .split('-')[0]
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function readUpdateCache() {
  try {
    return JSON.parse(fs.readFileSync(UPDATE_CHECK_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function writeUpdateCache(data) {
  try {
    const dir = path.dirname(UPDATE_CHECK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(UPDATE_CHECK_FILE, JSON.stringify(data, null, 2));
  } catch { /* best effort */ }
}

function shouldCheckForUpdates(command, args) {
  if (!command || command === '--version' || command === '-v' || command === 'version') return false;
  if (args.includes('--help') || args.includes('-h')) return false;
  if (args.includes('--json') || args.includes('--jsonl') || args.includes('--pick')) return false;
  if (process.env.CI || process.env.NO_UPDATE_NOTIFIER || process.env.MAKARON_DISABLE_UPDATE_CHECK) return false;
  return true;
}

async function maybeNotifyUpdate(command, args) {
  if (!shouldCheckForUpdates(command, args)) return;
  const currentVersion = getCliVersion();
  const now = Date.now();
  const cache = readUpdateCache();
  if (cache?.checkedAt && now - cache.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
    if (cache.latestVersion && compareVersions(cache.latestVersion, currentVersion) > 0) {
      printUpdateNotice(currentVersion, cache.latestVersion);
    }
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return;
    const data = await res.json();
    const latestVersion = data?.version;
    if (!latestVersion) return;
    writeUpdateCache({ checkedAt: now, latestVersion });
    if (compareVersions(latestVersion, currentVersion) > 0) {
      printUpdateNotice(currentVersion, latestVersion);
    }
  } catch {
    writeUpdateCache({ checkedAt: now, latestVersion: cache?.latestVersion || currentVersion });
  } finally {
    clearTimeout(timer);
  }
}

function printUpdateNotice(currentVersion, latestVersion) {
  process.stderr.write(`\nUpdate available: makaron-cli ${currentVersion} -> ${latestVersion}\n`);
  process.stderr.write('Run: npm install -g makaron-cli@latest\n');
  process.stderr.write('Or:  npx makaron-cli@latest ...\n\n');
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds)) return String(seconds);
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1).replace(/\.0$/, '');
}

function readJsonInput(filePath) {
  const raw = filePath === '-' ? fs.readFileSync(0, 'utf-8') : fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
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
  makaron chat --project <id|auto> [options] [--skill <id|label|name>] "your message"

Options:
  --project <id|auto>       Project to work in. Use "auto" to create one.
  --image <file|url>        Attach a reference image or screenshot. Repeatable.
  --video <file|url>        Attach a video to the project timeline. Repeatable.
  --audio <file|url>        Attach a song, beat, or voice reference. MP3/WAV, repeatable.
  --skill <id|label|name>   Use an installed skill or auto-install a matched marketplace skill.
  --video-resolution <res>  Video resolution: auto, 480p, 720p, 768p, 1080p, 2k, or 4k.
  --background, -b          Submit and print a runId.
  --json                    Output structured JSON.
  --stream                  Legacy live SSE stream.
  --help, -h                Show this help.

Model routing is automatic in chat. Do not pass --agent-model, --image-model,
--video-model, or the legacy --model flag.

What you can ask:
  Image edit
    makaron chat --project <id> --image photo.jpg "remove the person in the background"

  Image generation
    makaron chat --project auto "generate a cinematic poster of a rainy Tokyo alley"

  Video from image or timeline
    makaron chat --project <id> "make this into a 5 second cinematic video"

  Marketplace skill
    makaron chat --project auto --image selfie.jpg --skill "Football Captain" "make this cinematic"

  Fix one video moment from a screenshot
    makaron chat --project <id> --image screenshot.png "@4 this frame should be Paris; only fix this moment"

  Video cuts and assembly
    makaron chat --project <id> --video clip.mp4 "cut out the dead air and keep the best 20 seconds"

  Music
    makaron chat --project <id> "add calm piano background music"

  Reference audio / beat sync
    makaron chat --project auto --audio beat.mp3 --video-resolution 480p "用这个音乐做卡点视频"
    makaron chat --project <id> --audio https://example.com/beat.mp3 "add this as the soundtrack"

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

async function streamAgent(baseUrl, headers, projectId, prompt, opts = {}) {
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
      ...(opts.videoResolution ? { videoResolution: opts.videoResolution } : {}),
      ...(opts.uploadedVideoCount ? { uploadedVideoCount: opts.uploadedVideoCount } : {}),
      ...(opts.turnMediaCount ? { turnMediaCount: opts.turnMediaCount } : {}),
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
  if (opts.videoResolution) body.videoResolution = opts.videoResolution;
  if (opts.currentSnapshotIndex != null) body.currentSnapshotIndex = opts.currentSnapshotIndex;
  if (opts.isNsfw) body.isNsfw = opts.isNsfw;
  if (opts.audioAttachments?.length) body.audioAttachments = opts.audioAttachments;
  if (opts.uploadedVideoCount) body.uploadedVideoCount = opts.uploadedVideoCount;
  if (opts.turnMediaCount) body.turnMediaCount = opts.turnMediaCount;

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
  const {
    json = false,
    waitForArtifacts = false,
    background = false,
    exportCompositions = false,
    publishExports = false,
    returnDataOnly = false,
  } = opts;
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
        if (elapsed > AGENT_WAIT_TIMEOUT_SECONDS) { process.stderr.write(`\n❌ Timeout after ${elapsed}s\n`); process.exit(1); }
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
          case 'studio_run': {
            const stage = ev.data?.currentStage || ev.data?.current_stage || 'complete';
            const recipe = ev.data?.recipe || 'studio';
            const status = ev.data?.status || 'running';
            process.stderr.write(`\nStudio Run: ${recipe} / ${stage} / ${status}\n`);
            break;
          }
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
      normalizeRunResponse(data);
      if (printedText && !json) process.stdout.write('\n');
      if (data.status === 'completed' && exportCompositions) {
        data = await exportAnimatedCompositionsFromRun(baseUrl, headers, data, {
          publish: publishExports,
          quiet: json || returnDataOnly,
        });
      }

      if (json && !returnDataOnly) {
        // Structured JSON output — add projectUrl
        console.log(JSON.stringify(normalizeRunResponse(data), null, 2));
      } else if (!returnDataOnly) {
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

      if (data.status === 'failed' || data.status === 'aborted') process.exit(1);
      return data;
    }
  }
}

// ─── Pick Helper ────────────────────────────────────────────────────────────

function applyPick(data, field) {
  const videoUrls = [...new Set([
    ...(data.output || []).filter(o => o.type === 'video' && o.url).map(o => o.url),
    ...(data.result?.videos || []).filter(v => v.videoUrl).map(v => v.videoUrl),
  ])];
  switch (field) {
    case 'first_image_url': return data.output?.find(o => o.type === 'image')?.url || null;
    case 'image_urls': return (data.output || []).filter(o => o.type === 'image' && o.url).map(o => o.url);
    case 'first_video_url': return videoUrls[0] || null;
    case 'video_urls': return videoUrls;
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
    case 'studio_run': return [...(data.output || [])].reverse().find(o => o.type === 'studio_run') || null;
    case 'studio_recipe': return [...(data.output || [])].reverse().find(o => o.type === 'studio_run')?.recipe || null;
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
        if (elapsed > AGENT_WAIT_TIMEOUT_SECONDS) { process.stderr.write(`Timeout after ${elapsed}s\n`); process.exit(2); }
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
    if (!opts.silent) console.log(JSON.stringify(data, null, 2));
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

async function pollRemotionExport(baseUrl, headers, jobId, opts = {}) {
  const start = Date.now();
  while (true) {
    const res = await fetch(`${baseUrl}/api/remotion/export/${jobId}`, { headers });
    if (!res.ok) { process.stderr.write(`Export status failed ${res.status}: ${await res.text()}\n`); process.exit(1); }
    const data = await res.json();
    if (data.status === 'completed' || data.status === 'failed') {
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
      } else if (data.status === 'completed') {
        const duration = typeof data.duration_seconds === 'number' ? `${data.duration_seconds.toFixed(2)}s` : 'unknown';
        const render = typeof data.render_seconds === 'number' ? `${data.render_seconds.toFixed(2)}s` : 'unknown';
        const ratio = typeof data.realtime_ratio === 'number' ? data.realtime_ratio.toFixed(2) : 'unknown';
        if (!opts.quiet) {
          process.stderr.write(`✅ Export complete\n`);
          process.stderr.write(`   Video duration: ${duration}\n`);
          process.stderr.write(`   Export time: ${render}\n`);
          process.stderr.write(`   Duration/export ratio: ${ratio}:1\n`);
          console.log(data.url || data.storageUrl || '');
        }
      } else if (!opts.quiet) {
        process.stderr.write(`❌ Export failed: ${data.error || 'unknown error'}\n`);
      }
      if (data.status === 'failed') process.exit(1);
      return data;
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    const pct = typeof data.progress === 'number' ? ` ${(data.progress * 100).toFixed(0)}%` : '';
    if (!opts.quiet) process.stderr.write(`\r🎬 Export ${data.status}${pct} (${elapsed}s)`);
    await new Promise(r => setTimeout(r, data.next_poll_after_ms || 3000));
  }
}

async function exportComposition(baseUrl, headers, opts = {}) {
  const body = {
    projectId: opts.projectId,
    snapshotId: opts.snapshotId,
    designPath: opts.designPath,
    design: opts.design,
    outputType: opts.outputType || 'video',
    renderProfile: opts.renderProfile || 'fast_720p',
    publish: opts.publish === true,
    name: opts.name,
  };

  if (opts.mediaIndex) {
    if (!body.projectId) {
      process.stderr.write('Usage: makaron materialize --project <id> --media <N> [--wait] [--publish] [--name <slug>] [--json]\n');
      process.exit(1);
    }
    const mediaData = await listProjectMedia(baseUrl, headers, opts.projectId, { json: true, silent: true });
    const item = (mediaData.media || []).find(m => Number(m.index) === Number(opts.mediaIndex));
    if (!item) {
      process.stderr.write(`No media item at index ${opts.mediaIndex}\n`);
      process.exit(1);
    }
    if (item.type !== 'composition' && !item.codePath) {
      process.stderr.write(`Media ${opts.mediaIndex} is ${item.type}, not a Remotion composition.\n`);
      process.exit(1);
    }
    body.snapshotId = item.snapshotId || item.snapshot_id;
    body.designPath = item.codePath || item.designPath || body.designPath;
  }

  if (!body.projectId || (!body.snapshotId && !body.designPath && !body.design)) {
    process.stderr.write('Usage: makaron materialize --project <id> (--media <N> | --snapshot <snapshotId> | --design-path <path> | --design-json <file|->) [--wait] [--publish] [--name <slug>] [--json]\n');
    process.exit(1);
  }

  const res = await fetch(`${baseUrl}/api/remotion/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    process.stderr.write(`Export failed ${res.status}: ${JSON.stringify(data)}\n`);
    process.exit(1);
  }

  if (opts.wait) {
    if (!opts.quiet) process.stderr.write(`🎬 Export queued: ${data.jobId || data.id}\n`);
    return pollRemotionExport(baseUrl, headers, data.jobId || data.id, { json: opts.json, quiet: opts.quiet });
  }

  if (!opts.quiet) {
    if (opts.json) console.log(JSON.stringify(data, null, 2));
    else console.log(data.jobId || data.id);
  }
  return data;
}

function pickExportValue(data, pick) {
  if (!pick) return undefined;
  if (pick === 'url' || pick === 'video_url' || pick === 'first_video_url') return data.url || data.storageUrl || data.storage_url;
  if (pick === 'job_id' || pick === 'id') return data.jobId || data.id;
  if (pick === 'workspace_path') return data.workspacePath || data.workspace_path;
  if (pick === 'status') return data.status;
  if (pick === 'output') return data;
  return data[pick];
}

async function exportAnimatedCompositionsFromRun(baseUrl, headers, data, opts = {}) {
  const projectId = data.projectId || data.project_id;
  if (!projectId) return data;
  const designs = (data.output || []).filter(o => o.type === 'design' && o.animated && o.snapshot_id);
  if (!designs.length) return data;

  const exported = [];
  for (const design of designs) {
    if (!opts.quiet) process.stderr.write(`\n🎬 Exporting composition snapshot ${design.snapshot_id}...\n`);
    const job = await exportComposition(baseUrl, headers, {
      projectId,
      snapshotId: design.snapshot_id,
      wait: true,
      publish: opts.publish === true,
      name: `run-${data.id || 'composition'}-${design.snapshot_id}`,
      quiet: opts.quiet,
    });
    exported.push(job);
    if (job?.url || job?.storageUrl) {
      data.output = data.output || [];
      data.output.push({
        id: `export_${job.id}`,
        type: 'video',
        status: 'completed',
        url: job.url || job.storageUrl,
        export_job_id: job.id,
        source_snapshot_id: design.snapshot_id,
        duration: job.duration_seconds,
        render_seconds: job.render_seconds,
        realtime_ratio: job.realtime_ratio,
        width: job.width,
        height: job.height,
      });
      data.result = data.result || {};
      data.result.videos = data.result.videos || [];
      data.result.videos.push({
        taskId: `remotion-export-${job.id}`,
        status: 'completed',
        videoUrl: job.url || job.storageUrl,
        duration: job.duration_seconds,
        renderSeconds: job.render_seconds,
        realtimeRatio: job.realtime_ratio,
      });
    }
  }
  data.remotion_exports = exported;
  return data;
}

function timeSince(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ─── Skill Marketplace ──────────────────────────────────────────────────────

const MARKETPLACE_LOCALES = ['en', 'zh', 'zh-Hant', 'ja'];

function localizedValues(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value).filter(item => typeof item === 'string' && item.trim());
}

function localizedCoverage(value) {
  return MARKETPLACE_LOCALES.filter(locale => typeof value?.[locale] === 'string' && value[locale].trim()).length;
}

function getSkillLabel(skill) {
  return skill.labels?.en || skill.labels?.zh || skill.label || skill.name || skill.id;
}

function slugifySkill(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeMarketplaceSkill(skill) {
  return {
    ...skill,
    label: getSkillLabel(skill),
    skillPath: skill.skillPath || skill.skill_path || null,
    hasSkill: Boolean(skill.skillPath || skill.skill_path),
  };
}

async function fetchMarketplaceSkills(baseUrl, opts = {}) {
  let res;
  try {
    res = await fetch(`${baseUrl}/api/home-skills`);
  } catch (err) {
    if (opts.optional) return null;
    process.stderr.write(`Failed to load marketplace skills: ${err.message || err}\n`);
    process.exit(1);
  }
  if (!res.ok) {
    if (opts.optional) return null;
    process.stderr.write(`Error ${res.status}: ${await res.text()}\n`);
    process.exit(1);
  }
  const data = await res.json();
  const skills = Array.isArray(data) ? data : (data.skills || []);
  return skills.map(normalizeMarketplaceSkill);
}

async function fetchBuiltInSkills(baseUrl) {
  const res = await fetch(`${baseUrl}/api/skills?include=internal`);
  if (!res.ok) {
    process.stderr.write(`Error ${res.status}: ${await res.text()}\n`);
    process.exit(1);
  }
  const data = await res.json();
  return (data.skills || []).filter(skill => skill.builtIn);
}

function printBuiltInSkills(skills) {
  if (!skills.length) {
    console.log('No built-in skills found.');
    return;
  }
  console.log(`Built-in skills: ${skills.length}\n`);
  for (const skill of skills) {
    const recipe = skill.studioRunRecipe ? `  [Studio Run: ${skill.studioRunRecipe}]` : '';
    const source = skill.sourceMediaRequired ? '  [source media required]' : '';
    const adapter = skill.sourceProject === 'openmontage'
      ? `  [OpenMontage: ${skill.supportLevel || 'adapted'}${skill.canonicalSkill && skill.canonicalSkill !== skill.name ? ` -> ${skill.canonicalSkill}` : ''}]`
      : '';
    console.log(`  ${skill.name}${recipe}${source}${adapter}`);
    if (skill.description) console.log(`    ${String(skill.description).replace(/\s+/g, ' ').trim()}`);
  }
}

function marketplaceSearchText(skill) {
  const localized = [...localizedValues(skill.labels), ...localizedValues(skill.prompts)];
  return [
    skill.id,
    skill.label,
    ...localized,
    skill.prompt,
    ...(Array.isArray(skill.categories) ? skill.categories : []),
    slugifySkill(skill.label),
    ...localized.map(slugifySkill),
  ].filter(Boolean).join(' ').toLowerCase();
}

function marketplaceSkillTokens(skill) {
  return [
    skill.id,
    skill.label,
    ...localizedValues(skill.labels),
    ...localizedValues(skill.prompts),
    skill.prompt,
    ...(Array.isArray(skill.categories) ? skill.categories : []),
  ].filter(Boolean).map(value => String(value).toLowerCase());
}

function findMarketplaceSkill(skills, identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const slug = slugifySkill(raw);
  const exact = skills.filter(skill => {
    const labels = Object.values(skill.labels || {}).map(v => String(v).toLowerCase());
    const slugMatches = slug
      ? slugifySkill(getSkillLabel(skill)) === slug ||
        Object.values(skill.labels || {}).some(v => slugifySkill(v) === slug)
      : false;
    return skill.id === raw ||
      skill.id?.toLowerCase() === lower ||
      getSkillLabel(skill).toLowerCase() === lower ||
      labels.includes(lower) ||
      slugMatches;
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    process.stderr.write(`Multiple marketplace skills match "${raw}". Use an id:\n`);
    exact.forEach(skill => process.stderr.write(`  ${skill.id}  ${skill.label}\n`));
    process.exit(1);
  }
  const prefix = skills.filter(skill => skill.id?.startsWith(raw));
  if (prefix.length === 1) return prefix[0];
  return null;
}

function printMarketplaceSkills(skills) {
  if (!skills.length) {
    console.log('No marketplace skills found.');
    return;
  }
  console.log(`📦 ${skills.length} marketplace skills\n`);
  for (const skill of skills) {
    const kind = skill.hasSkill ? 'skill' : 'prompt';
    console.log(`  ${skill.id}  ${skill.label}  [${kind}]`);
  }
}

function printMarketplaceSkill(skill) {
  console.log(`${skill.label}`);
  console.log(`ID: ${skill.id}`);
  console.log(`Type: ${skill.hasSkill ? 'installable skill' : 'prompt template'}`);
  for (const locale of MARKETPLACE_LOCALES) {
    const label = skill.labels?.[locale];
    if (label && label !== skill.label) console.log(`${locale}: ${label}`);
  }
  if (Array.isArray(skill.categories) && skill.categories.length) console.log(`Categories: ${skill.categories.join(', ')}`);
  console.log(`i18n: titles ${localizedCoverage(skill.labels)}/4 · prompts ${localizedCoverage(skill.prompts)}/4`);
  if (skill.prompts?.en || skill.prompt) console.log(`Prompt (en): ${skill.prompts?.en || skill.prompt}`);
  if (skill.image) console.log(`Cover: ${skill.image}`);
  if (skill.hasSkill) console.log(`Install: makaron skills install ${skill.id}`);
}

async function installMarketplaceSkill(baseUrl, headers, skill, opts = {}) {
  if (!skill.hasSkill) {
    process.stderr.write(`"${skill.label}" is a prompt-only marketplace item and has no installable skill package.\n`);
    process.exit(1);
  }
  if (!opts.quiet) process.stderr.write(`📦 Installing skill: ${skill.label}\n`);
  const res = await fetch(`${baseUrl}/api/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ skillPath: skill.skillPath, homeSkillId: skill.id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    process.stderr.write(`Install failed: ${data.error || res.status}\n`);
    process.exit(1);
  }
  if (!opts.quiet) {
    const suffix = data.alreadyInstalled ? 'already installed' : 'installed';
    process.stderr.write(`✅ Skill ${suffix}: ${data.skillName}\n`);
  }
  return data;
}

async function resolveChatSkill(baseUrl, headers, activeSkill) {
  if (!activeSkill) return undefined;
  const skills = await fetchMarketplaceSkills(baseUrl, { optional: true });
  if (!skills) return activeSkill;
  const marketplaceSkill = findMarketplaceSkill(skills, activeSkill);
  if (!marketplaceSkill) return activeSkill;
  const result = await installMarketplaceSkill(baseUrl, headers, marketplaceSkill);
  return result.skillName;
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
async function uploadFileViaSignedUrl(baseUrl, headers, projectId, filePath, contentType, options = {}) {
  const filename = path.basename(filePath);
  // Step 1: get signed upload URL
  const urlRes = await fetch(`${baseUrl}/api/storage/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ projectId, filename, contentType, uploadKind: options.uploadKind }),
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

async function uploadImageFilesViaSignedUrl(baseUrl, headers, projectId, imagePaths) {
  const urls = [];
  for (const imagePath of imagePaths) {
    const valid = validateImage(imagePath);
    if (!valid.ok) {
      process.stderr.write(`❌ Cannot upload: ${path.basename(imagePath)}\n   ${valid.error}\n`);
      process.exit(1);
    }
    process.stderr.write(`📤 Uploading ${path.basename(imagePath)}...\n`);
    const url = await uploadFileViaSignedUrl(baseUrl, headers, projectId, imagePath, valid.mime);
    if (!url) {
      process.stderr.write(`❌ Failed to upload image: ${imagePath}\n`);
      process.exit(1);
    }
    urls.push(url);
  }
  return urls;
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

function probeAudioDurationWithFfprobe(audioPath) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      audioPath,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const data = JSON.parse(out);
    const duration = Number(data.format?.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;
  } catch { /* ffprobe unavailable or file unsupported */ }
  return null;
}

function getAudioMimeFromExt(ext) {
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  return null;
}

function validateAudioReferenceFile(audioPath) {
  if (!fs.existsSync(audioPath)) {
    return { ok: false, error: `Audio file not found: ${audioPath}` };
  }
  const stat = fs.statSync(audioPath);
  if (stat.size === 0) {
    return { ok: false, error: `Audio file is empty: ${audioPath}` };
  }
  if (stat.size > MAX_AUDIO_REFERENCE_FILE_SIZE) {
    return { ok: false, error: `Audio too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB (max ${MAX_AUDIO_REFERENCE_FILE_SIZE_MB}MB).` };
  }
  const ext = path.extname(audioPath).slice(1).toLowerCase();
  const mime = getAudioMimeFromExt(ext);
  if (!mime) {
    return { ok: false, error: `Unsupported audio format: .${ext || 'unknown'}. Use MP3 or WAV.` };
  }
  const duration = probeAudioDurationWithFfprobe(audioPath);
  if (duration == null) {
    return { ok: false, error: 'Cannot read audio duration. Install ffprobe or use a public MP3/WAV URL.' };
  }
  if (duration < MIN_AUDIO_REFERENCE_DURATION) {
    return { ok: false, error: `Audio too short: ${formatSeconds(duration)}s (min ${MIN_AUDIO_REFERENCE_DURATION}s).` };
  }
  if (duration > MAX_AUDIO_REFERENCE_DURATION + MAX_AUDIO_REFERENCE_DURATION_TOLERANCE) {
    return { ok: false, error: `Audio too long: ${formatSeconds(duration)}s (max ${MAX_AUDIO_REFERENCE_DURATION}s, with ${MAX_AUDIO_REFERENCE_DURATION_TOLERANCE}s metadata tolerance).` };
  }
  return { ok: true, mime, meta: { duration, fileSizeBytes: stat.size } };
}

function validateAudioReferenceUrl(audioUrl) {
  let parsed;
  try {
    parsed = new URL(audioUrl);
  } catch {
    return { ok: false, error: `Invalid audio URL: ${audioUrl}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `Invalid audio URL protocol: ${parsed.protocol}` };
  }
  const ext = path.extname(parsed.pathname).slice(1).toLowerCase();
  const mime = getAudioMimeFromExt(ext);
  if (!mime) {
    return { ok: false, error: `Unsupported audio URL format: .${ext || 'unknown'}. Use an MP3 or WAV URL.` };
  }
  return { ok: true, mime };
}

async function probeAudioReferenceUrl(audioUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(audioUrl, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { Accept: 'audio/mpeg,audio/wav,audio/wave,audio/x-wav,*/*' },
    });
    if (!res.ok) return { ok: true, warning: `Could not HEAD probe audio URL (${res.status}); storing external URL as-is.` };
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > MAX_AUDIO_REFERENCE_FILE_SIZE) {
      return { ok: false, error: `Audio URL appears too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB (max ${MAX_AUDIO_REFERENCE_FILE_SIZE_MB}MB).` };
    }
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('audio/') && !contentType.includes('octet-stream')) {
      return { ok: false, error: `Audio URL content-type is not audio: ${contentType}` };
    }
    return { ok: true, fileSizeBytes: contentLength || undefined };
  } catch {
    return { ok: true, warning: 'Could not HEAD probe audio URL; storing external URL as-is.' };
  } finally {
    clearTimeout(timer);
  }
}

function titleFromAudioInput(value) {
  if (isHttpUrl(value)) {
    try {
      const name = decodeURIComponent(new URL(value).pathname.split('/').filter(Boolean).pop() || '');
      return name || 'Reference audio';
    } catch {
      return 'Reference audio';
    }
  }
  return path.basename(value);
}

async function importAudioTracks(baseUrl, headers, projectId, audios) {
  const res = await fetch(`${baseUrl}/api/music/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ projectId, audios }),
  });
  if (!res.ok) {
    process.stderr.write(`❌ Failed to import audio: ${await res.text()}\n`);
    process.exit(1);
  }
  return await res.json();
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

// ─── Help ───────────────────────────────────────────────────────────────────

function hasHelpFlag(values) {
  return values.includes('--help') || values.includes('-h');
}

function printRootHelp() {
  console.log(`Makaron CLI — Talk to Makaron Agent from the terminal

Commands:
  setup                              Install makaron-cli globally and add the Agent Skill
  install-skill                     Install Makaron Agent Skill into your coding agent
  register --json                    Get challenge for agent self-registration
  register --verify --challenge-id <id> --answer <n>  Verify and save API key
  claim                              Get claim URL for human to link account
  login                              Log in to Makaron (human interactive)
  credits                            Show current credit balance
  list (ls)                          List all projects
  project media <projectId> --json    List timeline media for a project
  create --image <file>              Create project from local image
  create --image-url <url>           Create project from URL
  create --title "name"              Create empty project (text-to-image)

  chat --project <id> "message"      Chat (non-blocking, polls for result)
  chat --project <id> --skill <id>   Use a built-in or marketplace skill
  chat --project <id> --video <file> Attach video to conversation
  chat --project <id> --audio <file> Attach song/beat/voice reference
  chat --project <id> -b "message"   Background: submit and print runId
  chat --project <id> --stream "msg" Legacy: stream SSE in real-time
  chat --project <id> --json "msg"   Output structured JSON result

  responses get <runId>              Get run status and results
  responses get <runId> --wait       Poll until completed
  responses get <runId> --materialize --wait --pick first_video_url
                                     Export and publish Remotion compositions as MP4
  materialize --project <id> --media <N> --pick url
                                     Convert editable composition/JSON to MP4
  composition export --project <id> --media <N> --wait
                                     Export editable Remotion composition to MP4
  responses list --project <id>      List runs for a project
  abort <runId>                      Abort a running Agent
  skills list|search|show|install    Browse built-in and marketplace skills

  edit [--image <file>] "prompt"     AI image edit / text-to-image
  analyze --video <file|url>         Analyze video content
  video script|create|status         Video generation
  music create|status                Music generation

  admin                              Admin commands (skills, upload, set-admin)

Examples:
  makaron chat --project auto "plan a launch poster"
  makaron chat --project <id> "make it cinematic"
  makaron chat --project <id> "turn this into a short video"

Run makaron <command> --help for command-specific options.
Chat chooses agent, image, and video models automatically.

Environment:
  MAKARON_API_KEY       API key (mk_live_xxx) — recommended for agents
  MAKARON_URL           API base (default: ${DEFAULT_URL})
`);
}

function installAgentSkill(values = []) {
  if (hasHelpFlag(values)) {
    console.log('Usage: makaron install-skill [--global] [--agent <agent>] [--yes]');
    return;
  }

  const skillDir = fileURLToPath(new URL('../skills/makaron', import.meta.url));
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    console.error(`Makaron Agent Skill not found at ${skillFile}`);
    process.exit(1);
  }

  execFileSync('npx', [
    '-y',
    'skills',
    'add',
    skillDir,
    '--skill',
    'makaron',
    '--copy',
    ...values,
  ], { stdio: 'inherit' });
}

function setupMakaron(values = []) {
  if (hasHelpFlag(values)) {
    console.log('Usage: makaron setup [--agent <agent>]');
    return;
  }

  const version = getCliVersion();
  console.error(`Installing ${NPM_PACKAGE_NAME}@${version} globally...`);
  execFileSync('npm', ['install', '-g', `${NPM_PACKAGE_NAME}@${version}`], { stdio: 'inherit' });

  const skillArgs = [...values];
  if (!skillArgs.includes('--global') && !skillArgs.includes('-g')) skillArgs.unshift('--global');
  if (!skillArgs.includes('--yes') && !skillArgs.includes('-y')) skillArgs.push('--yes');

  console.error('Installing Makaron Agent Skill globally...');
  installAgentSkill(skillArgs);
}

function printHelp(topic, subtopic) {
  if (topic === 'login') {
    console.log('Usage: makaron login');
  } else if (topic === 'create') {
    console.log('Usage: makaron create --image <file> [--image <file2>] | --image-url <url> | --title "name"');
  } else if (topic === 'chat') {
    printChatHelp();
  } else if (topic === 'responses' || topic === 'run') {
    if (subtopic === 'get') console.log('Usage: makaron responses get <runId> [--wait] [--json] [--pick <field>] [--materialize|--export-compositions] [--publish-exports]');
    else if (subtopic === 'watch') console.log('Usage: makaron responses watch <runId> [--jsonl] [--interval <ms>]');
    else if (subtopic === 'list') console.log('Usage: makaron responses list --project <id>');
    else console.log(`Responses commands:
  responses get <runId>                  Get status and output (JSON)
  responses get <runId> --wait           Poll until completed
  responses get <runId> --pick <field>   Extract: first_image_url, first_video_url, project_url, output
  responses get <runId> --export-compositions --wait --pick first_video_url
                                            Export animated compositions before picking video URL
  responses get <runId> --materialize --wait --pick first_video_url
                                            Export and publish animated compositions as MP4
  responses watch <runId> --jsonl        Watch until done (incremental events)
  responses list --project <id>          List runs for a project
`);
  } else if (topic === 'list' || topic === 'ls') {
    console.log('Usage: makaron list');
  } else if (topic === 'credits' || topic === 'credit' || topic === 'balance') {
    console.log('Usage: makaron credits [--json]');
  } else if (topic === 'project' || topic === 'projects') {
    if (subtopic === 'media') console.log('Usage: makaron project media <projectId> [--json]');
    else console.log(`Project commands:
  project media <projectId> --json      List timeline media for a project
`);
  } else if (topic === 'abort') {
    console.log('Usage: makaron abort <runId>');
  } else if (topic === 'setup') {
    console.log('Usage: makaron setup [--agent <agent>]');
  } else if (topic === 'install-skill') {
    console.log('Usage: makaron install-skill [--global] [--agent <agent>] [--yes]');
  } else if (topic === 'skills') {
    if (subtopic === 'list') console.log('Usage: makaron skills list [--built-in] [--json]');
    else if (subtopic === 'search') console.log('Usage: makaron skills search <query> [--json]');
    else if (subtopic === 'show') console.log('Usage: makaron skills show <marketplace-id|label> [--json]');
    else if (subtopic === 'install') console.log('Usage: makaron skills install <marketplace-id|label> [--json]');
    else console.log(`Skill commands:
  skills list --built-in              List all built-in Makaron skills and Studio Run recipes
  skills list                         List marketplace skills
  skills search <query>               Search marketplace skills
  skills show <id|label> --built-in   Show a built-in skill
  skills show <id|label>              Show a marketplace skill
  skills install <id|label>           Install a marketplace skill to your workspace

Use with chat:
  makaron chat --project auto --skill <id|label> "your request"
`);
  } else if (topic === 'materialize') {
    console.log(`Usage: makaron materialize --project <id> (--media <N> | --snapshot <snapshotId> | --design-path <path> | --design-json <file|->) [--wait] [--publish|--no-publish] [--profile fast_720p|source] [--pick url|job_id|status]`);
  } else if (topic === 'composition' || topic === 'compositions') {
    console.log(`Composition commands:
  composition export --project <id> --media <N> --wait
  composition export --project <id> --snapshot <snapshotId> --wait
  composition export --project <id> --design-path <path> --wait
  composition export --project <id> --design-json composition.json --wait
  composition status <jobId> [--wait] [--json]
`);
  } else if (topic === 'edit') {
    console.log('Usage: makaron edit [--image <file|url>] [--image-model gemini|gemini-lite|qwen|openai|pony|wai] [--skill enhance|creative|wild|captions] [--ref <file>] [--out <file>] "prompt"');
  } else if (topic === 'analyze') {
    console.log('Usage: makaron analyze --video <file|url> ["question"]');
  } else if (topic === 'video') {
    if (subtopic === 'script') console.log('Usage: makaron video script --image <file> [--image <file>] [--lang en|zh] "direction"');
    else if (subtopic === 'create') console.log('Usage: makaron video create --script "..." [--image <url> | --video <public-url>] [--duration 10] [--aspect 9:16] [--video-model seedance-fast|seedance-mini|seedance|kling|grok|google-omni|minimax-h3] [--video-resolution auto|480p|720p|768p|1080p|2k|4k] [--keep-original-sound]');
    else if (subtopic === 'status') console.log('Usage: makaron video status <taskId> | --snapshot <snapshotId> [--wait]');
    else console.log(`Video commands:
  video script --image <file> [--image <file>] "direction"   Write video script
  video create --script "..." --video-model seedance-fast    Native text-to-video (no image required)
  video create --script "..." --video-model minimax-h3 --video-resolution 2k    MiniMax H3 native 2K text-to-video
  video create --script "..." --image <url> [--duration 10]  Submit video task
  video create --script "..." --video <public-url> [--video-model seedance-fast|seedance-mini|seedance|kling|google-omni|minimax-h3]  Edit/reference a video (Grok does not support video refs)
  video status <taskId>                                      Check video status
  video status --snapshot <snapshotId> [--wait]              Check v2 video snapshot
`);
  } else if (topic === 'music') {
    if (subtopic === 'create') console.log('Usage: makaron music create [--vocals] [--style "genre"] "description"');
    else if (subtopic === 'status') console.log('Usage: makaron music status <taskId>');
    else console.log(`Music commands:
  music create [--vocals] [--style "genre"] "description"    Generate music
  music status <taskId>                                      Check music status
`);
  } else if (topic === 'admin') {
    if (subtopic === 'skills') console.log('Usage: makaron admin skills [--json|add|update|delete] ...');
    else if (subtopic === 'skill-categories') console.log('Usage: makaron admin skill-categories [--json|add|update|delete] ...');
    else if (subtopic === 'upload') console.log('Usage: makaron admin upload <local-file> <storage-path>');
    else if (subtopic === 'fetch-skill') console.log('Usage: makaron admin fetch-skill <share-code|url>');
    else if (subtopic === 'set-admin') console.log('Usage: makaron admin set-admin <email>');
    else console.log(`Admin commands:
  admin skills                         List all marketplace skills
  admin skills add '<json>'            Add a new skill
  admin skills update <id> '<json>'    Update a skill
  admin skills delete <id>             Delete a skill
  admin skill-categories               List marketplace categories
  admin skill-categories add '<json>'  Add a category
  admin skill-categories update <id> '<json>'
  admin skill-categories delete <id>   Delete a category
  admin upload <file> <storage-path>   Upload file to Storage
  admin fetch-skill <code|url>         Download skill from share link
  admin set-admin <email>              Grant admin access to a user
`);
  } else if (topic === 'register') {
    if (subtopic === '--verify') console.log('Usage: makaron register --verify --challenge-id <id> --answer <number>');
    else console.log('Usage: makaron register --json | makaron register --verify --challenge-id <id> --answer <number>');
  } else if (topic === 'claim') {
    console.log('Usage: makaron claim');
  } else {
    printRootHelp();
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

await maybeNotifyUpdate(command, args);

if (!command || command === '--help' || command === '-h' || command === 'help') {
  printRootHelp();
} else if (hasHelpFlag(args)) {
  printHelp(command, args[1]);
} else if (command === '--version' || command === '-v' || command === 'version') {
  console.log(getCliVersion());
} else if (command === 'setup') {
  setupMakaron(args.slice(1));
} else if (command === 'install-skill') {
  installAgentSkill(args.slice(1));
} else if (command === 'login') {
  await login();
} else if (command === 'credits' || command === 'credit' || command === 'balance') {
  const { headers, baseUrl } = getAuth();
  const res = await fetch(`${baseUrl}/api/billing/credits`, { headers });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const message = data?.error || data?.message || (res.ok ? 'Invalid response' : `HTTP ${res.status}`);
    process.stderr.write(`Failed to get credits: ${message}\n`);
    process.exit(1);
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify(data));
  } else {
    console.log(`Credits: ${data.balance ?? 0}`);
    console.log(`Lifetime purchased: ${data.lifetimePurchased ?? 0}`);
    console.log(`Lifetime used: ${data.lifetimeUsed ?? 0}`);
    if (data.subscription) {
      const plan = data.subscription.planId || 'unknown';
      const status = data.subscription.status ? ` (${data.subscription.status})` : '';
      console.log(`Subscription: ${plan}${status}`);
    } else {
      console.log('Subscription: none');
    }
  }
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
  const chatAudios = [];
  const promptParts = [];
  let useStream = false;
  let background = false;
  let jsonOutput = false;
  let activeSkill = undefined;
  let videoResolution = undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) projectId = args[++i];
    else if (args[i] === '--image' && args[i + 1]) chatImages.push(args[++i]);
    else if (args[i] === '--video' && args[i + 1]) chatVideos.push(args[++i]);
    else if (args[i] === '--audio' && args[i + 1]) chatAudios.push(args[++i]);
    else if (args[i] === '--skill' && args[i + 1]) activeSkill = args[++i];
    else if (args[i].startsWith('--skill=')) activeSkill = args[i].slice('--skill='.length);
    else if (args[i] === '--stream') useStream = true;
    else if (args[i] === '--background' || args[i] === '-b') background = true;
    else if (args[i] === '--json') jsonOutput = true;
    else if (args[i] === '--video-resolution' && args[i + 1]) videoResolution = args[++i];
    else if (
      ['--agent-model', '--image-model', '--video-model', '--model'].includes(args[i])
      || ['--agent-model=', '--image-model=', '--video-model=', '--model='].some(prefix => args[i].startsWith(prefix))
    ) {
      const flag = args[i].split('=')[0];
      process.stderr.write(`❌ makaron chat chooses agent, image, and video models automatically. Remove ${flag} and retry.\n`);
      process.exit(1);
    }
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
  const prevalidatedAudioUrlList = chatAudios.filter(p => p.startsWith('http://') || p.startsWith('https://'));
  const prevalidatedAudioFileList = chatAudios.filter(p => !p.startsWith('http://') && !p.startsWith('https://'));
  const prevalidatedVideoMetas = new Map();
  for (const videoPath of prevalidatedVideoFileList) {
    const valid = validateVideoFile(videoPath);
    if (!valid.ok) {
      process.stderr.write(`❌ ${valid.error}\n`);
      process.exit(1);
    }
    prevalidatedVideoMetas.set(videoPath, valid.meta);
  }
  const prevalidatedAudioMetas = new Map();
  for (const audioUrl of prevalidatedAudioUrlList) {
    const valid = validateAudioReferenceUrl(audioUrl);
    if (!valid.ok) {
      process.stderr.write(`❌ ${valid.error}\n`);
      process.exit(1);
    }
    const probed = await probeAudioReferenceUrl(audioUrl);
    if (!probed.ok) {
      process.stderr.write(`❌ ${probed.error}\n`);
      process.exit(1);
    }
    if (probed.warning) process.stderr.write(`⚠️ ${probed.warning}\n`);
    prevalidatedAudioMetas.set(audioUrl, { ...valid, ...probed });
  }
  for (const audioPath of prevalidatedAudioFileList) {
    const valid = validateAudioReferenceFile(audioPath);
    if (!valid.ok) {
      process.stderr.write(`❌ ${valid.error}\n`);
      process.exit(1);
    }
    prevalidatedAudioMetas.set(audioPath, valid);
  }
  if (useStream && chatAudios.length > 0) {
    process.stderr.write('❌ --audio is supported in the default async chat path. Remove --stream and retry.\n');
    process.exit(1);
  }

  let uploadedTurnMediaCount = 0;
  let uploadedTurnVideoCount = 0;

  // --project auto: create a new project (with images/videos if provided)
  if (!projectId || projectId === 'auto') {
    // Create an empty project first, then attach media by URL. Local images use
    // signed upload URLs so the agent never depends on the caller's filesystem.
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
  }
  // Upload additional images to existing project
  if (imageFileList.length > 0 || imageUrlList.length > 0) {
    const uploadedImageUrls = imageFileList.length
      ? await uploadImageFilesViaSignedUrl(baseUrl, headers, projectId, imageFileList)
      : [];
    const allImageUrls = [...uploadedImageUrls, ...imageUrlList];
    if (imageUrlList.length) process.stderr.write(`📤 Attaching ${imageUrlList.length} URL image(s)...\n`);
    const body = { _addToProject: projectId };
    if (allImageUrls.length) body.imageUrls = allImageUrls;
    const res = await fetch(`${baseUrl}/api/projects/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      const addedCount = data.snapshots?.length || 0;
      if (addedCount < allImageUrls.length) {
        process.stderr.write(`❌ Added only ${addedCount}/${allImageUrls.length} image(s) to project; aborting run.\n`);
        process.exit(1);
      }
      process.stderr.write(`📤 Added ${addedCount} image(s) to project\n`);
      uploadedTurnMediaCount += addedCount;
    } else {
      process.stderr.write(`❌ Failed to add images: ${await res.text()}\n`);
      process.exit(1);
    }
    chatImages.length = 0;
    imageUrlList.length = 0;
    imageFileList.length = 0;
  }

  const resolvedSkill = await resolveChatSkill(baseUrl, headers, activeSkill);

  // Upload videos to project timeline (via /api/projects/create with videoUrls)
  let finalPrompt = resolvedSkill ? `[Active skill: ${resolvedSkill}]\n${prompt}` : prompt;
  let audioAttachments = [];
  if (chatAudios.length > 0) {
    const audioImports = [];
    for (const audioUrl of prevalidatedAudioUrlList) {
      const valid = prevalidatedAudioMetas.get(audioUrl);
      audioImports.push({
        audioUrl,
        title: titleFromAudioInput(audioUrl),
        mimeType: valid.mime,
        fileSizeBytes: valid.fileSizeBytes,
        source: 'cli_url',
      });
    }
    for (const audioPath of prevalidatedAudioFileList) {
      const valid = prevalidatedAudioMetas.get(audioPath);
      process.stderr.write(`🎵 Uploading ${path.basename(audioPath)} (${(fs.statSync(audioPath).size / 1024 / 1024).toFixed(1)}MB)...\n`);
      const url = await uploadFileViaSignedUrl(baseUrl, headers, projectId, audioPath, valid.mime, { uploadKind: 'audio' });
      if (!url) {
        process.stderr.write(`❌ Failed to upload audio: ${audioPath}\n`);
        process.exit(1);
      }
      audioImports.push({
        audioUrl: url,
        title: titleFromAudioInput(audioPath),
        duration: valid.meta.duration,
        mimeType: valid.mime,
        fileSizeBytes: valid.meta.fileSizeBytes,
        source: 'cli_upload',
      });
      process.stderr.write(`🎵 Uploaded: ${path.basename(audioPath)}\n`);
    }

    const imported = await importAudioTracks(baseUrl, headers, projectId, audioImports);
    audioAttachments = (imported.tracks || []).map(track => ({
      audioUrl: track.audioUrl,
      title: track.title,
      duration: track.duration,
      trackIndex: track.trackIndex,
    }));
    process.stderr.write(`🎵 Imported ${audioAttachments.length} reference audio track(s)\n`);
  }

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
        uploadedTurnVideoCount += videoSnaps.length;
        uploadedTurnMediaCount += videoSnaps.length;
      } else {
        process.stderr.write(`⚠️ Failed to add videos: ${await res.text()}\n`);
      }
    }

  }

  if (useStream) {
    // Legacy SSE mode
    const { results } = await streamAgent(baseUrl, headers, projectId, finalPrompt, {
      videoResolution,
      uploadedVideoCount: uploadedTurnVideoCount,
      turnMediaCount: uploadedTurnMediaCount,
    });
    process.stderr.write('\n━━━ Results ━━━\n');
    for (const img of results.images) process.stderr.write(`🖼️  Image: ${img.imageUrl}\n`);
    for (const d of results.designs) process.stderr.write(`🎨  ${d.desc}\n`);
    process.stderr.write(`🔗  ${APP_URL}/projects/${projectId}\n`);
    for (const task of results.animationTasks) await pollVideo(baseUrl, headers, task.taskId, task.snapshotId);
    for (const task of results.musicTasks) await pollMusic(baseUrl, headers, task.taskId);
  } else {
    // Default: fire-and-forget + poll
    const { runId } = await submitRun(baseUrl, headers, projectId, finalPrompt, {
      videoResolution,
      audioAttachments,
      uploadedVideoCount: uploadedTurnVideoCount,
      turnMediaCount: uploadedTurnMediaCount,
    });
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
    if (!runId) { console.error('Usage: makaron responses get <runId> [--wait] [--json] [--pick <field>] [--materialize|--export-compositions]'); process.exit(1); }
    let wait = false, jsonOutput = false, pick = null, exportCompositions = false, publishExports = false;
    for (let i = 3; i < args.length; i++) {
      if (args[i] === '--wait') wait = true;
      if (args[i] === '--json') jsonOutput = true;
      if (args[i] === '--export-compositions') exportCompositions = true;
      if (args[i] === '--materialize') {
        exportCompositions = true;
        publishExports = true;
      }
      if (args[i] === '--publish-exports') publishExports = true;
      if (args[i] === '--pick' && args[i + 1]) pick = args[++i];
    }

    if (wait) {
      const data = await pollRun(baseUrl, headers, runId, {
        json: true,
        exportCompositions,
        publishExports,
        returnDataOnly: !!pick || !jsonOutput,
      });
      if (pick) {
        const picked = applyPick(data, pick);
        if (picked !== undefined) console.log(typeof picked === 'string' ? picked : JSON.stringify(picked));
      } else if (!jsonOutput) {
        console.log(JSON.stringify(data, null, 2));
      }
    } else {
      const res = await fetch(`${baseUrl}/api/agent/run/${runId}`, { headers });
      if (!res.ok) { process.stderr.write(`Error ${res.status}: ${await res.text()}\n`); process.exit(1); }
      let data = await res.json();
      normalizeRunResponse(data);
      if (exportCompositions && data.status === 'completed') {
        data = await exportAnimatedCompositionsFromRun(baseUrl, headers, data, { publish: publishExports, quiet: jsonOutput || !!pick });
      }
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
  responses get <runId> --export-compositions --wait --pick first_video_url
                                            Export animated compositions before picking video URL
  responses get <runId> --materialize --wait --pick first_video_url
                                            Export and publish animated compositions as MP4
  responses watch <runId> --jsonl        Watch until done (incremental events)
  responses list --project <id>          List runs for a project
`);
  }
} else if (command === 'list' || command === 'ls') {
  const { headers, baseUrl } = getAuth();
  await listProjects(baseUrl, headers);
} else if (command === 'materialize') {
  const { headers, baseUrl } = getAuth();
  const opts = { wait: true, publish: true, json: false, outputType: 'video', renderProfile: 'fast_720p', pick: null, quiet: false };
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) opts.projectId = args[++i];
    else if (args[i] === '--media' && args[i + 1]) opts.mediaIndex = Number(args[++i]);
    else if (args[i] === '--snapshot' && args[i + 1]) opts.snapshotId = args[++i];
    else if (args[i] === '--design-path' && args[i + 1]) opts.designPath = args[++i];
    else if (args[i] === '--design-json' && args[i + 1]) opts.design = readJsonInput(args[++i]);
    else if (args[i] === '--name' && args[i + 1]) opts.name = args[++i];
    else if (args[i] === '--type' && args[i + 1]) opts.outputType = args[++i];
    else if (args[i] === '--profile' && args[i + 1]) opts.renderProfile = args[++i];
    else if (args[i] === '--render-profile' && args[i + 1]) opts.renderProfile = args[++i];
    else if (args[i] === '--no-publish') opts.publish = false;
    else if (args[i] === '--publish') opts.publish = true;
    else if (args[i] === '--no-wait') opts.wait = false;
    else if (args[i] === '--wait') opts.wait = true;
    else if (args[i] === '--json') opts.json = true;
    else if (args[i] === '--pick' && args[i + 1]) opts.pick = args[++i];
  }
  if (opts.pick) opts.quiet = true;
  const data = await exportComposition(baseUrl, headers, opts);
  if (opts.pick) {
    const picked = pickExportValue(data, opts.pick);
    if (picked !== undefined) console.log(typeof picked === 'string' ? picked : JSON.stringify(picked));
  }
} else if (command === 'composition' || command === 'compositions') {
  const { headers, baseUrl } = getAuth();
  const sub = args[1];
  if (sub === 'export') {
    const opts = { wait: false, publish: false, json: false, outputType: 'video', renderProfile: 'fast_720p', pick: null, quiet: false };
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--project' && args[i + 1]) opts.projectId = args[++i];
      else if (args[i] === '--media' && args[i + 1]) opts.mediaIndex = Number(args[++i]);
      else if (args[i] === '--snapshot' && args[i + 1]) opts.snapshotId = args[++i];
      else if (args[i] === '--design-path' && args[i + 1]) opts.designPath = args[++i];
      else if (args[i] === '--design-json' && args[i + 1]) opts.design = readJsonInput(args[++i]);
      else if (args[i] === '--name' && args[i + 1]) opts.name = args[++i];
      else if (args[i] === '--type' && args[i + 1]) opts.outputType = args[++i];
      else if (args[i] === '--profile' && args[i + 1]) opts.renderProfile = args[++i];
      else if (args[i] === '--render-profile' && args[i + 1]) opts.renderProfile = args[++i];
      else if (args[i] === '--publish') opts.publish = true;
      else if (args[i] === '--wait') opts.wait = true;
      else if (args[i] === '--json') opts.json = true;
      else if (args[i] === '--pick' && args[i + 1]) opts.pick = args[++i];
    }
    if (opts.pick) opts.quiet = true;
    const data = await exportComposition(baseUrl, headers, opts);
    if (opts.pick) {
      const picked = pickExportValue(data, opts.pick);
      if (picked !== undefined) console.log(typeof picked === 'string' ? picked : JSON.stringify(picked));
    }
  } else if (sub === 'status') {
    const jobId = args[2];
    if (!jobId) { console.error('Usage: makaron composition status <jobId> [--wait] [--json]'); process.exit(1); }
    const wait = args.includes('--wait');
    const json = args.includes('--json');
    if (wait) await pollRemotionExport(baseUrl, headers, jobId, { json });
    else {
      const res = await fetch(`${baseUrl}/api/remotion/export/${jobId}`, { headers });
      if (!res.ok) { process.stderr.write(`Export status failed ${res.status}: ${await res.text()}\n`); process.exit(1); }
      const data = await res.json();
      if (json) console.log(JSON.stringify(data, null, 2));
      else console.log(`${data.id}  ${data.status}  ${data.url || ''}`);
      if (data.status === 'failed') process.exit(1);
    }
  } else {
    console.log(`Composition commands:
  composition export --project <id> --media <N> --wait
  composition export --project <id> --snapshot <snapshotId> --wait
  composition export --project <id> --design-path <path> --wait
  composition export --project <id> --design-json composition.json --wait
  composition status <jobId> [--wait] [--json]
`);
  }
} else if (command === 'skills') {
  const sub = args[1] || 'list';
  const baseUrl = process.env.MAKARON_URL || DEFAULT_URL;
  const jsonOutput = args.includes('--json');

  if (sub === 'list') {
    const builtIn = args.includes('--built-in');
    const skills = builtIn ? await fetchBuiltInSkills(baseUrl) : await fetchMarketplaceSkills(baseUrl);
    if (jsonOutput) console.log(JSON.stringify({ skills }, null, 2));
    else if (builtIn) printBuiltInSkills(skills);
    else printMarketplaceSkills(skills);
  } else if (sub === 'search') {
    const query = args.filter((arg, index) => index > 1 && arg !== '--json').join(' ').trim();
    if (!query) { console.error('Usage: makaron skills search <query> [--json]'); process.exit(1); }
    const lowerQuery = query.toLowerCase();
    const slugQuery = slugifySkill(query);
    const skills = (await fetchMarketplaceSkills(baseUrl))
      .filter(skill => {
        const rawMatch = marketplaceSkillTokens(skill).some(token => token.includes(lowerQuery));
        const slugMatch = slugQuery ? marketplaceSearchText(skill).includes(slugQuery) : false;
        return rawMatch || slugMatch;
      });
    if (jsonOutput) console.log(JSON.stringify({ skills }, null, 2));
    else printMarketplaceSkills(skills);
  } else if (sub === 'show') {
    const identifier = args[2];
    if (!identifier) { console.error('Usage: makaron skills show <id|label> [--built-in] [--json]'); process.exit(1); }
    const builtIn = args.includes('--built-in');
    const skills = builtIn ? await fetchBuiltInSkills(baseUrl) : await fetchMarketplaceSkills(baseUrl);
    const skill = builtIn
      ? skills.find(candidate => candidate.name === identifier || candidate.label?.toLowerCase() === identifier.toLowerCase())
      : findMarketplaceSkill(skills, identifier);
    if (!skill) { console.error(`Skill not found: ${identifier}`); process.exit(1); }
    if (jsonOutput) console.log(JSON.stringify(skill, null, 2));
    else if (builtIn) printBuiltInSkills([skill]);
    else printMarketplaceSkill(skill);
  } else if (sub === 'install') {
    const identifier = args[2];
    if (!identifier) { console.error('Usage: makaron skills install <marketplace-id|label> [--json]'); process.exit(1); }
    const { headers, baseUrl: authedBaseUrl } = getAuth();
    const skills = await fetchMarketplaceSkills(authedBaseUrl);
    const skill = findMarketplaceSkill(skills, identifier);
    if (!skill) { console.error(`Skill not found: ${identifier}`); process.exit(1); }
    const data = await installMarketplaceSkill(authedBaseUrl, headers, skill, { quiet: jsonOutput });
    if (jsonOutput) console.log(JSON.stringify({ ...data, marketplaceId: skill.id, label: skill.label }, null, 2));
    else console.log(data.skillName);
  } else {
    console.log(`Skill commands:
  skills list --built-in              List all built-in Makaron skills and Studio Run recipes
  skills list                         List marketplace skills
  skills search <query>               Search marketplace skills
  skills show <id|label> --built-in   Show a built-in skill
  skills show <id|label>              Show a marketplace skill
  skills install <id|label>           Install a marketplace skill to your workspace
`);
  }
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
    else if (args[i] === '--image-model' && args[i + 1]) editArgs.model = args[++i];
    else if (args[i] === '--model' && args[i + 1]) {
      warnLegacyModelFlag('--image-model');
      editArgs.model = args[++i];
    }
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
  if (!editArgs.editPrompt) { console.error('Usage: makaron edit [--image <file|url>] [--image-model gemini|gemini-lite|qwen|openai|pony|wai] [--ref <file>] [--out <file>] "prompt"'); process.exit(1); }
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
    let script = '', duration = undefined, aspectRatio = undefined, videoModel = undefined, videoResolution = undefined, wait = false;
    let video = null, keepOriginalSound = false;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--image' && args[i + 1]) images.push(args[++i]);
      else if (args[i] === '--video' && args[i + 1]) video = args[++i];
      else if (args[i] === '--script' && args[i + 1]) script = args[++i];
      else if (args[i] === '--script-file' && args[i + 1]) script = fs.readFileSync(args[++i], 'utf-8');
      else if (args[i] === '--duration' && args[i + 1]) duration = Number(args[++i]);
      else if (args[i] === '--aspect' && args[i + 1]) aspectRatio = args[++i];
      else if (args[i] === '--video-model' && args[i + 1]) videoModel = args[++i];
      else if (args[i] === '--model' && args[i + 1]) {
        warnLegacyModelFlag('--video-model');
        videoModel = args[++i];
      }
      else if (args[i] === '--video-resolution' && args[i + 1]) videoResolution = args[++i];
      else if (args[i] === '--resolution' && args[i + 1]) videoResolution = args[++i];
      else if (args[i] === '--keep-original-sound') keepOriginalSound = true;
      else if (args[i] === '--project') {
        console.error('Usage: video create no longer supports --project. Use: makaron chat --project <id> --video <file|url> "your request"');
        process.exit(1);
      }
      else if (args[i] === '--wait') wait = true;
    }
    const selectedVideoModel = videoModel || 'seedance-fast';
    const supportsNativeTextToVideo = selectedVideoModel === 'seedance-fast' || selectedVideoModel === 'seedance-mini' || selectedVideoModel === 'seedance' || selectedVideoModel === 'minimax-h3';
    if (!script || (!images.length && !video && !supportsNativeTextToVideo)) {
      console.error('Usage: makaron video create --script "..." [--image <url> | --video <public-url>] [--duration 10] [--aspect 9:16] [--video-model seedance-fast|seedance-mini|seedance|kling|grok|google-omni|minimax-h3] [--video-resolution auto|480p|720p|768p|1080p|2k|4k] [--keep-original-sound]');
      process.exit(1);
    }

    if (wait) {
      console.error('Usage: --wait is only supported for project timeline tasks. Use chat --project for project video generation, or poll the returned taskId with video status.');
      process.exit(1);
    }

    let videoUrl = isHttpUrl(video) ? video : null;
    let inputVideoMeta = null;
    if (videoUrl) {
      process.stderr.write(`📹 Assuming public video URL already matches provider reference limits. Seedance requires ≤${MAX_VIDEO_PROVIDER_REFERENCE_DURATION}s, ≤50MB, sides 300-6000px, frame pixels 409,600-${MAX_VIDEO_FRAME_PIXELS}; Kling requires ≤200MB and ≤2K; Google Omni accepts one reference video in Makaron; Grok does not support video references.\n`);
    }
    if (video && !videoUrl) {
      const valid = validateVideoFile(video, {
        maxDuration: MAX_VIDEO_PROVIDER_REFERENCE_DURATION,
        durationTolerance: MAX_VIDEO_PROVIDER_REFERENCE_DURATION_TOLERANCE,
        ...(selectedVideoModel === 'seedance' || selectedVideoModel === 'seedance-fast' || selectedVideoModel === 'seedance-mini' || selectedVideoModel === 'minimax-h3' ? {
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
      ? { videoUrl, editPrompt: script, images, videoModel: selectedVideoModel, videoResolution, referType: (selectedVideoModel === 'seedance' || selectedVideoModel === 'seedance-fast' || selectedVideoModel === 'seedance-mini' || selectedVideoModel === 'minimax-h3') ? 'feature' : 'base' }
      : { script, images, videoModel: selectedVideoModel, videoResolution };
    const effectiveDuration = duration || (inputVideoMeta?.duration ? Math.min(MAX_VIDEO_PROVIDER_REFERENCE_DURATION, Math.round(inputVideoMeta.duration)) : undefined);
    if (effectiveDuration) vArgs.duration = effectiveDuration;
    if (aspectRatio) vArgs.aspectRatio = aspectRatio;
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
  video create --script "..." --video-model seedance-fast    Native text-to-video (no image required)
  video create --script "..." --video-model minimax-h3 --video-resolution 2k    MiniMax H3 native 2K text-to-video
  video create --script "..." --image <url> [--duration 10]  Submit video task
  video create --script "..." --video <public-url> [--video-model seedance-fast|seedance-mini|seedance|kling|google-omni|minimax-h3]  Edit/reference a video (Grok does not support video refs)
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
    const action = args[2] === '--json' ? null : args[2]; // add, update, delete, or none (list)
    if (!action) {
      // List all skills
      const res = await fetch(`${baseUrl}/api/admin/home-skills`, { headers });
      if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); process.exit(1); }
      const skills = await res.json();
      if (args.includes('--json')) {
        console.log(JSON.stringify(skills, null, 2));
        process.exit(0);
      }
      console.log(`📋 ${skills.length} skills\n`);
      for (const s of skills) {
        const label = s.labels?.en || s.labels?.zh || '(no label)';
        const active = s.is_active ? '✅' : '❌';
        const hasZip = s.skill_path ? '📦' : '  ';
        const categories = Array.isArray(s.categories) && s.categories.length ? s.categories.join(',') : 'uncategorized';
        console.log(`  ${active} ${hasZip} ${String(s.sort_order).padStart(3)}  ${s.id}  ${label}  [${categories}]  title ${localizedCoverage(s.labels)}/4 · prompt ${localizedCoverage(s.prompts)}/4`);
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

  } else if (sub === 'skill-categories') {
    const action = args[2] === '--json' ? null : args[2];
    if (!action) {
      const res = await fetch(`${baseUrl}/api/admin/skill-categories`, { headers });
      if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); process.exit(1); }
      const categories = await res.json();
      if (args.includes('--json')) {
        console.log(JSON.stringify(categories, null, 2));
        process.exit(0);
      }
      console.log(`📂 ${categories.length} skill categories\n`);
      for (const category of categories) {
        const label = category.labels?.en || category.labels?.zh || category.id;
        const active = category.is_active ? '✅' : '❌';
        const icon = category.icon || ' ';
        console.log(`  ${active} ${icon} ${String(category.sort_order).padStart(3)}  ${category.id}  ${label}  title ${localizedCoverage(category.labels)}/4`);
      }
    } else if (action === 'add') {
      const json = args.slice(3).join(' ');
      if (!json) { console.error('Usage: makaron admin skill-categories add \'{"id":"...","labels":{...}}\''); process.exit(1); }
      let body;
      try { body = JSON.parse(json); } catch { console.error('Invalid JSON'); process.exit(1); }
      const res = await fetch(`${baseUrl}/api/admin/skill-categories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
      });
      if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); process.exit(1); }
      const data = await res.json();
      console.log(`✅ Skill category created: ${data.id}`);
    } else if (action === 'update') {
      const id = args[3];
      const json = args.slice(4).join(' ');
      if (!id || !json) { console.error('Usage: makaron admin skill-categories update <id> \'{"field":"value"}\''); process.exit(1); }
      let body;
      try { body = JSON.parse(json); } catch { console.error('Invalid JSON'); process.exit(1); }
      body.id = id;
      const res = await fetch(`${baseUrl}/api/admin/skill-categories`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
      });
      if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); process.exit(1); }
      console.log(`✅ Skill category ${id} updated`);
    } else if (action === 'delete') {
      const id = args[3];
      if (!id) { console.error('Usage: makaron admin skill-categories delete <id>'); process.exit(1); }
      const res = await fetch(`${baseUrl}/api/admin/skill-categories`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ id }),
      });
      if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); process.exit(1); }
      console.log(`✅ Skill category ${id} deleted`);
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
  admin skill-categories               List marketplace categories
  admin skill-categories add '<json>'  Add a category
  admin skill-categories update <id> '<json>'
  admin skill-categories delete <id>   Delete a category
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
  printRootHelp();
}
