// @vitest-environment node
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TextStreamPart, ToolSet } from 'ai';
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
  let paths: string[];
  let removed: string[];
  let commitIndex: (size: number) => boolean;
  let afterIndexCommit: () => Promise<void>;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'workspace-checkpoint-'));
    vi.stubEnv('MAKARON_WORKSPACE_CACHE_DIR', cacheDir);
    accept = () => true;
    uploads = [];
    indexed = [];
    paths = [];
    removed = [];
    commitIndex = () => true;
    afterIndexCommit = async () => {};
    const objects = new Map<string, string>();
    const index = new Map<string, { path: string; size_bytes: number }>();
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const url = new URL(req.url!, 'http://localhost');
      const uploadPrefix = '/storage/v1/object/images/user/workspace/';
      const publicPrefix = '/storage/v1/object/public/images/user/workspace/';
      if (req.method === 'POST' && url.pathname.startsWith(uploadPrefix)) {
        const name = url.pathname.slice(uploadPrefix.length);
        paths.push(name);
        uploads.push(body.length);
        if (!accept(body)) {
          res.writeHead(403, { 'content-type': 'text/html', 'sb-request-id': requestId, 'cf-ray': '0123456789abcdef-SIN' });
          res.end('<html>private response body</html>');
          return;
        }
        objects.set(name, body);
      } else if (req.method === 'POST' && url.pathname === '/rest/v1/workspace_files') {
        const row = JSON.parse(body) as { path: string; size_bytes: number };
        if (!commitIndex(row.size_bytes)) {
          res.writeHead(403, { 'content-type': 'application/json' }).end('{"message":"index refused"}');
          return;
        }
        index.set(row.path, row);
        indexed.push(row.size_bytes);
        await afterIndexCommit();
      } else if (req.method === 'GET' && url.pathname === '/rest/v1/workspace_files') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([...index.values()]));
        return;
      } else if (req.method === 'POST' && url.pathname.startsWith('/storage/v1/object/sign/')) {
        const signedURL = url.pathname.replace('/storage/v1/object/sign/', '/object/public/');
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ signedURL }));
        return;
      } else if (req.method === 'DELETE' && url.pathname === '/storage/v1/object/images') {
        for (const key of JSON.parse(body).prefixes as string[]) {
          const name = key.slice('user/workspace/'.length);
          objects.delete(name);
          removed.push(name);
        }
      } else if (req.method === 'DELETE' && url.pathname === '/rest/v1/workspace_files') {
        index.delete(url.searchParams.get('path')!.slice('eq.'.length));
      } else if (req.method === 'GET' && url.pathname.startsWith(publicPrefix)) {
        const object = objects.get(url.pathname.slice(publicPrefix.length));
        res.writeHead(object === undefined ? 404 : 200).end(object);
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
    const fullStream: TextStreamPart<ToolSet>[] = [
      { type: 'tool-input-start', toolName: 'run_code', id: 'call' },
      { type: 'tool-input-delta', id: 'call', delta: '{"code":"' },
      ...chunks.map(delta => ({ type: 'tool-input-delta' as const, id: 'call', delta })),
      { type: 'error', error: new Error('ECONNRESET') },
    ];
    stream.mockReturnValue({ fullStream, steps: Promise.resolve([]) });
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
    expect(checkpoint).toMatchObject({ streamedCodePath: paths[0], streamedCodeChars: 1_001 });
    expect(paths[0]).toMatch(/^project\/drafts\/streamed-run_code-.*\.partial\.js$/);
    expect(paths[0]).not.toBe(paths[1]);
    expect(paths[1]).toBe(paths[2]);
    expect((await workspace.readFile(paths[0], client, 'user'))?.content).toBe('a'.repeat(1_001));
    expect(warn).toHaveBeenCalledWith('[workspace] checkpoint upload response', {
      status: 403, format: 'html', requestId, cfRay: '0123456789abcdef-SIN',
    });
  });

  it('leaves an equal-size rejected replacement out of warm workspace reads', async () => {
    expect((await workspace.writeFile(path, 'old', client, 'user')).success).toBe(true);
    expect((await workspace.readFile(path, client, 'user'))?.content).toBe('old');
    accept = () => false;
    expect(await workspace.writeFile(path, 'new', client, 'user')).toMatchObject({ success: false, uploadForbidden: true });
    workspace.clearWorkspaceCache();
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
    expect(await workspace.readFile(paths[0], client, 'user')).toBeNull();
  });

  it('keeps a newer equal-size revision readable when the first index response arrives last', async () => {
    let releaseFirst!: () => void;
    let firstCommitted!: () => void;
    const delayed = new Promise<void>(resolve => { releaseFirst = resolve; });
    const committed = new Promise<void>(resolve => { firstCommitted = resolve; });
    afterIndexCommit = async () => {
      if (indexed.length !== 1) return;
      firstCommitted();
      await delayed;
    };
    const first = workspace.writeFile(path, 'old', client, 'user');
    try {
      await committed;
      expect((await workspace.writeFile(path, 'new', client, 'user')).success).toBe(true);
      expect((await workspace.readFile(path, client, 'user'))?.content).toBe('new');
    } finally {
      releaseFirst();
      await first;
    }
    expect((await workspace.readFile(path, client, 'user'))?.content).toBe('new');
  });

  it('reuses two slots and preserves the confirmed prefix when a subsequent index update fails', async () => {
    commitIndex = size => size < 3_000;
    const checkpoint = await interruptAfter(['a'.repeat(1_000), 'b'.repeat(1_000), 'c'.repeat(1_000)]);
    expect(indexed).toEqual([1_000, 2_000]);
    expect(new Set(paths).size).toBe(2);
    expect(paths[2]).toBe(paths[0]);
    expect(checkpoint).toMatchObject({ streamedCodePath: paths[0], streamedCodeChars: 2_000 });
    expect((await workspace.listFiles('project/drafts/*', client, 'user')).map(file => file.path)).toEqual([paths[0]]);
    const saved = await workspace.readFile(paths[0], client, 'user');
    expect(saved?.content).toBe('a'.repeat(1_000) + 'b'.repeat(1_000));
    await rm(saved!.localPath!);
    workspace.clearWorkspaceCache();
    expect((await workspace.readFile(paths[0], client, 'user'))?.content).toBe(saved?.content);
    expect((await workspace.readFile(paths[0], client, 'user', { fresh: true }))?.content).toBe(saved?.content);
    expect(await workspace.deleteFile(paths[0], client, 'user')).toBe(true);
    expect(removed).toEqual([paths[0], paths[1]]);
    expect(await workspace.readFile(paths[0], client, 'user')).toBeNull();
  });

  it('records a later accepted version through the same authorized client and object path', async () => {
    accept = body => body.length >= 2_000;
    const checkpoint = await interruptAfter(['a'.repeat(1_000), 'b', 'c'.repeat(999)]);
    expect(uploads).toEqual([1_000, 2_000]);
    expect(indexed).toEqual([2_000]);
    expect(paths[0]).toBe(paths[1]);
    expect(checkpoint).toMatchObject({ streamedCodePath: paths[1], streamedCodeChars: 2_000 });
    const reopened = await workspace.readFile(paths[1], client, 'user');
    expect(reopened?.content).toBe('a'.repeat(1_000) + 'b' + 'c'.repeat(999));
  });
});
