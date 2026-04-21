#!/usr/bin/env node
/**
 * Makaron CLI — Talk to Makaron Agent from the terminal.
 *
 * Usage:
 *   npx tsx scripts/makaron-cli.mjs login
 *   npx tsx scripts/makaron-cli.mjs create --image photo.jpg
 *   npx tsx scripts/makaron-cli.mjs create --image-url https://...
 *   npx tsx scripts/makaron-cli.mjs chat --project <id> "make it look cinematic"
 *   npx tsx scripts/makaron-cli.mjs status <projectId>
 */

import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';

// ─── Config ──────────────────────────────────────────────────────────────────

const AUTH_FILE = path.join(process.env.HOME || '~', '.makaron', 'auth.json');
const BASE_URL = process.env.MAKARON_URL || 'http://localhost:3000';
const APP_URL = process.env.MAKARON_APP_URL || 'https://www.makaron.app';

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
  const url = tokenJson._supabaseUrl;
  const ref = url.match(/\/\/([^.]+)\./)?.[1] || '';
  const encoded = encodeURIComponent(JSON.stringify(tokenJson));
  return `sb-${ref}-auth-token=${encoded}`;
}

async function login() {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q) => new Promise(r => rl.question(q, r));

  const email = await ask('Email: ');
  const password = await ask('Password: ');
  const url = await ask(`Supabase URL [${BASE_URL}]: `) || BASE_URL;
  rl.close();

  // Need anon key — try .env.local or ask
  let anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!anonKey || !supabaseUrl) {
    // Try loading from .env.local
    try {
      const env = fs.readFileSync('.env.local', 'utf-8');
      for (const line of env.split('\n')) {
        if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) anonKey = line.split('=').slice(1).join('=').trim();
        if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) supabaseUrl = line.split('=').slice(1).join('=').trim();
      }
    } catch { /* no .env.local */ }
  }

  if (!anonKey || !supabaseUrl) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_ANON_KEY and NEXT_PUBLIC_SUPABASE_URL required');
    process.exit(1);
  }

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
  tokenJson._baseUrl = url;
  saveAuth(tokenJson);
  console.error(`✅ Logged in as ${email}`);
  console.error(`   Token saved to ${AUTH_FILE}`);
}

function getAuthCookie() {
  const auth = loadAuth();
  if (!auth) {
    console.error('Not logged in. Run: npx tsx scripts/makaron-cli.mjs login');
    process.exit(1);
  }
  return { cookie: buildCookie(auth), baseUrl: auth._baseUrl || BASE_URL };
}

// ─── SSE Consumer ────────────────────────────────────────────────────────────

