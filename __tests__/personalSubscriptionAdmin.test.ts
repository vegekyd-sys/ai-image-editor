import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readDb: vi.fn(), saveDb: vi.fn(), codexRead: vi.fn(), grokRead: vi.fn(),
  codexWrite: vi.fn(), grokWrite: vi.fn(),
}));
vi.mock('@/lib/codex-subscription-allowlist', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/codex-subscription-allowlist')>(),
  getDynamicCodexSubscriptionAllowedUserIds: mocks.readDb,
  saveDynamicCodexSubscriptionAllowedUserIds: mocks.saveDb,
}));
vi.mock('@/lib/codex-subscription', () => ({
  readCodexSubscriptionRelayAllowlist: mocks.codexRead,
  syncCodexSubscriptionRelayAllowlist: mocks.codexWrite,
}));
vi.mock('@/lib/grok-subscription', () => ({
  getGrokSubscriptionOwnerUserId: () => 'owner',
  readGrokSubscriptionRelayAllowlist: mocks.grokRead,
  syncGrokSubscriptionRelayAllowlist: mocks.grokWrite,
}));
import { getPersonalPlanSyncStatus, updatePersonalSubscriptionAllowlist } from '@/lib/personal-subscription-admin';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CODEX_SUBSCRIPTION_OWNER_USER_ID', 'owner');
  vi.stubEnv('GROK_SUBSCRIPTION_OWNER_USER_ID', 'owner');
  mocks.readDb.mockResolvedValue(['owner', 'existing']);
  mocks.codexRead.mockResolvedValue(['owner', 'existing']);
  mocks.grokRead.mockResolvedValue(['owner']); // historical Grok roster is a subset
  mocks.codexWrite.mockResolvedValue(undefined);
  mocks.grokWrite.mockResolvedValue(undefined);
  mocks.saveDb.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe('one personal-plan roster, two independently synchronized relays', () => {
  it('adds to both relays before committing the shared setting', async () => {
    const next = await updatePersonalSubscriptionAllowlist(ids => [...ids, 'new', 'new']);
    expect(next).toEqual(['owner', 'existing', 'new']);
    expect(mocks.codexWrite).toHaveBeenCalledWith(next, 'owner');
    expect(mocks.grokWrite).toHaveBeenCalledWith(next, 'owner');
    expect(mocks.saveDb).toHaveBeenCalledWith(next);
    expect(mocks.saveDb.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.grokWrite.mock.invocationCallOrder[0]);
    expect(mocks.readDb).toHaveBeenCalledWith(undefined, { strict: true });
  });

  it('removes from both relays but preserves both owners', async () => {
    vi.stubEnv('GROK_SUBSCRIPTION_OWNER_USER_ID', 'second-owner');
    expect(await updatePersonalSubscriptionAllowlist(() => []))
      .toEqual(['owner', 'second-owner']);
    expect(mocks.grokWrite).toHaveBeenCalledWith(['owner', 'second-owner'], 'owner');
  });

  it('syncs an unchanged roster to repair a legacy Grok subset', async () => {
    await updatePersonalSubscriptionAllowlist(ids => ids);
    expect(mocks.grokWrite).toHaveBeenCalledWith(['owner', 'existing'], 'owner');
  });

  it('does not write anything if either relay snapshot or the DB cannot be read', async () => {
    mocks.grokRead.mockRejectedValueOnce(new Error('old relay has no control API'));
    await expect(updatePersonalSubscriptionAllowlist(ids => [...ids, 'new'])).rejects.toThrow('control API');
    expect(mocks.codexWrite).not.toHaveBeenCalled();
    expect(mocks.saveDb).not.toHaveBeenCalled();
    mocks.readDb.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(updatePersonalSubscriptionAllowlist(ids => ids)).rejects.toThrow('storage unavailable');
    expect(mocks.codexWrite).not.toHaveBeenCalled();
  });

  it('rolls back to each actual snapshot after a possibly-applied Grok timeout', async () => {
    mocks.grokWrite.mockRejectedValueOnce(new Error('timeout'));
    await expect(updatePersonalSubscriptionAllowlist(ids => [...ids, 'new'])).rejects.toThrow('timeout');
    expect(mocks.codexWrite).toHaveBeenLastCalledWith(['owner', 'existing'], 'owner');
    expect(mocks.grokWrite).toHaveBeenLastCalledWith(['owner'], 'owner');
    expect(mocks.saveDb).not.toHaveBeenCalled();
  });

  it('restores both relays if saving membership fails', async () => {
    mocks.saveDb.mockRejectedValueOnce(new Error('DB write failed'));
    await expect(updatePersonalSubscriptionAllowlist(ids => [...ids, 'new'])).rejects.toThrow('DB write failed');
    expect(mocks.codexWrite).toHaveBeenLastCalledWith(['owner', 'existing'], 'owner');
    expect(mocks.grokWrite).toHaveBeenLastCalledWith(['owner'], 'owner');
  });

  it('reports an incomplete sync when compensation also fails; later attempts still work', async () => {
    mocks.grokWrite.mockRejectedValueOnce(new Error('write timeout')).mockRejectedValueOnce(new Error('rollback timeout'));
    await expect(updatePersonalSubscriptionAllowlist(ids => ids)).rejects.toThrow('PERSONAL_PLAN_SYNC_INCOMPLETE');
    await expect(updatePersonalSubscriptionAllowlist(ids => ids)).resolves.toEqual(['owner', 'existing']);
  });

  it('serializes same-instance edits and reads fresh membership for each', async () => {
    let stored = ['owner'];
    mocks.readDb.mockImplementation(async () => [...stored]);
    mocks.saveDb.mockImplementation(async ids => { stored = ids; });
    await Promise.all([
      updatePersonalSubscriptionAllowlist(ids => [...ids, 'first']),
      updatePersonalSubscriptionAllowlist(ids => [...ids, 'second']),
    ]);
    expect(stored).toEqual(['owner', 'first', 'second']);
  });

  it('reports synced, pending, and unreachable independently without conflating quotas', async () => {
    expect(await getPersonalPlanSyncStatus(['existing', 'owner']))
      .toEqual({ codex: 'synced', grok: 'pending' });
    mocks.grokRead.mockRejectedValueOnce(new Error('offline'));
    expect(await getPersonalPlanSyncStatus(['owner', 'existing']))
      .toEqual({ codex: 'synced', grok: 'unavailable' });
  });

  it('rejects oversized membership before writing', async () => {
    await expect(updatePersonalSubscriptionAllowlist(() => Array.from({ length: 100 }, (_, i) => `user-${i}`)))
      .rejects.toThrow('100 accounts');
    expect(mocks.codexWrite).not.toHaveBeenCalled();
  });
});
