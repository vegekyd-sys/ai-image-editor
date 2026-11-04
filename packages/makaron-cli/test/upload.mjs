import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chmodSync, closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../bin/makaron.mjs', import.meta.url));
const temp = mkdtempSync(path.join(os.tmpdir(), 'makaron-cli-upload-'));
const bin = path.join(temp, 'bin');
mkdirSync(bin);
// Keep these transport tests independent of an installed FFmpeg.
const probe = path.join(bin, 'ffprobe');
writeFileSync(probe, `#!${process.execPath}
const file = process.argv.at(-1);
console.log(JSON.stringify({
  format: { duration: file.includes('long') ? '902' : '10' },
  streams: [{ codec_type: 'video', width: file.includes('4k') ? 3840 : 1920, height: file.includes('4k') ? 2160 : 1080 }],
}));
`);
chmodSync(probe, 0o755);

const requests = [];
const uploads = [];
let rejectUpload = false;
const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'PUT' && req.url === '/upload') {
    assert.equal(req.headers.authorization, 'Bearer test-signed-token');
    if (rejectUpload) {
      req.resume();
      send(413, { error: 'Storage size limit' });
      return;
    }
    let bytes = 0;
    let firstByte;
    let lastByte;
    for await (const chunk of req) {
      firstByte ??= chunk[0];
      lastByte = chunk.at(-1);
      bytes += chunk.length;
    }
    assert.equal(Number(req.headers['content-length']), bytes);
    uploads.push({ bytes, firstByte, lastByte, contentType: req.headers['content-type'] });
    send(200, {});
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  const body = raw ? JSON.parse(raw) : null;
  requests.push({ url: req.url, body });
  if (req.url === '/api/storage/upload-url') {
    send(200, { uploadUrl: `${baseUrl}/upload`, token: 'test-signed-token', publicUrl: 'https://cdn.example/uploaded.mp4' });
  } else if (req.url === '/api/projects/create') {
    send(200, { projectId: 'test-project', snapshots: [{ type: 'video', snapshotId: 'test-snapshot' }] });
  } else if (req.url === '/api/agent/run') {
    send(200, { runId: 'test-run' });
  } else if (req.url === '/api/mcp') {
    send(200, { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'Video analyzed' }] } });
  } else {
    send(404, { error: 'Unexpected request' });
  }
});
const baseUrl = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));

function video(name, size) {
  const file = path.join(temp, name);
  const fd = openSync(file, 'w');
  ftruncateSync(fd, size);
  writeSync(fd, Buffer.from([0x12]), 0, 1, 0);
  writeSync(fd, Buffer.from([0x34]), 0, 1, size - 1);
  closeSync(fd);
  return file;
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    // A 500MB upload must work with a small JS heap and stream to the receiver.
    const child = spawn(process.execPath, ['--max-old-space-size=64', cliPath, ...args], {
      env: {
        ...process.env,
        HOME: temp,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        MAKARON_URL: baseUrl,
        MAKARON_API_KEY: 'mk_test_upload',
        MAKARON_DISABLE_UPDATE_CHECK: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI upload timed out: ${args.join(' ')}`));
    }, 30_000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

const mb = 1024 * 1024;
try {
  const aboveOldLimit = video('60mb.mp4', 60 * mb);
  const analysis = await runCli(['analyze', '--video', aboveOldLimit, 'Describe the clip']);
  assert.equal(analysis.code, 0, analysis.stderr);
  assert.match(analysis.stdout, /Video analyzed/);
  assert.deepEqual(uploads.at(-1), { bytes: 60 * mb, firstByte: 0x12, lastByte: 0x34, contentType: 'video/mp4' });
  assert.equal(requests.at(-1).body.params.arguments.videoUrl, 'https://cdn.example/uploaded.mp4');

  const atLimit = video('500mb.mov', 500 * mb);
  const chat = await runCli(['chat', '--project', 'test-project', '--video', atLimit, '-b', 'Edit this clip']);
  assert.equal(chat.code, 0, chat.stderr);
  assert.deepEqual(uploads.at(-1), { bytes: 500 * mb, firstByte: 0x12, lastByte: 0x34, contentType: 'video/quicktime' });
  const imported = requests.findLast(request => request.url === '/api/projects/create');
  assert.deepEqual(imported.body.videoUrls, ['https://cdn.example/uploaded.mp4']);
  assert.equal(imported.body.videoMetas[0].duration, 10);
  assert.equal(requests.at(-1).url, '/api/agent/run');

  const tooLarge = video('over-limit.mp4', 500 * mb + 1);
  for (const args of [
    ['analyze', '--video', tooLarge],
    ['chat', '--project', 'test-project', '--video', tooLarge, '-b', 'Edit'],
    ['video', 'create', '--video', aboveOldLimit, '--script', 'Edit', '--video-model', 'seedance-fast', '--duration', '5'],
    ['video', 'create', '--video', aboveOldLimit, '--script', 'Edit', '--video-model', 'minimax-h3', '--duration', '5'],
    ['video', 'create', '--video', video('201mb.mp4', 201 * mb), '--script', 'Edit', '--video-model', 'kling-4', '--duration', '5'],
    ['chat', '--project', 'test-project', '--video', video('long.mp4', 1024), '-b', 'Edit'],
    ['chat', '--project', 'test-project', '--video', video('4k.mp4', 1024), '-b', 'Edit'],
  ]) {
    const before = requests.length;
    const result = await runCli(args);
    assert.notEqual(result.code, 0, JSON.stringify(result));
    assert.match(result.stderr, /max (?:500|50|200)MB|Video too long|Video resolution too high/);
    assert.equal(requests.length, before, 'Rejected input must not upload or start a run');
  }

  rejectUpload = true;
  const before = requests.length;
  const failed = await runCli(['chat', '--project', 'test-project', '--video', aboveOldLimit, '-b', 'Edit']);
  assert.notEqual(failed.code, 0);
  assert.match(failed.stderr, /Failed to upload file.*Storage size limit/);
  assert.deepEqual(requests.slice(before).map(request => request.url), ['/api/storage/upload-url']);

  for (const command of ['chat', 'analyze']) {
    const help = await runCli([command, '--help']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /max 500MB/);
  }
  console.log('CLI upload tests passed: 60MB analysis, 500MB streamed chat, size/provider/metadata limits, storage rejection, help.');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  rmSync(temp, { recursive: true, force: true });
}
