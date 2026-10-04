// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), isAdmin: vi.fn(), update: vi.fn(), read: vi.fn(), status: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mocks.auth }));
vi.mock('@/lib/admin', () => ({ isAdmin: mocks.isAdmin }));
vi.mock('@/lib/codex-subscription-allowlist', () => ({
  getDynamicCodexSubscriptionAllowedUserIds: mocks.read,
  getPersonalSubscriptionOwnerUserIds: () => ['codex-owner', 'grok-owner'],
}));
vi.mock('@/lib/personal-subscription-admin', () => ({
  getPersonalPlanSyncStatus: mocks.status,
  updatePersonalSubscriptionAllowlist: mocks.update,
}));
vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: () => ({ auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@test.invalid` } } }) } } }),
}));
import { GET, POST, DELETE, PUT } from '@/app/api/admin/personal-subscription-allowlist/route';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ auth: { userId: 'admin' } });
  mocks.isAdmin.mockResolvedValue(true);
  mocks.read.mockResolvedValue(['codex-owner', 'grok-owner', 'member']);
  mocks.status.mockResolvedValue({ codex: 'synced', grok: 'pending' });
  mocks.update.mockImplementation(async mutate => mutate(['codex-owner', 'grok-owner', 'member']));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://database.test.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const req = (method: string, body?: unknown) => new NextRequest('http://localhost/api/admin/personal-subscription-allowlist', {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe('personal plan admin API', () => {
  it('denies every method to non-admins before reading or changing membership', async () => {
    mocks.isAdmin.mockResolvedValue(false);
    for (const [method, handler] of [['GET', GET], ['POST', POST], ['DELETE', DELETE], ['PUT', PUT]] as const) {
      expect((await handler(req(method))).status).toBe(403);
    }
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('returns both provider states and marks both owners as immutable', async () => {
    const response = await GET(req('GET'));
    const payload = await response.json();
    expect(payload.providers).toEqual({ codex: 'synced', grok: 'pending' });
    expect(payload.users.map((user: { isOwner: boolean }) => user.isOwner)).toEqual([true, true, false]);
    for (const userId of ['codex-owner', 'grok-owner']) {
      expect((await DELETE(req('DELETE', { userId }))).status).toBe(400);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('adds an existing registered account and removes it through the shared coordinator', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ users: [{ id: 'new', email: 'new@test.invalid' }] }))));
    const added = await POST(req('POST', { email: ' New@Test.Invalid ' }));
    expect(added.status).toBe(200);
    expect((await added.json()).users.map((u: { userId: string }) => u.userId)).toContain('new');
    const removed = await DELETE(req('DELETE', { userId: 'member' }));
    expect((await removed.json()).users.map((u: { userId: string }) => u.userId)).not.toContain('member');
  });

  it('does not grant access to an unregistered or partial-match account', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ users: [{ id: 'other', email: 'not-new@test.invalid' }] }))));
    expect((await POST(req('POST', { email: 'new@test.invalid' }))).status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('provides a repair sync and returns failure instead of false success on relay errors', async () => {
    expect((await PUT(req('PUT'))).status).toBe(200);
    mocks.update.mockRejectedValueOnce(new Error('relay offline'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = await PUT(req('PUT'));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'personal_plan_sync_failed' });
  });
});
