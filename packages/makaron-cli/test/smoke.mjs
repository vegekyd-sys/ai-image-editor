import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';

const cliPath = new URL('../bin/makaron.mjs', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

const requests = [];

const server = http.createServer(async (req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  await new Promise(resolve => req.on('end', resolve));
  const rawBody = Buffer.concat(chunks).toString('utf-8');
  const body = rawBody ? JSON.parse(rawBody) : null;
  const url = new URL(req.url, 'http://127.0.0.1');
  requests.push({ method: req.method, pathname: url.pathname, search: url.search, body });

  const sendJson = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  if (req.method === 'POST' && url.pathname === '/api/projects/create') {
    sendJson(200, { projectId: 'project-auto-1', snapshots: [] });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/agent/run') {
    sendJson(200, { runId: 'run_mock_1' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/agent/run/run_mock_1') {
    sendJson(200, {
      id: 'run_mock_1',
      project_id: 'project-auto-1',
      status: 'completed',
      incomplete: false,
      output: [{ id: 'out_1', type: 'image', url: 'https://cdn.example/image.png' }],
      result: { images: [{ imageUrl: 'https://cdn.example/image.png' }] },
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/projects/project-auto-1/media') {
    sendJson(200, {
      projectId: 'project-auto-1',
      projectUrl: 'https://app.example/projects/project-auto-1',
      title: 'Mock Project',
      media: [
        {
          id: 'media_1',
          index: 1,
          ref: '<<<media_1>>>',
          type: 'image',
          status: 'completed',
          snapshot_id: 'snap_image_1',
          snapshotId: 'snap_image_1',
          url: 'https://cdn.example/source.jpg',
          description: 'Original upload',
        },
        {
          id: 'media_2',
          index: 2,
          ref: '<<<media_2>>>',
          type: 'video',
          status: 'completed',
          snapshot_id: 'snap_video_1',
          snapshotId: 'snap_video_1',
          url: 'https://cdn.example/video.mp4',
          posterUrl: 'https://cdn.example/poster.jpg',
          duration: 12.4,
          width: 720,
          height: 1280,
        },
      ],
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/video-snapshot/123e4567-e89b-12d3-a456-426614174000') {
    sendJson(200, { id: '123e4567-e89b-12d3-a456-426614174000', status: 'completed', videoUrl: 'https://cdn.example/video.mp4' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/agent/register') {
    sendJson(200, { challenge_id: 'challenge_1', question: '1 + 1', expires_at: '2099-01-01T00:00:00.000Z' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/agent/register/verify') {
    sendJson(200, { api_key: 'mk_test_key', credits: 10 });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/agent/claim') {
    sendJson(200, { claim_url: 'https://www.makaron.app/claim/mock' });
    return;
  }

  sendJson(404, { error: `unmocked ${req.method} ${url.pathname}` });
});

const baseUrl = await new Promise(resolve => {
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve(`http://127.0.0.1:${port}`);
  });
});

const tmpHome = mkdtempSync(path.join(os.tmpdir(), 'makaron-cli-smoke-'));

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath.pathname, ...args], {
      env: {
        ...process.env,
        HOME: tmpHome,
        MAKARON_URL: baseUrl,
        MAKARON_APP_URL: 'https://app.example',
        MAKARON_API_KEY: options.apiKey === false ? '' : 'mk_test_smoke',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function expectSuccess(args, options) {
  const result = await runCli(args, options);
  assert.equal(result.code, 0, `${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

try {
  {
    const result = await expectSuccess(['--version']);
    assert.equal(result.stdout.trim(), pkg.version);
  }

  {
    const result = await expectSuccess(['chat', '--project', 'auto', '--json', '-b', 'make a compact image']);
    const data = JSON.parse(result.stdout);
    assert.deepEqual(data, {
      runId: 'run_mock_1',
      projectId: 'project-auto-1',
      projectUrl: 'https://app.example/projects/project-auto-1',
      status: 'running',
    });
    const createRequest = requests.find(req => req.pathname === '/api/projects/create');
    assert.equal(createRequest?.body?.title, 'make a compact image');
    const runRequest = requests.find(req => req.pathname === '/api/agent/run');
    assert.equal(runRequest?.body?.projectId, 'project-auto-1');
    assert.equal(runRequest?.body?.prompt, 'make a compact image');
  }

  {
    const result = await expectSuccess(['responses', 'get', 'run_mock_1', '--json']);
    const data = JSON.parse(result.stdout);
    assert.equal(data.projectId, 'project-auto-1');
    assert.equal(data.projectUrl, 'https://app.example/projects/project-auto-1');
    assert.equal(data.status, 'completed');
  }

  {
    const result = await expectSuccess(['responses', 'get', 'run_mock_1', '--pick', 'project_url']);
    assert.equal(result.stdout.trim(), 'https://app.example/projects/project-auto-1');
  }

  {
    const result = await expectSuccess(['project', 'media', 'project-auto-1', '--json']);
    const data = JSON.parse(result.stdout);
    assert.equal(data.projectId, 'project-auto-1');
    assert.equal(data.media.length, 2);
    assert.equal(data.media[0].ref, '<<<media_1>>>');
    assert.equal(data.media[1].type, 'video');
    assert.equal(data.media[1].duration, 12.4);
    const mediaRequest = requests.find(req => req.pathname === '/api/projects/project-auto-1/media');
    assert.equal(mediaRequest?.method, 'GET');
  }

  {
    const result = await expectSuccess(['responses', 'get', 'run_mock_1', '--wait', '--json']);
    const data = JSON.parse(result.stdout);
    assert.equal(data.projectId, 'project-auto-1');
    assert.equal(data.projectUrl, 'https://app.example/projects/project-auto-1');
    assert.equal(data.status, 'completed');
  }

  {
    const result = await expectSuccess(['responses', 'watch', 'run_mock_1', '--jsonl', '--interval', '1']);
    const lines = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines[0].event, 'output.added');
    assert.equal(lines.at(-1).event, 'done');
    assert.equal(lines.at(-1).status, 'completed');
  }

  {
    const result = await expectSuccess(['video', 'status', '123e4567-e89b-12d3-a456-426614174000']);
    const data = JSON.parse(result.stdout);
    assert.equal(data.status, 'completed');
    assert.equal(data.videoUrl, 'https://cdn.example/video.mp4');
  }

  {
    const result = await expectSuccess(['register', '--json'], { apiKey: false });
    const data = JSON.parse(result.stdout);
    assert.equal(data.challenge_id, 'challenge_1');
  }

  {
    const result = await expectSuccess(['register', '--verify', '--challenge-id', 'challenge_1', '--answer', '2'], { apiKey: false });
    const data = JSON.parse(result.stdout);
    assert.deepEqual(data, {
      api_key: 'mk_test_key',
      credits: 10,
      claim_url: 'https://www.makaron.app/claim/mock',
    });
  }
} finally {
  server.close();
  rmSync(tmpHome, { recursive: true, force: true });
}
