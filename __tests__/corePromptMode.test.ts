// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), auth: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({ from: () => ({
  select: () => ({ eq: () => ({ abortSignal: () => ({ maybeSingle: mocks.read }) }) }),
  upsert: mocks.write,
}) }) }));
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mocks.auth }));
vi.mock('@/lib/admin', () => ({ isAdmin: mocks.admin }));
import { getCorePromptMode, invalidateCorePromptMode, setCorePromptMode, CORE_PROMPT_CACHE_MS } from '@/lib/core-prompt-mode';
import { GET, PUT } from '@/app/api/admin/core-prompt/route';
import { NextRequest } from 'next/server';

beforeEach(() => {
  vi.resetAllMocks(); invalidateCorePromptMode();
  mocks.read.mockResolvedValue({ data: { value: 'layered' }, error: null });
  mocks.write.mockResolvedValue({ error: null });
  mocks.auth.mockResolvedValue({ auth: { userId: 'admin' } });
  mocks.admin.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe('core prompt rollback', () => {
  it('defaults to layered when unset and observes remote rollback after cache expiry', async () => {
    vi.useFakeTimers();
    mocks.read.mockResolvedValueOnce({ data: null, error: null });
    expect(await getCorePromptMode()).toBe('layered');
    mocks.read.mockResolvedValue({ data: { value: 'legacy' }, error: null });
    expect(await getCorePromptMode()).toBe('layered');
    vi.advanceTimersByTime(CORE_PROMPT_CACHE_MS + 1);
    expect(await getCorePromptMode()).toBe('legacy');
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it('fails safely to legacy when configuration is unavailable or invalid', async () => {
    for (const response of [{ data: null, error: {} }, { data: { value: 'typo' }, error: null }]) {
      invalidateCorePromptMode(); mocks.read.mockResolvedValue(response);
      expect(await getCorePromptMode()).toBe('legacy');
    }
  });
  it('shares concurrent reads and rejects a failed configuration write', async () => {
    expect(await Promise.all([getCorePromptMode(), getCorePromptMode()])).toEqual(['layered', 'layered']);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    mocks.write.mockResolvedValue({ error: {} });
    await expect(setCorePromptMode('legacy')).rejects.toThrow();
  });
  it('does not let an older in-flight read overwrite a successful switch', async () => {
    let finish!: (v: unknown) => void;
    mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const old = getCorePromptMode();
    await setCorePromptMode('legacy');
    mocks.read.mockResolvedValue({ data: { value: 'legacy' }, error: null });
    expect(await getCorePromptMode()).toBe('legacy');
    finish({ data: { value: 'layered' }, error: null }); await old;
    expect(await getCorePromptMode()).toBe('legacy');
  });
  it('forbids non-admin reads and writes, validates input, and reports storage failures', async () => {
    const req = (body: unknown) => new NextRequest('http://localhost/api/admin/core-prompt', { method: 'PUT', body: JSON.stringify(body) });
    mocks.admin.mockResolvedValue(false);
    expect((await GET(req({}))).status).toBe(403);
    expect((await PUT(req({ mode: 'legacy' }))).status).toBe(403);
    expect(mocks.write).not.toHaveBeenCalled();
    mocks.admin.mockResolvedValue(true);
    expect((await PUT(req({ mode: 'invalid' }))).status).toBe(400);
    expect((await PUT(req(null))).status).toBe(400);
    mocks.read.mockResolvedValue({ data: { value: 'legacy' }, error: null });
    const saved = await PUT(req({ mode: 'legacy' }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ mode: 'legacy' });
    mocks.write.mockResolvedValue({ error: {} });
    expect((await PUT(req({ mode: 'layered' }))).status).toBe(503);
  });
});
