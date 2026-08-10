import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const cliPath = new URL('../bin/makaron.mjs', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

const requests = [];

const marketplaceSkills = [
  {
    id: 'skill_market_1',
    labels: { en: 'Diamond Bling', zh: '夜店钻石风', 'zh-Hant': '夜店鑽石風', ja: 'ダイヤモンドの輝き' },
    prompts: { en: 'Nightclub diamond bling portrait', zh: '夜店钻石肖像', 'zh-Hant': '夜店鑽石肖像', ja: '夜景のきらめくポートレート' },
    categories: ['portrait-effects'],
    image: 'https://cdn.example/diamond.jpg',
    prompt: 'Nightclub diamond bling portrait',
    skill_path: 'https://cdn.example/diamond.zip',
    image_count: 1,
    sort_order: 1,
    is_active: true,
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
    is_active: true,
    updated_at: '2026-01-01T00:00:00.000Z',
  },
];

const marketplaceCategories = [{
  id: 'portrait-effects',
  labels: { en: 'Portrait Effects', zh: '人像特效', 'zh-Hant': '人像特效', ja: 'ポートレート効果' },
  icon: '✨',
  sort_order: 1,
  is_active: true,
}];

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
    sendJson(200, marketplaceSkills);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/billing/credits') {
    assert.equal(req.headers.authorization, 'Bearer mk_test_smoke');
    sendJson(200, {
      balance: 321,
      lifetimePurchased: 500,
      lifetimeUsed: 179,
      subscription: {
        provider: 'stripe',
        planId: 'pro',
        status: 'active',
        billingInterval: 'month',
        currentPeriodEnd: '2026-08-19T00:00:00.000Z',
        cancelAtPeriodEnd: false,
      },
    });
    return;
  }

  if (url.pathname === '/api/admin/home-skills') {
    assert.equal(req.headers.authorization, 'Bearer mk_test_smoke');
    if (req.method === 'GET') sendJson(200, marketplaceSkills);
    else if (req.method === 'POST') sendJson(200, { success: true, id: 'skill_created' });
    else if (req.method === 'PUT' || req.method === 'DELETE') sendJson(200, { success: true });
    else sendJson(405, { error: 'Method not allowed' });
    return;
  }

  if (url.pathname === '/api/admin/skill-categories') {
    assert.equal(req.headers.authorization, 'Bearer mk_test_smoke');
    if (req.method === 'GET') sendJson(200, marketplaceCategories);
    else if (req.method === 'POST') sendJson(201, body);
    else if (req.method === 'PUT') sendJson(200, body);
    else if (req.method === 'DELETE') sendJson(200, { success: true });
    else sendJson(405, { error: 'Method not allowed' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/skills') {
    sendJson(200, {
      skills: [
        {
          name: 'cinematic-video',
          label: 'Cinematic Video',
          builtIn: true,
          description: 'Produce an authored cinematic short.',
          studioRunRecipe: 'cinematic-video',
          studioRunProfile: 'generated-or-hybrid',
          sourceMediaRequired: false,
        },
        {
          name: 'source-video-studio',
          label: 'Source Video Studio',
          builtIn: true,
          description: 'Edit real uploaded footage.',
          studioRunRecipe: 'source-video-studio',
          studioRunProfile: 'source-led',
          sourceMediaRequired: true,
        },
      ],
    });
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

  if (req.method === 'POST' && url.pathname === '/api/agent') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'X-Agent-Run-Id': 'run_stream_mock_1',
    });
    res.end('data: {"type":"done"}\n\n');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mcp') {
    assert.equal(req.headers.authorization, 'Bearer mk_test_smoke');
    sendJson(200, {
      jsonrpc: '2.0',
      id: body?.id ?? 1,
      result: {
        content: [{ type: 'text', text: 'Video rendering task created.\n\nTask ID: task-unified-text-smoke' }],
      },
    });
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

  if (req.method === 'GET' && url.pathname === '/api/agent/run/run_studio_1') {
    sendJson(200, {
      id: 'run_studio_1',
      project_id: 'project-auto-1',
      status: 'completed',
      incomplete: false,
      output: [{
        id: 'out_studio_1',
        type: 'studio_run',
        status: 'awaiting_approval',
        run_id: 'studio_1',
        recipe: 'cinematic-video',
        current_stage: 'proposal',
      }],
      result: {},
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/agent/run/run_legacy_video') {
    sendJson(200, {
      id: 'run_legacy_video',
      project_id: 'project-auto-1',
      status: 'completed',
      incomplete: false,
      output: [],
      result: {
        videos: [{
          taskId: 'studio-delivery-run_legacy_video',
          status: 'completed',
          videoUrl: 'https://cdn.example/legacy-delivery.mp4',
        }],
      },
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

  if (req.method === 'GET' && url.pathname === '/api/agent/run/run_comp_1') {
    sendJson(200, {
      id: 'run_comp_1',
      project_id: 'project-auto-1',
      status: 'completed',
      incomplete: false,
      output: [{
        id: 'design_comp_1',
        type: 'design',
        animated: true,
        snapshot_id: 'snap_comp_1',
        width: 720,
        height: 1280,
      }],
      result: { designs: [{ width: 720, height: 1280 }] },
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
        {
          id: 'media_3',
          index: 3,
          ref: '<<<media_3>>>',
          type: 'composition',
          status: 'completed',
          snapshot_id: 'snap_comp_1',
          snapshotId: 'snap_comp_1',
          codePath: 'code/snap_comp_1.json',
          description: 'Editable Remotion composition',
        },
      ],
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/projects/project-auto-1/media') {
    assert.equal(req.headers.authorization, 'Bearer mk_test_smoke');
    const ranges = body?.source_ranges || [];
    sendJson(201, {
      projectId: 'project-auto-1',
      project_id: 'project-auto-1',
      published: [],
      media: ranges.map((range, index) => ({
        ref: `<<<media_${index + 4}>>>`,
        index: index + 4,
        type: 'video',
        status: 'completed',
        snapshot_id: `snap_external_${index + 1}`,
        url: range.source_url,
        source_range: range,
        source_url: range.source_url,
        start_sec: range.start_sec,
        end_sec: range.end_sec,
        created: true,
      })),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/remotion/export') {
    sendJson(200, { jobId: 'export_job_1', id: 'export_job_1', status: 'queued', projectId: body.projectId });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/remotion/export/export_job_1') {
    sendJson(200, {
      id: 'export_job_1',
      status: 'completed',
      projectId: 'project-auto-1',
      url: 'https://cdn.example/remotion-export.mp4',
      storageUrl: 'https://cdn.example/remotion-export.mp4',
      workspacePath: 'project-auto-1/media/remotion-export.mp4',
      duration_seconds: 4,
      render_seconds: 5,
      realtime_ratio: 0.8,
      width: 720,
      height: 1280,
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
    [['--help'], /Chat chooses agent, image, and video models automatically/],
    [['login', '--help'], /Usage: makaron login/],
    [['create', '--help'], /Usage: makaron create/],
    [['chat', '--help'], /Model routing is automatic in chat/],
    [['responses', '--help'], /Responses commands:/],
    [['responses', 'get', '--help'], /Usage: makaron responses get/],
    [['responses', 'watch', '--help'], /Usage: makaron responses watch/],
    [['responses', 'list', '--help'], /Usage: makaron responses list/],
    [['materialize', '--help'], /Usage: makaron materialize/],
    [['composition', '--help'], /Composition commands:/],
    [['credits', '--help'], /Usage: makaron credits/],
    [['list', '--help'], /Usage: makaron list/],
    [['setup', '--help'], /Usage: makaron setup/],
    [['install-skill', '--help'], /Usage: makaron install-skill/],
    [['project', '--help'], /Project commands:/],
    [['project', 'media', '--help'], /Usage: makaron project media/],
    [['abort', '--help'], /Usage: makaron abort/],
    [['skills', '--help'], /Skill commands:/],
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
    [['admin', 'skill-categories', '--help'], /Usage: makaron admin skill-categories/],
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
    const result = await expectHelp(['skills', '--help'], /Skill commands:/);
    assert.doesNotMatch(result.stdout, /--openmontage/);
  }

  {
    const result = await expectHelp(['--help'], /Chat chooses agent, image, and video models automatically/);
    assert.doesNotMatch(result.stdout, /--agent-model/);
    assert.doesNotMatch(result.stdout, /--image-model/);
    assert.doesNotMatch(result.stdout, /--video-model/);
    assert.doesNotMatch(result.stdout, /MAKARON_AGENT_MODEL/);
  }

  {
    const result = await expectHelp(['chat', '--help'], /Model routing is automatic in chat/);
    assert.doesNotMatch(result.stdout, /^\s+--agent-model/m);
    assert.doesNotMatch(result.stdout, /^\s+--image-model/m);
    assert.doesNotMatch(result.stdout, /^\s+--video-model/m);
    assert.doesNotMatch(result.stdout, /^\s+--video-resolution/m);
    assert.match(result.stdout, /Do not pass --agent-model, --image-model,/);
    assert.match(result.stdout, /--media-manifest <file\|->/);
  }

  {
    const result = await expectHelp(['edit', '--help'], /--image-model/);
    assert.match(result.stdout, /--image-model/);
    const videoResult = await expectHelp(['video', 'create', '--help'], /--video-model/);
    assert.match(videoResult.stdout, /--video-model/);
    assert.match(videoResult.stdout, /--video-resolution/);
    assert.match(videoResult.stdout, /minimax-h3/);
    assert.match(videoResult.stdout, /2k/);
  }

  {
    const result = await expectSuccess(['credits', '--json']);
    assert.deepEqual(JSON.parse(result.stdout), {
      balance: 321,
      lifetimePurchased: 500,
      lifetimeUsed: 179,
      subscription: {
        provider: 'stripe',
        planId: 'pro',
        status: 'active',
        billingInterval: 'month',
        currentPeriodEnd: '2026-08-19T00:00:00.000Z',
        cancelAtPeriodEnd: false,
      },
    });
  }

  {
    const result = await expectSuccess(['credits']);
    assert.match(result.stdout, /^Credits: 321$/m);
    assert.match(result.stdout, /^Lifetime purchased: 500$/m);
    assert.match(result.stdout, /^Lifetime used: 179$/m);
    assert.match(result.stdout, /^Subscription: pro \(active\)$/m);
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
    assert.equal(runRequest?.body?.agentModel, undefined);
    assert.equal(runRequest?.body?.preferredModel, undefined);
    assert.equal(runRequest?.body?.videoModel, undefined);
  }

  {
    const manifestPath = path.join(tmpHome, 'racket-set-01.json');
    writeFileSync(manifestPath, JSON.stringify({
      title: 'Racket Process · Chinese',
      source_ranges: [
        {
          source_url: 'https://media.example/racket-a.mp4',
          start_sec: 4,
          end_sec: 9.5,
          source_uri: 'dam://racket/a',
          asset_id: 'asset-a',
          description: 'Carbon frame molding close-up',
        },
        {
          source_url: 'https://media.example/racket-b.mp4',
          start_sec: 12,
          end_sec: 18,
          asset_id: 'asset-b',
          description: 'Worker wraps the racket handle',
        },
      ],
    }));
    const requestStart = requests.length;
    const result = await expectSuccess([
      'chat', '--project', 'auto', '--media-manifest', manifestPath,
      '--json', '-b', '制作30秒中文VO竖屏视频',
    ]);
    const data = JSON.parse(result.stdout);
    assert.equal(data.projectId, 'project-auto-1');
    assert.equal(data.importedMedia.length, 2);
    assert.deepEqual(data.importedMedia.map(item => item.ref), ['<<<media_4>>>', '<<<media_5>>>']);

    const flow = requests.slice(requestStart);
    assert.deepEqual(flow.map(request => `${request.method} ${request.pathname}`), [
      'POST /api/projects/create',
      'POST /api/projects/project-auto-1/media',
      'POST /api/agent/run',
    ]);
    assert.equal(flow[0].body.title, 'Racket Process · Chinese');
    assert.equal(flow[1].body.source_ranges.length, 2);
    assert.equal(flow[1].body.source_ranges[0].description, 'Carbon frame molding close-up');
    assert.equal(flow[2].body.prompt, '制作30秒中文VO竖屏视频');
    assert.equal(flow[2].body.uploadedVideoCount, 2);
    assert.equal(flow[2].body.turnMediaCount, 2);
  }

  {
    const invalidManifestPath = path.join(tmpHome, 'invalid-media-manifest.json');
    writeFileSync(invalidManifestPath, JSON.stringify({
      source_ranges: [{ source_url: 'file:///private/video.mp4', start_sec: 2, end_sec: 1 }],
    }));
    const requestCount = requests.length;
    const result = await expectFailure([
      'chat', '--project', 'auto', '--media-manifest', invalidManifestPath,
      '--json', '-b', 'must fail before project creation',
    ]);
    assert.match(result.stderr, /Invalid media manifest/);
    assert.match(result.stderr, /must use HTTP or HTTPS/);
    assert.equal(requests.length, requestCount);
  }

  for (const args of [
    ['--agent-model', 'deepseek-v4-pro'],
    ['--image-model', 'qwen'],
    ['--video-model', 'seedance pro'],
    ['--video-model=seedance-pro'],
    ['--model', 'qwen'],
  ]) {
    const requestCount = requests.length;
    const result = await expectFailure(['chat', '--project', 'project-models-1', ...args, 'must fail fast']);
    assert.match(result.stderr, /chat chooses agent, image, and video models automatically/);
    assert.match(result.stderr, new RegExp(`Remove ${args[0].split('=')[0]}`));
    assert.equal(requests.length, requestCount, `${args[0]} should fail before making HTTP requests`);
  }

  for (const resolutionArgs of [
    ['--video-resolution', '2k'],
    ['--video-resolution=2k'],
  ]) {
    const requestCount = requests.length;
    const result = await expectFailure(['chat', '--project', 'project-stream-1', ...resolutionArgs, 'use MiniMax H3 at 2K']);
    assert.match(result.stderr, /chat chooses video model and resolution together/);
    assert.match(result.stderr, /Put the requested resolution in your chat message/);
    assert.equal(requests.length, requestCount, `${resolutionArgs[0]} should fail before making HTTP requests`);
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
    const result = await expectSuccess(['video', 'create', '--script', 'A neon one-person studio wakes at dawn', '--duration', '5', '--video-model', 'seedance-fast']);
    assert.match(result.stdout, /Task ID: task-unified-text-smoke/);
    const mcpRequest = requests.filter(req => req.pathname === '/api/mcp').at(-1);
    assert.equal(mcpRequest?.body?.params?.name, 'makaron_create_video');
    assert.deepEqual(mcpRequest?.body?.params?.arguments?.images, []);
    assert.equal(mcpRequest?.body?.params?.arguments?.videoModel, 'seedance-fast');
    assert.equal(mcpRequest?.body?.params?.arguments?.duration, 5);
  }

  {
    const result = await expectSuccess(['video', 'create', '--script', 'Makaron Launch\nShot 1 (30s): <<<media_1>>> becomes a living studio', '--image', 'https://cdn.example/home.png', '--duration', '30', '--video-model', 'seedance-2.5', '--video-resolution', '720p', '--output-format', 'mp4', '--web-search']);
    assert.match(result.stdout, /Task ID: task-unified-text-smoke/);
    const mcpRequest = requests.filter(req => req.pathname === '/api/mcp').at(-1);
    assert.equal(mcpRequest?.body?.params?.name, 'makaron_create_video');
    assert.equal(mcpRequest?.body?.params?.arguments?.videoModel, 'seedance-2.5');
    assert.equal(mcpRequest?.body?.params?.arguments?.duration, 30);
    assert.equal(mcpRequest?.body?.params?.arguments?.outputFormat, 'mp4');
    assert.equal(mcpRequest?.body?.params?.arguments?.webSearch, true);
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
    const result = await expectSuccess(['skills', 'search', '夜景のきらめくポートレート', '--json'], { apiKey: false });
    const data = JSON.parse(result.stdout);
    assert.equal(data.skills[0].id, 'skill_market_1');
  }

  {
    const result = await expectSuccess(['skills', 'search', 'portrait-effects', '--json'], { apiKey: false });
    const data = JSON.parse(result.stdout);
    assert.equal(data.skills[0].id, 'skill_market_1');
  }

  {
    const result = await expectSuccess(['admin', 'skills']);
    assert.match(result.stdout, /portrait-effects/);
    assert.match(result.stdout, /title 4\/4 · prompt 4\/4/);
  }

  {
    const result = await expectSuccess(['admin', 'skills', '--json']);
    const data = JSON.parse(result.stdout);
    assert.equal(data[0].prompts.ja, '夜景のきらめくポートレート');
  }

  {
    const result = await expectSuccess(['admin', 'skill-categories']);
    assert.match(result.stdout, /portrait-effects/);
    assert.match(result.stdout, /title 4\/4/);
  }

  {
    const category = { id: 'tools', labels: { en: 'Tools', zh: '工具', 'zh-Hant': '工具', ja: 'ツール' } };
    await expectSuccess(['admin', 'skill-categories', 'add', JSON.stringify(category)]);
    await expectSuccess(['admin', 'skill-categories', 'update', 'tools', JSON.stringify({ icon: '🛠️' })]);
    await expectSuccess(['admin', 'skill-categories', 'delete', 'tools']);
    const categoryRequests = requests.filter(req => req.pathname === '/api/admin/skill-categories');
    assert.equal(categoryRequests.at(-3)?.body?.labels?.ja, 'ツール');
    assert.equal(categoryRequests.at(-2)?.body?.id, 'tools');
    assert.deepEqual(categoryRequests.at(-1)?.body, { id: 'tools' });
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
    const result = await expectSuccess(['skills', 'list', '--built-in', '--json']);
    const data = JSON.parse(result.stdout);
    assert.equal(data.skills.length, 2);
    assert.equal(data.skills[0].studioRunRecipe, 'cinematic-video');
  }

  {
    const result = await expectSuccess(['skills', 'show', 'source-video-studio', '--built-in', '--json']);
    const data = JSON.parse(result.stdout);
    assert.equal(data.sourceMediaRequired, true);
    assert.equal(data.studioRunProfile, 'source-led');
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
    const result = await expectSuccess(['responses', 'get', 'run_studio_1', '--pick', 'studio_recipe']);
    assert.equal(result.stdout.trim(), 'cinematic-video');
  }

  {
    const result = await expectSuccess(['responses', 'get', 'run_studio_1', '--pick', 'studio_run']);
    const studioRun = JSON.parse(result.stdout);
    assert.equal(studioRun.current_stage, 'proposal');
    assert.equal(studioRun.status, 'awaiting_approval');
  }

  {
    const result = await expectSuccess(['responses', 'get', 'run_legacy_video', '--pick', 'first_video_url']);
    assert.equal(result.stdout.trim(), 'https://cdn.example/legacy-delivery.mp4');
  }

  {
    const result = await expectSuccess(['responses', 'get', 'run_legacy_video', '--pick', 'video_urls']);
    assert.deepEqual(JSON.parse(result.stdout), ['https://cdn.example/legacy-delivery.mp4']);
  }

  {
    const result = await expectSuccess(['project', 'media', 'project-auto-1', '--json']);
    const data = JSON.parse(result.stdout);
    assert.equal(data.projectId, 'project-auto-1');
    assert.equal(data.media.length, 3);
    assert.equal(data.media[0].ref, '<<<media_1>>>');
    assert.equal(data.media[1].type, 'video');
    assert.equal(data.media[1].duration, 12.4);
    assert.equal(data.media[2].type, 'composition');
    const mediaRequest = requests.find(req => req.pathname === '/api/projects/project-auto-1/media' && req.method === 'GET');
    assert.equal(mediaRequest?.method, 'GET');
  }

  {
    const result = await expectSuccess([
      'project', 'media', 'add', 'project-auto-1',
      '--source-url', 'https://cdn.example/source.mp4?signature=one',
      '--start-sec', '12.5',
      '--end-sec', '19',
      '--source-uri', 'scene://project-a/asset-b',
      '--asset-id', 'asset-b',
      '--description', 'Racket frame molding',
      '--json',
    ]);
    const data = JSON.parse(result.stdout);
    assert.equal(data.media[0].ref, '<<<media_4>>>');
    assert.equal(data.media[0].start_sec, 12.5);
    assert.equal(data.media[0].end_sec, 19);
    const request = requests.filter(req => req.pathname === '/api/projects/project-auto-1/media' && req.method === 'POST').at(-1);
    assert.deepEqual(request?.body?.source_ranges, [{
      source_url: 'https://cdn.example/source.mp4?signature=one',
      start_sec: 12.5,
      end_sec: 19,
      source_uri: 'scene://project-a/asset-b',
      asset_id: 'asset-b',
      description: 'Racket frame molding',
    }]);
  }

  {
    const result = await expectSuccess(['composition', 'export', '--project', 'project-auto-1', '--media', '3', '--wait']);
    assert.equal(result.stdout.trim(), 'https://cdn.example/remotion-export.mp4');
    const exportRequest = requests.filter(req => req.pathname === '/api/remotion/export').at(-1);
    assert.equal(exportRequest?.method, 'POST');
    assert.equal(exportRequest?.body?.snapshotId, 'snap_comp_1');
    assert.equal(exportRequest?.body?.designPath, 'code/snap_comp_1.json');
    assert.equal(exportRequest?.body?.renderProfile, 'fast_720p');
    assert.equal(exportRequest?.body?.publish, false);
  }

  {
    const designPath = path.join(tmpHome, 'composition.json');
    writeFileSync(designPath, JSON.stringify({
      code: 'export default function Comp(){ return null; }',
      width: 1080,
      height: 1920,
      animation: { fps: 30, durationInSeconds: 1 },
    }));
    const result = await expectSuccess(['materialize', '--project', 'project-auto-1', '--design-json', designPath, '--pick', 'url']);
    assert.equal(result.stdout.trim(), 'https://cdn.example/remotion-export.mp4');
    const exportRequest = requests.filter(req => req.pathname === '/api/remotion/export').at(-1);
    assert.equal(exportRequest?.body?.publish, true);
    assert.equal(exportRequest?.body?.renderProfile, 'fast_720p');
    assert.equal(exportRequest?.body?.design?.width, 1080);
  }

  {
    const result = await expectSuccess(['responses', 'get', 'run_comp_1', '--export-compositions', '--pick', 'first_video_url']);
    assert.equal(result.stdout.trim(), 'https://cdn.example/remotion-export.mp4');
  }

  {
    const result = await expectSuccess(['responses', 'get', 'run_comp_1', '--materialize', '--pick', 'first_video_url']);
    assert.equal(result.stdout.trim(), 'https://cdn.example/remotion-export.mp4');
    const exportRequest = requests.filter(req => req.pathname === '/api/remotion/export').at(-1);
    assert.equal(exportRequest?.body?.publish, true);
  }

  {
    const result = await expectSuccess(['responses', 'get', 'run_comp_1', '--materialize', '--wait', '--pick', 'first_video_url']);
    assert.equal(result.stdout.trim(), 'https://cdn.example/remotion-export.mp4');
    const exportRequest = requests.filter(req => req.pathname === '/api/remotion/export').at(-1);
    assert.equal(exportRequest?.body?.publish, true);
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
