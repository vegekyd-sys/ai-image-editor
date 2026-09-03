import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CODEX_SUBSCRIPTION_ALLOWLIST_SETTING_KEY,
  getDynamicCodexSubscriptionAllowedUserIds,
  normalizeCodexSubscriptionUserIds,
  saveDynamicCodexSubscriptionAllowedUserIds,
} from '@/lib/codex-subscription-allowlist';

const previousOwner = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID;
const previousLegacy = process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (previousOwner === undefined) delete process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID;
  else process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID = previousOwner;
  if (previousLegacy === undefined) delete process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS;
  else process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS = previousLegacy;
});

function readClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as any, from, select, eq, maybeSingle };
}

describe('dynamic Codex subscription allowlist', () => {
  it('normalizes, trims, and deduplicates user ids', () => {
    expect(normalizeCodexSubscriptionUserIds([' a ', '', 'a', null, 'b'])).toEqual(['a', 'b']);
  });

  it('uses the legacy environment only until a database setting exists', async () => {
    process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID = 'owner-id';
    process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS = 'legacy-id';
    const missing = readClient({ data: null, error: null });
    await expect(getDynamicCodexSubscriptionAllowedUserIds(missing.client))
      .resolves.toEqual(['legacy-id', 'owner-id']);

    const stored = readClient({ data: { value: '["db-id"]' }, error: null });
    await expect(getDynamicCodexSubscriptionAllowedUserIds(stored.client))
      .resolves.toEqual(['db-id', 'owner-id']);
  });

  it('fails closed to the owner when storage is unavailable', async () => {
    process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID = 'owner-id';
    process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS = 'stale-id';
    const failed = readClient({ data: null, error: { message: 'offline' } });
    await expect(getDynamicCodexSubscriptionAllowedUserIds(failed.client))
      .resolves.toEqual(['owner-id']);
  });

  it('stores one authoritative JSON setting', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ upsert }));
    await expect(saveDynamicCodexSubscriptionAllowedUserIds(
      ['user-b', ' user-a ', 'user-b'],
      { from } as any,
    )).resolves.toEqual(['user-b', 'user-a']);
    expect(from).toHaveBeenCalledWith('app_settings');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      key: CODEX_SUBSCRIPTION_ALLOWLIST_SETTING_KEY,
      value: '["user-b","user-a"]',
    }), { onConflict: 'key' });
  });

  it('shares membership and protects both owners without reviving static Grok entries', async () => {
    vi.stubEnv('CODEX_SUBSCRIPTION_OWNER_USER_ID', 'codex-owner');
    vi.stubEnv('GROK_SUBSCRIPTION_OWNER_USER_ID', 'grok-owner');
    vi.stubEnv('GROK_SUBSCRIPTION_ALLOWED_USER_IDS', 'removed-user');
    const stored = readClient({ data: { value: '["shared-user"]' }, error: null });
    await expect(getDynamicCodexSubscriptionAllowedUserIds(stored.client))
      .resolves.toEqual(['shared-user', 'codex-owner', 'grok-owner']);
    const missing = readClient({ data: null, error: null });
    expect(await getDynamicCodexSubscriptionAllowedUserIds(missing.client)).toContain('removed-user');
  });

  it('prevents administrative writes based on unreadable or corrupt storage', async () => {
    const failed = readClient({ data: null, error: new Error('offline') });
    await expect(getDynamicCodexSubscriptionAllowedUserIds(failed.client, { strict: true })).rejects.toThrow('offline');
    for (const value of ['not json', '{}', '["user",123]']) {
      const corrupt = readClient({ data: { value }, error: null });
      await expect(getDynamicCodexSubscriptionAllowedUserIds(corrupt.client, { strict: true })).rejects.toThrow('invalid');
      expect(await getDynamicCodexSubscriptionAllowedUserIds(corrupt.client)).not.toContain('user');
    }
  });

  it('fails closed when the storage request rejects rather than returning an error', async () => {
    vi.stubEnv('CODEX_SUBSCRIPTION_OWNER_USER_ID', 'owner-id');
    const failed = readClient({ data: null, error: null });
    failed.maybeSingle.mockRejectedValue(new Error('network disconnected'));
    await expect(getDynamicCodexSubscriptionAllowedUserIds(failed.client)).resolves.toEqual(['owner-id']);
  });
});
