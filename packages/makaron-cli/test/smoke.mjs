import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const cliPath = new URL('../bin/makaron.mjs', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

const requests = [];

const server = http.createServer(async (req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  await new Promise(resolve => req.on('end', resolve));
  const rawBody = Buffer.concat(chunks).toString('utf-8');
  const contentType = req.headers['content-type'] || '';
  const body = rawBody && String(contentType).includes('application/json') ? JSON.parse(rawBody) : null;
  const url = new URL(req.url, 'http://127.0.0.1');
  requests.push({ method: req.method, pathname: url.pathname, search: url.search, body });

  const sendJson = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  if (req.method === 'GET' && url.pathname === '/api/home-skills') {
    sendJson(200, [
      {
        id: 'skill_market_1',
        labels: { en: 'Diamond Bling', zh: '夜店钻石风' },
        image: 'https://cdn.example/diamond.jpg',
        prompt: 'Nightclub diamond bling portrait',
        skill_path: 'https://cdn.example/diamond.zip',
        image_count: 1,
        sort_order: 1,
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'prompt_market_1',
        labels: { en: 'Prompt Only' },
        image: 'https://cdn.example/prompt.jpg',
        prompt: 'A prompt-only marketplace item',
        skill_path: null,
        image_count: 1,
        sort_order: 2,
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills') {
    assert.equal(req.headers.authorization, 'Bearer mk_test_smoke');
    assert.equal(body.skillPath, 'https://cdn.example/diamond.zip');
    assert.equal(body.homeSkillId, 'skill_market_1');
    sendJson(200, { success: true, skillName: 'diamond-bling', assetsUploaded: 1 });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/storage/upload-url') {
    assert.equal(req.headers.authorization, 'Bearer mk_test_smoke');
    sendJson(200, {
      uploadUrl: `${baseUrl}/upload/mock-image`,
      token: 'signed_upload_token',
      path: 'mock/upload.jpg',
      publicUrl: 'https://cdn.example/uploaded-image.jpg',
      contentType: body.contentType,
    });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/upload/mock-image') {
    assert.equal(req.headers.authorization, 'Bearer signed_upload_token');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/projects/create') {
    const snapshots = (body?.imageUrls || []).map((imageUrl, index) => ({
      snapshotId: `snap_uploaded_${index + 1}`,
      imageUrl,
    }));
    sendJson(200, { projectId: body?._addToProject || 'project-auto-1', snapshots });
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

  if (req.method === 'GET' && url.pathname === '/api/agent/run/run_failed_video') {
    sendJson(200, {
      id: 'run_failed_video',
      project_id: 'project-auto-1',
      status: 'failed',
      incomplete: false,
      output: [{
        id: 'out_video_failed',
        type: 'video',
        status: 'failed',
        task_id: 'task-unified-blocked',
        error: 'Content policy blocked the request',
        completion_actions: [{
          label: '改安全点重试',
          description: '换成更容易通过审核的版本',
          prompt: '刚才这个视频生成失败了，帮我改安全一点再试。',
          policy: 'confirm',
        }],
      }],
      result: {
        videos: [{
          taskId: 'task-unified-blocked',
          status: 'failed',
          completionActions: [{
            label: '改安全点重试',
            description: '换成更容易通过审核的版本',
            prompt: '刚才这个视频生成失败了，帮我改安全一点再试。',
          }],
        }],
      },
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
const tinyImagePath = path.join(tmpHome, 'tiny.jpg');
writeFileSync(tinyImagePath, Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0xff, 0xd9,
]));

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath.pathname, ...args], {
      env: {
        ...process.env,
        HOME: tmpHome,
        MAKARON_URL: baseUrl,
        MAKARON_APP_URL: 'https://app.example',
        MAKARON_API_KEY: options.apiKey === false ? '' : 'mk_test_smoke',
        MAKARON_DISABLE_UPDATE_CHECK: '1',
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

async function expectHelp(args, expectedText) {
  const requestCount = requests.length;
  const result = await expectSuccess(args, { apiKey: false });
  assert.match(result.stdout, expectedText, `${args.join(' ')} did not print expected help\nstdout:\n${result.stdout}`);
  assert.equal(result.stderr, '', `${args.join(' ')} should not print auth or execution errors\nstderr:\n${result.stderr}`);
  assert.equal(requests.length, requestCount, `${args.join(' ')} should not make HTTP requests`);
  return result;
}

async function expectFailure(args, options) {
  const result = await runCli(args, options);
  assert.notEqual(result.code, 0, `${args.join(' ')} unexpectedly succeeded\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

try {
  {
    const result = await expectSuccess(['--version']);
    assert.equal(result.stdout.trim(), pkg.version);
  }

  for (const [helpArgs, expectedText] of [
    [[], /Makaron CLI/],
    [['--help'], /Makaron CLI/],
    [['login', '--help'], /Usage: makaron login/],
    [['create', '--help'], /Usage: makaron create/],
    [['chat', '--help'], /--skill <id\|label\|name>/],
    [['responses', '--help'], /Responses commands:/],
    [['responses', 'get', '--help'], /Usage: makaron responses get/],
    [['responses', 'watch', '--help'], /Usage: makaron responses watch/],
    [['responses', 'list', '--help'], /Usage: makaron responses list/],
    [['list', '--help'], /Usage: makaron list/],
    [['setup', '--help'], /Usage: makaron setup/],
    [['install-skill', '--help'], /Usage: makaron install-skill/],
    [['project', '--help'], /Project commands:/],
    [['project', 'media', '--help'], /Usage: makaron project media/],
    [['abort', '--help'], /Usage: makaron abort/],
    [['skills', '--help'], /Skill marketplace commands:/],
    [['skills', 'list', '--help'], /Usage: makaron skills list/],
    [['skills', 'search', '--help'], /Usage: makaron skills search/],
    [['skills', 'show', '--help'], /Usage: makaron skills show/],
    [['skills', 'install', '--help'], /Usage: makaron skills install/],
    [['edit', '--help'], /Usage: makaron edit/],
    [['analyze', '--help'], /Usage: makaron analyze/],
    [['video', '--help'], /Video commands:/],
    [['video', 'script', '--help'], /Usage: makaron video script/],
    [['video', 'create', '--help'], /Usage: makaron video create/],
    [['video', 'status', '--help'], /Usage: makaron video status/],
    [['music', '--help'], /Music commands:/],
    [['music', 'create', '--help'], /Usage: makaron music create/],
    [['music', 'status', '--help'], /Usage: makaron music status/],
    [['admin', '--help'], /Admin commands:/],
    [['admin', 'skills', '--help'], /Usage: makaron admin skills/],
    [['admin', 'upload', '--help'], /Usage: makaron admin upload/],
    [['admin', 'fetch-skill', '--help'], /Usage: makaron admin fetch-skill/],
    [['admin', 'set-admin', '--help'], /Usage: makaron admin set-admin/],
    [['register', '--help'], /Usage: makaron register/],
    [['register', '--verify', '--help'], /Usage: makaron register --verify/],
    [['claim', '--help'], /Usage: makaron claim/],
  ]) {
    await expectHelp(helpArgs, expectedText);
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
    const result = await expectSuccess(['chat', '--project', 'project-existing-1', '--image', tinyImagePath, '--json', '-b', 'use this reference']);
    const data = JSON.parse(result.stdout);
    assert.equal(data.projectId, 'project-existing-1');

    const uploadUrlRequest = requests.filter(req => req.pathname === '/api/storage/upload-url').at(-1);
    assert.equal(uploadUrlRequest?.body?.projectId, 'project-existing-1');
    assert.equal(uploadUrlRequest?.body?.filename, 'tiny.jpg');
    assert.equal(uploadUrlRequest?.body?.contentType, 'image/jpeg');

    const signedPutRequest = requests.filter(req => req.pathname === '/upload/mock-image').at(-1);
    assert.equal(signedPutRequest?.method, 'PUT');

    const createRequest = requests.filter(req => req.pathname === '/api/projects/create').at(-1);
    assert.deepEqual(createRequest?.body, {
      _addToProject: 'project-existing-1',
      imageUrls: ['https://cdn.example/uploaded-image.jpg'],
    });

    const runRequest = requests.filter(req => req.pathname === '/api/agent/run').at(-1);
    assert.equal(runRequest?.body?.projectId, 'project-existing-1');
    assert.equal(runRequest?.body?.prompt, 'use this reference');
  }

  {
    const result = await expectSuccess(['skills', 'list', '--json'], { apiKey: false });
    const data = JSON.parse(result.stdout);
    assert.equal(data.skills.length, 2);
    assert.equal(data.skills[0].id, 'skill_market_1');
    assert.equal(data.skills[0].label, 'Diamond Bling');
    assert.equal(data.skills[0].hasSkill, true);
  }

  {
    const result = await expectSuccess(['skills', 'search', 'diamond', '--json'], { apiKey: false });
    const data = JSON.parse(result.stdout);
    assert.equal(data.skills.length, 1);
    assert.equal(data.skills[0].id, 'skill_market_1');
  }

  {
    const result = await expectSuccess(['skills', 'search', '夜店钻石风', '--json'], { apiKey: false });
    const data = JSON.parse(result.stdout);
    assert.equal(data.skills.length, 1);
    assert.equal(data.skills[0].id, 'skill_market_1');
  }

  {
    const result = await expectSuccess(['skills', 'show', 'Diamond Bling', '--json'], { apiKey: false });
    const data = JSON.parse(result.stdout);
    assert.equal(data.id, 'skill_market_1');
    assert.equal(data.skillPath, 'https://cdn.example/diamond.zip');
  }

  {
    const result = await expectSuccess(['skills', 'install', 'skill_market_1', '--json']);
    const data = JSON.parse(result.stdout);
    assert.equal(data.success, true);
    assert.equal(data.skillName, 'diamond-bling');
    assert.equal(data.marketplaceId, 'skill_market_1');
  }

  {
    await expectSuccess(['chat', '--project', 'auto', '--skill', '夜店钻石风', '--json', '-b', 'make me shine']);
    const runRequests = requests.filter(req => req.pathname === '/api/agent/run');
    const runRequest = runRequests.at(-1);
    assert.equal(runRequest?.body?.prompt, '[Active skill: diamond-bling]\nmake me shine');
    const installRequests = requests.filter(req => req.pathname === '/api/skills');
    assert.equal(installRequests.at(-1)?.body?.homeSkillId, 'skill_market_1');
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
    const result = await expectFailure(['responses', 'get', 'run_failed_video', '--json']);
    const data = JSON.parse(result.stdout);
    assert.equal(data.status, 'failed');
    assert.equal(data.output[0].status, 'failed');
    assert.equal(data.output[0].completion_actions[0].label, '改安全点重试');
  }

  {
    const result = await expectFailure(['responses', 'get', 'run_failed_video', '--pick', 'next_steps']);
    const data = JSON.parse(result.stdout);
    assert.equal(data[0].label, '改安全点重试');
    assert.equal(data[0].source, 'out_video_failed');
  }

  {
    const result = await expectFailure(['responses', 'watch', 'run_failed_video', '--jsonl', '--interval', '1']);
    const lines = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines[0].event, 'output.added');
    assert.equal(lines[0].item.status, 'failed');
    assert.equal(lines[0].item.completion_actions[0].label, '改安全点重试');
    assert.equal(lines.at(-1).event, 'done');
    assert.equal(lines.at(-1).status, 'failed');
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
