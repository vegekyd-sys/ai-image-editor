import {
  getDynamicCodexSubscriptionAllowedUserIds,
  getCodexSubscriptionEligibleUserIds,
  getGeminiSubscriptionEligibleUserIds,
  getPersonalSubscriptionOwnerUserIds,
  normalizeCodexSubscriptionUserIds,
  saveDynamicCodexSubscriptionAllowedUserIds,
} from './codex-subscription-allowlist';
import { readCodexSubscriptionRelayAllowlist, syncCodexSubscriptionRelayAllowlist } from './codex-subscription';
import { getGrokSubscriptionOwnerUserId, readGrokSubscriptionRelayAllowlist, syncGrokSubscriptionRelayAllowlist } from './grok-subscription';

import { geminiRelayConfig, readGeminiSubscriptionRelayAllowlist, syncGeminiSubscriptionRelayAllowlist } from './gemini-video-subscription';

export type PersonalPlanProvider = 'codex' | 'grok' | 'gemini';
export type PersonalPlanSyncStatus = 'synced' | 'pending' | 'unavailable' | 'disabled';

function relayControls() {
  const google = geminiRelayConfig();
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
    ...(process.env.GEMINI_VIDEO_RELAY_ENABLED === 'true' ? [{
      id: 'gemini' as const, owner: google?.owner,
      read: readGeminiSubscriptionRelayAllowlist, write: syncGeminiSubscriptionRelayAllowlist,
    }] : []),
  ];
}

function sameMembers(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every(id => right.has(id));
}

export async function getPersonalPlanSyncStatus(userIds: string[]): Promise<Record<PersonalPlanProvider, PersonalPlanSyncStatus>> {
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
      const expected = relay.id === 'codex' ? codexIds
        : relay.id === 'gemini' ? await getGeminiSubscriptionEligibleUserIds(userIds) : userIds;
      return [relay.id, sameMembers(remote, expected) ? 'synced' : 'pending'] as const;
    } catch {
      return [relay.id, 'unavailable'] as const;
    }
  }));
  return { gemini: 'disabled', ...Object.fromEntries(statuses) } as Record<PersonalPlanProvider, PersonalPlanSyncStatus>;
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
    const geminiNext = process.env.GEMINI_VIDEO_RELAY_ENABLED === 'true'
      ? await getGeminiSubscriptionEligibleUserIds(next) : [];
    if (next.length > 100 || codexNext.length > 100) throw new Error('Personal subscription allowlist is limited to 100 accounts');
    const relays = relayControls();
    // Read all actual lists before any write. Grok may still contain a legacy
    // subset; rolling it back to the DB list would accidentally grant access.
    const snapshots = await Promise.all(relays.map(async relay => {
      if (!relay.owner) throw new Error(`${relay.id} owner is not configured`);
      return relay.read(relay.owner);
    }));
    const attempted: number[] = [];
    try {
      for (const [index, relay] of relays.entries()) {
        attempted.push(index); // also roll back a timed-out, possibly-applied write
        await relay.write(relay.id === 'codex' ? codexNext : relay.id === 'gemini' ? geminiNext : next, relay.owner!);
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
    const google = relayControls().find(relay => relay.id === 'gemini');
    const googleEligible = google ? await getGeminiSubscriptionEligibleUserIds(shared) : [];
    if (google && !google.owner) throw new Error('Google owner is not configured');
    const googleSnapshot = google ? await google.read(google.owner!) : undefined;
    try {
      if (!sameMembers(snapshot, eligible)) await syncCodexSubscriptionRelayAllowlist(eligible, owner);
      if (google && !sameMembers(googleSnapshot!, googleEligible)) await google.write(googleEligible, google.owner!);
    } catch (error) {
      try {
        const results = await Promise.allSettled([syncCodexSubscriptionRelayAllowlist(snapshot, owner),
          ...(google ? [google.write(googleSnapshot!, google.owner!)] : [])]);
        if (results.some(result => result.status === 'rejected')) throw new Error('rollback failed');
      } catch {
        throw new Error('CODEX_ADMIN_SYNC_INCOMPLETE: relay rollback failed; retry synchronization');
      }
      throw error;
    }
  });
  updateQueue = operation.catch(() => undefined);
  return operation;
}