async function abortRun(baseUrl, cookie, runId) {
  try {
    await fetch(`${baseUrl}/api/agent/abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ runId }),
    });
  } catch { /* best effort */ }
}

async function streamAgent(baseUrl, cookie, projectId, prompt) {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
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

  const sigintHandler = async () => {
    process.stderr.write('\n⏹️  Aborting...\n');
    controller.abort();
    if (runId) await abortRun(baseUrl, cookie, runId);
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
          if (event.input?.editPrompt) process.stderr.write(`: ${event.input.editPrompt.substring(0, 80)}`);
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
  // Final newline after streamed text
  if (results.text) process.stdout.write('\n');

  return { runId, results };
}

// ─── Async Task Polling ──────────────────────────────────────────────────────

async function pollVideo(baseUrl, cookie, taskId) {
  process.stderr.write(`🎬 Waiting for video ${taskId}...\n`);
  const start = Date.now();

  while (true) {
    await new Promise(r => setTimeout(r, 10_000));
    const elapsed = Math.round((Date.now() - start) / 1000);

    try {
      const res = await fetch(`${baseUrl}/api/animate/${taskId}`, {
        headers: { 'Cookie': cookie },
      });
      if (!res.ok) continue;
      const data = await res.json();

      if (data.videoUrl) {
        process.stderr.write(`\r🎬 Video done (${elapsed}s): ${data.videoUrl}\n`);
        return data.videoUrl;
      }
      if (data.status === 'failed') {
        process.stderr.write(`\r🎬 Video failed (${elapsed}s)\n`);
        return null;
      }
      process.stderr.write(`\r🎬 Video rendering... ${elapsed}s`);
    } catch { /* retry */ }

    if (elapsed > 600) {
      process.stderr.write(`\r🎬 Video timeout (${elapsed}s)\n`);
      return null;
    }
  }
}

async function pollMusic(baseUrl, cookie, taskId) {
  process.stderr.write(`🎵 Waiting for music ${taskId}...\n`);
  const start = Date.now();

  while (true) {
    await new Promise(r => setTimeout(r, 5_000));
    const elapsed = Math.round((Date.now() - start) / 1000);

    try {
      const res = await fetch(`${baseUrl}/api/music/${taskId}`, {
        headers: { 'Cookie': cookie },
      });
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
      if (streamUrl && elapsed > 20) {
        process.stderr.write(`\r🎵 Music streaming: ${streamUrl}\n`);
      }
      if (data.status === 'failed') {
        process.stderr.write(`\r🎵 Music failed (${elapsed}s)\n`);
        return null;
      }
      process.stderr.write(`\r🎵 Music generating... ${elapsed}s`);
    } catch { /* retry */ }

    if (elapsed > 300) {
      process.stderr.write(`\r🎵 Music timeout (${elapsed}s)\n`);
      return null;
    }
  }
}

// ─── Create Project ──────────────────────────────────────────────────────────

async function createProject(baseUrl, cookie, opts) {
  const body = {};

  // Multiple images support
  if (opts.imageUrls?.length) {
    body.imageUrls = opts.imageUrls;
  } else if (opts.images?.length) {
    body.imageBase64s = opts.images.map(f => {
      const buf = fs.readFileSync(f);
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    });
  } else if (opts.imageUrl) {
    body.imageUrl = opts.imageUrl;
  } else if (opts.image) {
    const buf = fs.readFileSync(opts.image);
    body.imageBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
  if (opts.title) body.title = opts.title;

  const res = await fetch(`${baseUrl}/api/projects/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error('Create failed:', await res.text());
    process.exit(1);
  }

  const data = await res.json();
  console.log(`✅ Project created`);
  console.log(`   ID: ${data.projectId}`);
  if (data.snapshots) {
    console.log(`   Images: ${data.snapshots.length}`);
    data.snapshots.forEach((s, i) => console.log(`   [${i + 1}] ${s.imageUrl}`));
  } else if (data.imageUrl) {
    console.log(`   Image: ${data.imageUrl}`);
  }
  console.log(`   URL: ${data.projectUrl}`);
  return data;
}

// ─── List Projects ───────────────────────────────────────────────────────────

async function listProjects(baseUrl, cookie) {
  const res = await fetch(`${baseUrl}/api/projects/list`, {
    headers: { 'Cookie': cookie },
  });
  if (!res.ok) {
    console.error('List failed:', await res.text());
    process.exit(1);
  }
  const { projects } = await res.json();
  if (!projects.length) {
    console.log('No projects yet. Create one with: makaron create --image <file>');
    return;
  }
  console.log(`📁 ${projects.length} projects\n`);
  for (const p of projects) {
    const age = timeSince(new Date(p.updatedAt));
    console.log(`  ${p.id}  ${p.title.padEnd(30)} ${String(p.snapshotCount).padStart(2)} snaps  ${age}`);
  }
  console.log('');
}

function timeSince(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ─── Status ──────────────────────────────────────────────────────────────────

async function showStatus(baseUrl, cookie, projectId) {
  if (!projectId) {
    console.error('Usage: makaron status <projectId>');
    process.exit(1);
  }
  // Get project info + recent runs
  const [projRes, runsRes] = await Promise.all([
    fetch(`${baseUrl}/api/projects/list`, { headers: { 'Cookie': cookie } }),
    fetch(`${baseUrl}/api/agent/run/${projectId}?events=false`, { headers: { 'Cookie': cookie } }).catch(() => null),
  ]);

  const { projects } = await projRes.json();
  const proj = projects?.find(p => p.id === projectId);
  if (proj) {
    console.log(`📁 ${proj.title} (${proj.snapshotCount} snapshots)`);
    console.log(`🔗 ${APP_URL}/projects/${projectId}`);
  } else {
    console.log(`🔗 ${APP_URL}/projects/${projectId}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

if (command === 'login') {
  await login();
} else if (command === 'create') {
  const { cookie, baseUrl } = getAuthCookie();
  const opts = { images: [], imageUrls: [] };
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--image' && args[i + 1]) opts.images.push(args[++i]);
    else if (args[i] === '--image-url' && args[i + 1]) opts.imageUrls.push(args[++i]);
    else if (args[i] === '--title' && args[i + 1]) opts.title = args[++i];
  }
  // Single image compat
  if (opts.images.length === 1) { opts.image = opts.images[0]; opts.images = []; }
  if (opts.imageUrls.length === 1) { opts.imageUrl = opts.imageUrls[0]; opts.imageUrls = []; }

  // Text-to-image: create empty project, then chat
  if (!opts.image && !opts.imageUrl && !opts.images.length && !opts.imageUrls.length) {
    if (!opts.title) {
      console.error('Usage: makaron create --image <file> [--image <file2>] or --title "project name"');
      process.exit(1);
    }
  }
  await createProject(baseUrl, cookie, opts);
} else if (command === 'chat') {
  const { cookie, baseUrl } = getAuthCookie();
  let projectId = null;
  const chatImages = [];
  const promptParts = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) projectId = args[++i];
    else if (args[i] === '--image' && args[i + 1]) chatImages.push(args[++i]);
    else promptParts.push(args[i]);
  }
  const prompt = promptParts.join(' ');
  if (!projectId || !prompt) {
    console.error('Usage: makaron chat --project <id> [--image <file>] "your message"');
    process.exit(1);
  }

  // Upload chat images as new snapshots before sending message
  if (chatImages.length > 0) {
    const base64s = chatImages.map(imgPath => {
      process.stderr.write(`📤 Uploading ${path.basename(imgPath)}...\n`);
      const buf = fs.readFileSync(imgPath);
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    });
    const res = await fetch(`${baseUrl}/api/projects/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ imageBase64s: base64s, _addToProject: projectId }),
    });
    if (res.ok) {
      const data = await res.json();
      const added = data.snapshots?.length || 0;
      process.stderr.write(`📤 Added ${added} image(s) to project\n`);
    } else {
      process.stderr.write(`⚠️ Failed to upload images: ${await res.text()}\n`);
    }
  }

  const { results } = await streamAgent(baseUrl, cookie, projectId, prompt);

  // Print summary
  process.stderr.write('\n━━━ Results ━━━\n');
  for (const img of results.images) {
    process.stderr.write(`🖼️  Image: ${img.imageUrl}\n`);
  }
  for (const d of results.designs) {
    process.stderr.write(`🎨  ${d.desc}\n`);
  }
  process.stderr.write(`🔗  ${APP_URL}/projects/${projectId}\n`);

  // Poll async tasks
  for (const task of results.animationTasks) {
    await pollVideo(baseUrl, cookie, task.taskId);
  }
  for (const task of results.musicTasks) {
    await pollMusic(baseUrl, cookie, task.taskId);
  }
} else if (command === 'list' || command === 'ls') {
  const { cookie, baseUrl } = getAuthCookie();
  await listProjects(baseUrl, cookie);
} else if (command === 'abort') {
  const { cookie, baseUrl } = getAuthCookie();
  const runId = args[1];
  if (!runId) { console.error('Usage: makaron abort <runId>'); process.exit(1); }
  const res = await fetch(`${baseUrl}/api/agent/abort`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ runId }),
  });
  if (res.ok) console.log(`✅ Run ${runId} aborted`);
  else console.error(`❌ Abort failed:`, await res.text());
} else if (command === 'status') {
  const { cookie, baseUrl } = getAuthCookie();
  await showStatus(baseUrl, cookie, args[1]);
} else {
  console.log(`Makaron CLI

Commands:
  login                              Log in to Makaron
  list (ls)                          List all projects
  create --image <file>              Create project from local image
  create --image-url <url>           Create project from URL
  chat --project <id> "message"      Chat with Makaron Agent
  abort <runId>                      Abort a running Agent
  status <projectId>                 Show project status

Environment:
  MAKARON_URL      API base URL (default: http://localhost:3000)
  MAKARON_APP_URL  App URL for project links (default: https://www.makaron.app)
`);
}
