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

async function streamAgent(baseUrl, cookie, projectId, prompt) {
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
  });

  if (!res.ok) {
    console.error(`Error ${res.status}:`, await res.text());
    process.exit(1);
  }

  const runId = res.headers.get('X-Agent-Run-Id');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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

      if (data.status === 'completed' || data.audioUrl) {
        process.stderr.write(`\r🎵 Music done (${elapsed}s): ${data.audioUrl}\n`);
        return data.audioUrl;
      }
      if (data.streamAudioUrl && elapsed > 20) {
        process.stderr.write(`\r🎵 Music streaming: ${data.streamAudioUrl}\n`);
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
  if (opts.imageUrl) {
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
  console.log(`   Image: ${data.imageUrl}`);
  console.log(`   URL: ${data.projectUrl}`);
  return data;
}

// ─── Status ──────────────────────────────────────────────────────────────────

async function showStatus(baseUrl, cookie, projectId) {
  // Quick status via snapshots count from a run query
  const res = await fetch(`${baseUrl}/api/agent/run?projectId=${projectId}`, {
    headers: { 'Cookie': cookie },
  });
  // Fallback: just print project URL
  console.log(`🔗 ${APP_URL}/projects/${projectId}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

if (command === 'login') {
  await login();
} else if (command === 'create') {
  const { cookie, baseUrl } = getAuthCookie();
  const opts = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--image' && args[i + 1]) opts.image = args[++i];
    else if (args[i] === '--image-url' && args[i + 1]) opts.imageUrl = args[++i];
    else if (args[i] === '--title' && args[i + 1]) opts.title = args[++i];
  }
  if (!opts.image && !opts.imageUrl) {
    console.error('Usage: makaron create --image <file> or --image-url <url>');
    process.exit(1);
  }
  await createProject(baseUrl, cookie, opts);
} else if (command === 'chat') {
  const { cookie, baseUrl } = getAuthCookie();
  let projectId = null;
  const promptParts = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) projectId = args[++i];
    else promptParts.push(args[i]);
  }
  const prompt = promptParts.join(' ');
  if (!projectId || !prompt) {
    console.error('Usage: makaron chat --project <id> "your message"');
    process.exit(1);
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
} else if (command === 'status') {
  const { cookie, baseUrl } = getAuthCookie();
  await showStatus(baseUrl, cookie, args[1]);
} else {
  console.log(`Makaron CLI

Commands:
  login                              Log in to Makaron
  create --image <file>              Create project from local image
  create --image-url <url>           Create project from URL
  chat --project <id> "message"      Chat with Makaron Agent
  status <projectId>                 Show project status

Environment:
  MAKARON_URL      API base URL (default: http://localhost:3000)
  MAKARON_APP_URL  App URL for project links (default: https://www.makaron.app)
`);
}
