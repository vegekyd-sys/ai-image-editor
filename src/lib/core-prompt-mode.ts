import { getSupabaseAdmin } from './supabase/service';

export type CorePromptMode = 'legacy' | 'layered';
export const CORE_PROMPT_SETTING = 'core_prompt_mode';
export const CORE_PROMPT_CACHE_MS = 15_000;
let cached: { mode: CorePromptMode; expires: number } | undefined;
let pending: Promise<CorePromptMode> | undefined;
let generation = 0;

export function isCorePromptMode(value: unknown): value is CorePromptMode {
  return value === 'legacy' || value === 'layered';
}

/** Admin reads bypass the process cache, so a failed save never looks successful. */
export async function readCorePromptMode(): Promise<CorePromptMode> {
  const { data, error } = await getSupabaseAdmin().from('core_prompt_settings')
    .select('value').eq('key', CORE_PROMPT_SETTING)
    .abortSignal(AbortSignal.timeout(1_500)).maybeSingle();
  if (error) throw new Error('Core prompt configuration unavailable');
  if (!data) return 'layered';
  if (!isCorePromptMode(data.value)) throw new Error('Invalid core prompt configuration');
  return data.value;
}

/** Resolve once per Agent invocation; tool factories and system use the same value. */
export async function getCorePromptMode(): Promise<CorePromptMode> {
  if (cached && Date.now() < cached.expires) return cached.mode;
  if (pending) return pending;
  const startedGeneration = generation;
  const request = (async () => {
    let mode: CorePromptMode;
    try {
      mode = await readCorePromptMode();
    } catch {
      // Fail back to the old path on configuration outages, including cold starts.
      mode = 'legacy';
      console.warn('[core-prompt] configuration unavailable; using legacy');
    }
    if (generation === startedGeneration) cached = { mode, expires: Date.now() + CORE_PROMPT_CACHE_MS };
    return mode;
  })();
  pending = request;
  try { return await request; }
  finally { if (pending === request) pending = undefined; }
}

export function invalidateCorePromptMode() {
  generation += 1;
  cached = undefined;
  pending = undefined;
}

export async function setCorePromptMode(mode: CorePromptMode): Promise<void> {
  if (!isCorePromptMode(mode)) throw new Error('Invalid core prompt mode');
  const { error } = await getSupabaseAdmin().from('core_prompt_settings').upsert({
    key: CORE_PROMPT_SETTING, value: mode, updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (error) throw new Error('Core prompt configuration could not be saved');
  invalidateCorePromptMode();
}
