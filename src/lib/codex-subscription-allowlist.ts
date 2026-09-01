import type { SupabaseClient } from '@supabase/supabase-js';
import { getCodexSubscriptionAllowedUserIds } from '@/lib/agent-models';
import { getSupabaseAdmin } from '@/lib/supabase/service';

export const CODEX_SUBSCRIPTION_ALLOWLIST_SETTING_KEY = 'codex_subscription_allowed_user_ids';

export function normalizeCodexSubscriptionUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean))];
}

function parseStoredUserIds(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    return normalizeCodexSubscriptionUserIds(JSON.parse(value));
  } catch {
    return [];
  }
}

export async function getDynamicCodexSubscriptionAllowedUserIds(
  admin: SupabaseClient = getSupabaseAdmin(),
): Promise<string[]> {
  const ownerUserId = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID?.trim();
  const { data, error } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', CODEX_SUBSCRIPTION_ALLOWLIST_SETTING_KEY)
    .maybeSingle();

  if (error) {
    // Fail closed on a storage error. The owner remains available, but a stale
    // environment allowlist must not silently re-enable a removed test account.
    return ownerUserId ? [ownerUserId] : [];
  }

  const configured = data
    ? parseStoredUserIds(data.value)
    : [...getCodexSubscriptionAllowedUserIds()];
  if (ownerUserId) configured.push(ownerUserId);
  return normalizeCodexSubscriptionUserIds(configured);
}

export async function isDynamicCodexSubscriptionUserAllowed(
  userId: string | undefined,
  admin: SupabaseClient = getSupabaseAdmin(),
): Promise<boolean> {
  if (!userId) return false;
  return (await getDynamicCodexSubscriptionAllowedUserIds(admin)).includes(userId);
}

export async function saveDynamicCodexSubscriptionAllowedUserIds(
  userIds: string[],
  admin: SupabaseClient = getSupabaseAdmin(),
): Promise<string[]> {
  const normalized = normalizeCodexSubscriptionUserIds(userIds);
  const { error } = await admin.from('app_settings').upsert({
    key: CODEX_SUBSCRIPTION_ALLOWLIST_SETTING_KEY,
    value: JSON.stringify(normalized),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (error) throw new Error(`Unable to save Codex subscription allowlist: ${error.message}`);
  return normalized;
}
