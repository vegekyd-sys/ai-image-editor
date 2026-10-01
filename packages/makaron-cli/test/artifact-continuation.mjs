import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
const cli = new URL('../bin/makaron.mjs', import.meta.url);
for (const scenario of ['auto', 'confirm', 'reconciled-auto']) {
  const policy = scenario === 'confirm' ? 'confirm' : 'auto';
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    requests.push({ method: req.method, path: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') {
      assert.deepEqual(body, { projectId: 'project', artifactContinuation: { snapshotId: 'native', actionIndex: 0 } });
      res.end(JSON.stringify({ runId: 'child' })); return;
    }
    if (req.url === '/api/projects/project/media') {
      res.end(JSON.stringify({ media: [{ type: 'video', status: 'completed', snapshotId: 'native', taskId: 'native-task', url: 'https://example.com/native.mp4', completion_actions: [{ label: 'finish', prompt: 'stored script', policy }] }] }));
      return;
    }
    const child = req.url.startsWith('/api/agent/run/child');
    const reconciled = !child && scenario === 'reconciled-auto';
    res.end(JSON.stringify({
      id: child ? 'child' : 'parent', status: reconciled ? 'in_progress' : 'completed', incomplete: reconciled, project_id: 'project', projectId: 'project',
      output: [{ type: 'video', status: reconciled ? 'rendering' : 'completed', task_id: 'native-task', snapshot_id: child ? 'final' : 'native', url: `https://example.com/${child ? 'final' : 'native'}.mp4`,
        ...((child || reconciled) ? {} : { completion_actions: [{ label: 'finish', prompt: 'stored script', policy }] }),
      }],
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const process = spawn(globalThis.process.execPath, [cli.pathname, 'responses', 'get', 'parent', '--wait', '--json'], {
    env: { ...globalThis.process.env, MAKARON_URL: `http://127.0.0.1:${server.address().port}`, MAKARON_API_KEY: 'test-only' },
  });
  let output = '', errors = ''; process.stdout.on('data', d => output += d); process.stderr.on('data', d => errors += d);
  const code = await new Promise(resolve => process.on('close', resolve));
  await new Promise(resolve => server.close(resolve));
  assert.equal(code, 0, errors);
  const data = JSON.parse(output);
  assert.equal(requests.filter(req => req.method === 'POST').length, policy === 'auto' ? 1 : 0);
  assert.equal(data.output[0].url, `https://example.com/${policy === 'auto' ? 'final' : 'native'}.mp4`);
  if (policy === 'auto') assert.equal(data.artifact_continuations[0].id, 'child');
}
console.log('CLI artifact continuation passed: stored auto steps continue; confirm steps remain pending.');
