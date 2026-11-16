// @vitest-environment node
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMakaronAgent } from '@/lib/agent';
import { fetchWithWorkspaceReceipt } from '@/lib/supabase/workspace-fetch';
import * as workspace from '@/lib/workspace';

const stream = vi.hoisted(() => vi.fn());
vi.mock('ai', async actual => ({ ...await actual<typeof import('ai')>(), streamText: stream }));
vi.mock('@/lib/agent-tools', () => ({
  createTools: () => ({}), logToolSizes: () => 0, getStudioRunCheckpoint: async () => ({}),
}));
vi.mock('@/lib/agent-model-runtime', () => ({
  createAgentModelRuntime: () => ({ spec: { provider: 'deepseek', id: 'deepseek-v4-pro' }, normalizeMessages: (m: unknown) => m }),
  getAgentProviderOptions: () => ({}), sumOpenRouterProviderCost: () => 0,
}));

describe('streamed workspace checkpoint uploads', () => {
  const path = 'project/drafts/streamed-run_code-inline-call.partial.js';
  const requestId = '01910234-abcd-4321-8765-123456789abc';
  let cacheDir: string;
  let server: ReturnType<typeof createServer>;
  let client: ReturnType<typeof createClient>;
  let accept: (text: string) => boolean;
  let uploads: number[];
  let indexed: number[];

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'workspace-checkpoint-'));
    vi.stubEnv('MAKARON_WORKSPACE_CACHE_DIR', cacheDir);
    accept = () => true;
    uploads = [];
    indexed = [];
    let objectBody: string | undefined;
    let indexRow: { size_bytes: number } | undefined;
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      if (req.method === 'POST' && req.url === '/storage/v1/object/images/user/workspace/' + path) {
        uploads.push(body.length);
        if (!accept(body)) {
          res.writeHead(403, { 'content-type': 'text/html', 'sb-request-id': requestId, 'cf-ray': '0123456789abcdef-SIN' });
          res.end('<html>private response body</html>');
          return;
        }
        objectBody = body;
      } else if (req.method === 'POST' && req.url?.startsWith('/rest/v1/workspace_files?')) {
        indexRow = JSON.parse(body) as { size_bytes: number };
        indexed.push(indexRow.size_bytes);
      } else if (req.method === 'GET' && req.url?.startsWith('/rest/v1/workspace_files?')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(indexRow ? [indexRow] : []));
        return;
      } else if (req.method === 'GET' && req.url === '/storage/v1/object/public/images/user/workspace/' + path) {
        res.writeHead(objectBody === undefined ? 404 : 200).end(objectBody);
        return;
      } else {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    client = createClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'fixture', {
      global: { fetch: fetchWithWorkspaceReceipt }, auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    workspace.clearWorkspaceCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(cacheDir, { recursive: true, force: true });
  });

  async function interruptAfter(chunks: string[]) {
    stream.mockReturnValue({
      fullStream: [
        { type: 'tool-input-start', toolName: 'run_code', toolCallId: 'call' },
        { type: 'tool-input-delta', delta: '{"code":"' },
        ...chunks.map(delta => ({ type: 'tool-input-delta', delta })),
        { type: 'error', error: new Error('ECONNRESET') },
      ],
      steps: Promise.resolve([]),
    });
    const events = [];
    for await (const event of runMakaronAgent('Continue', '', 'project', {
      userId: 'user', supabase: client, agentProvider: 'deepseek', locale: 'en',
      execution: { runId: 'fixture', attemptId: 'attempt', attemptNo: 1, inputEpoch: 0 },
      promptPrefetch: { corePromptMode: Promise.resolve('layered'), systemPrompt: Promise.resolve('test') },
    })) events.push(event);
    return events.find(e => e.type === 'error')?.checkpoint;
  }

  it('keeps the committed prefix after a refusal and does not upload once per delta', async () => {
    accept = body => body.length <= 1_001;
    const warn = vi.spyOn(console, 'warn');
    const checkpoint = await interruptAfter(['a'.repeat(1_001), 'b'.repeat(1_000), ...Array<string>(27).fill('c')]);
    // On interruption, the changed tail still gets its final save opportunity.
    expect(uploads).toEqual([1_001, 2_001, 2_028]);
    expect(indexed).toEqual([1_001]);
    expect(checkpoint).toMatchObject({ streamedCodePath: path, streamedCodeChars: 1_001 });
    expect(await readFile(workspace.getLocalWorkspacePath('user', path), 'utf8')).toBe('a'.repeat(1_001));
    expect(warn).toHaveBeenCalledWith('[workspace] checkpoint upload response', {
      status: 403, format: 'html', requestId, cfRay: '0123456789abcdef-SIN',
    });
  });

  it('leaves an equal-size rejected replacement out of warm workspace reads', async () => {
    expect((await workspace.writeFile(path, 'old', client, 'user')).success).toBe(true);
    accept = () => false;
    expect(await workspace.writeFile(path, 'new', client, 'user')).toMatchObject({ success: false, uploadForbidden: true });
    expect((await workspace.readFile(path, client, 'user'))?.content).toBe('old');
    expect(indexed).toEqual([3]);
  });

  it('does not advertise a rejected first version or re-upload identical bytes at interruption', async () => {
    accept = () => false;
    const checkpoint = await interruptAfter(['x'.repeat(1_000)]);
    expect(uploads).toEqual([1_000]);
    expect(indexed).toEqual([]);
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.streamedCodePath).toBeUndefined();
    await expect(readFile(workspace.getLocalWorkspacePath('user', path))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('records a later accepted version through the same authorized client and object path', async () => {
    accept = body => body.length >= 2_000;
    const checkpoint = await interruptAfter(['a'.repeat(1_000), 'b', 'c'.repeat(999)]);
    expect(uploads).toEqual([1_000, 2_000]);
    expect(indexed).toEqual([2_000]);
    expect(checkpoint).toMatchObject({ streamedCodePath: path, streamedCodeChars: 2_000 });
    await rm(workspace.getLocalWorkspacePath('user', path));
    const reopened = await workspace.readFile(path, client, 'user');
    expect(reopened?.content).toBe('a'.repeat(1_000) + 'b' + 'c'.repeat(999));
  });
});
