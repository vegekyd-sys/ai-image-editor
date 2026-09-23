import {
  getDynamicCodexSubscriptionAllowedUserIds,
  getCodexSubscriptionEligibleUserIds,
  getPersonalSubscriptionOwnerUserIds,
  normalizeCodexSubscriptionUserIds,
  saveDynamicCodexSubscriptionAllowedUserIds,
} from './codex-subscription-allowlist';
import { readCodexSubscriptionRelayAllowlist, syncCodexSubscriptionRelayAllowlist } from './codex-subscription';
import { getGrokSubscriptionOwnerUserId, readGrokSubscriptionRelayAllowlist, syncGrokSubscriptionRelayAllowlist } from './grok-subscription';

export type PersonalPlanSyncStatus = 'synced' | 'pending' | 'unavailable';

function relayControls() {
  return [
    {
      id: 'codex' as const,
      owner: process.env.CODEX_SUBSCRIPTION_RELAY_OWNER_USER_ID?.trim()
        || process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID?.trim(),
      read: readCodexSubscriptionRelayAllowlist,
      write: syncCodexSubscriptionRelayAllowlist,
    },
    {
      id: 'grok' as const,
      owner: getGrokSubscriptionOwnerUserId(),
      read: readGrokSubscriptionRelayAllowlist,
      write: syncGrokSubscriptionRelayAllowlist,
    },
  ];
}

function sameMembers(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every(id => right.has(id));
}

export async function getPersonalPlanSyncStatus(userIds: string[]): Promise<Record<'codex' | 'grok', PersonalPlanSyncStatus>> {
  let codexIds: string[];
  try {
    codexIds = await getCodexSubscriptionEligibleUserIds(userIds);
  } catch {
    codexIds = [];
  }
  const statuses = await Promise.all(relayControls().map(async relay => {
    try {
      if (relay.id === 'codex' && codexIds.length === 0) throw new Error('admin roster unavailable');
      if (!relay.owner) throw new Error('owner not configured');
      const remote = await relay.read(relay.owner);
      return [relay.id, sameMembers(remote, relay.id === 'codex' ? codexIds : userIds) ? 'synced' : 'pending'] as const;
    } catch {
      return [relay.id, 'unavailable'] as const;
    }
  }));
  return Object.fromEntries(statuses) as Record<'codex' | 'grok', PersonalPlanSyncStatus>;
}

// Serialize edits within an instance; compute mutations from fresh state inside
// the queue, so simultaneous UI submissions do not reuse a stale list.
let updateQueue: Promise<unknown> = Promise.resolve();

export function updatePersonalSubscriptionAllowlist(
  mutate: (previous: string[]) => string[],
): Promise<string[]> {
  const operation = updateQueue.then(async () => {
    const previous = await getDynamicCodexSubscriptionAllowedUserIds(undefined, { strict: true });
    const next = normalizeCodexSubscriptionUserIds([...mutate(previous), ...getPersonalSubscriptionOwnerUserIds()]);
    const codexNext = await getCodexSubscriptionEligibleUserIds(next);
    if (next.length > 100 || codexNext.length > 100) throw new Error('Personal subscription allowlist is limited to 100 accounts');
    const relays = relayControls();
    // Read BOTH actual lists before any write. Grok may still contain a legacy
    // subset; rolling it back to the DB list would accidentally grant access.
    const snapshots = await Promise.all(relays.map(async relay => {
      if (!relay.owner) throw new Error(`${relay.id} owner is not configured`);
      return relay.read(relay.owner);
    }));
    const attempted: number[] = [];
    try {
      for (const [index, relay] of relays.entries()) {
        attempted.push(index); // also roll back a timed-out, possibly-applied write
        await relay.write(relay.id === 'codex' ? codexNext : next, relay.owner!);
      }
      await saveDynamicCodexSubscriptionAllowedUserIds(next);
      return next;
    } catch (error) {
      const rollback = await Promise.allSettled(attempted.map(index =>
        relays[index].write(snapshots[index], relays[index].owner!),
      ));
      if (rollback.some(result => result.status === 'rejected')) {
        throw new Error('PERSONAL_PLAN_SYNC_INCOMPLETE: relay rollback failed; retry synchronization');
      }
      throw error;
    }
  });
  updateQueue = operation.catch(() => undefined);
  return operation;
}

// Reconcile an admin role change without changing the shared Grok membership.
export function syncCodexAdminAllowlist(): Promise<void> {
  const operation = updateQueue.then(async () => {
    const shared = await getDynamicCodexSubscriptionAllowedUserIds(undefined, { strict: true });
    const eligible = await getCodexSubscriptionEligibleUserIds(shared);
    if (eligible.length > 100) throw new Error('Codex subscription allowlist is limited to 100 accounts');
    const owner = process.env.CODEX_SUBSCRIPTION_RELAY_OWNER_USER_ID?.trim()
      || process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID?.trim();
    if (!owner) throw new Error('Codex owner is not configured');
    const snapshot = await readCodexSubscriptionRelayAllowlist(owner);
    if (sameMembers(snapshot, eligible)) return;
    try {
      await syncCodexSubscriptionRelayAllowlist(eligible, owner);
    } catch (error) {
      try {
        await syncCodexSubscriptionRelayAllowlist(snapshot, owner);
      } catch {
        throw new Error('CODEX_ADMIN_SYNC_INCOMPLETE: relay rollback failed; retry synchronization');
      }
      throw error;
    }
  });
  updateQueue = operation.catch(() => undefined);
  return operation;
}
