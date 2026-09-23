import type { SupabaseClient } from '@supabase/supabase-js';
import { getCodexSubscriptionAllowedUserIds } from '@/lib/agent-models';
import { getSupabaseAdmin } from '@/lib/supabase/service';

export const CODEX_SUBSCRIPTION_ALLOWLIST_SETTING_KEY = 'codex_subscription_allowed_user_ids';

// Keep the persisted key and exports compatible with existing deployments.
// This is the shared personal-plan membership list. Codex also admits admins.
export function getPersonalSubscriptionOwnerUserIds(): string[] {
  return normalizeCodexSubscriptionUserIds([
    process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID,
    process.env.GROK_SUBSCRIPTION_OWNER_USER_ID,
  ]);
}

export function normalizeCodexSubscriptionUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean))];
}

function parseStoredUserIds(value: unknown, strict = false): string[] {
  try {
    if (typeof value !== 'string') throw new Error('invalid allowlist');
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string')) throw new Error('invalid allowlist');
    return normalizeCodexSubscriptionUserIds(parsed);
  } catch {
    if (strict) throw new Error('Stored personal subscription allowlist is invalid');
    return [];
  }
}

export async function getDynamicCodexSubscriptionAllowedUserIds(
  admin?: SupabaseClient,
  options: { strict?: boolean } = {},
): Promise<string[]> {
  const owners = getPersonalSubscriptionOwnerUserIds();
  let data;
  try {
    const result = await (admin ?? getSupabaseAdmin())
    .from('app_settings')
    .select('value')
    .eq('key', CODEX_SUBSCRIPTION_ALLOWLIST_SETTING_KEY)
    .maybeSingle();
    if (result.error) throw result.error;
    data = result.data;
  } catch (error) {
    if (options.strict) throw error;
    // Fail closed on a storage error. The owner remains available, but a stale
    // environment allowlist must not silently re-enable a removed test account.
    return owners;
  }

  const configured = data
    ? parseStoredUserIds(data.value, options.strict)
    : [...getCodexSubscriptionAllowedUserIds(),
        ...(process.env.GROK_SUBSCRIPTION_ALLOWED_USER_IDS || '').split(',')];
  configured.push(...owners);
  return normalizeCodexSubscriptionUserIds(configured);
}

export async function isDynamicCodexSubscriptionUserAllowed(
  userId: string | undefined,
  admin?: SupabaseClient,
): Promise<boolean> {
  if (!userId) return false;
  if (getPersonalSubscriptionOwnerUserIds().includes(userId)) return true;
  if ((await getDynamicCodexSubscriptionAllowedUserIds(admin)).includes(userId)) return true;
  const { data, error } = await (admin ?? getSupabaseAdmin())
    .from('user_profiles').select('is_admin').eq('id', userId).maybeSingle();
  return !error && data?.is_admin === true;
}

export async function getCodexSubscriptionEligibleUserIds(
  sharedUserIds: string[],
  admin: SupabaseClient = getSupabaseAdmin(),
): Promise<string[]> {
  const { data, error } = await admin.from('user_profiles').select('id').eq('is_admin', true);
  if (error) throw error;
  return normalizeCodexSubscriptionUserIds([
    ...sharedUserIds,
    ...(data ?? []).map(profile => profile.id),
  ]);
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
