import { createHash, randomBytes } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/service'

const KEY_PREFIX = 'mk_live_'

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Generate a new API key for a user.
 * Returns the full key (shown once) + DB record.
 */
export async function generateApiKey(userId: string, name?: string): Promise<{ key: string; id: string; prefix: string }> {
  const raw = randomBytes(32).toString('hex')
  const fullKey = `${KEY_PREFIX}${raw}`
  const prefix = fullKey.slice(0, 16) // mk_live_XXXXXXXX
  const hash = hashKey(fullKey)

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('api_keys')
    .insert({
      user_id: userId,
      key_hash: hash,
      key_prefix: prefix,
      name: name || 'Default',
    })
    .select('id')
    .single()
  if (error) throw new Error(`Failed to create API key: ${error.message}`)

  // Create credit balance if not exists
  await admin
    .from('credit_balances')
    .upsert({ user_id: userId, balance: 100 }, { onConflict: 'user_id', ignoreDuplicates: true })

  return { key: fullKey, id: data.id, prefix }
}

/**
 * Validate an API key. Returns user_id and key record if valid.
 */
export async function validateApiKey(key: string): Promise<{ userId: string; keyId: string } | null> {
  if (!key.startsWith(KEY_PREFIX)) return null
  const hash = hashKey(key)

  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('api_keys')
    .select('id, user_id')
    .eq('key_hash', hash)
    .eq('is_active', true)
    .single()
  if (!data) return null

  // Update last_used_at (fire-and-forget)
  admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {})

  return { userId: data.user_id, keyId: data.id }
}

/**
 * List API keys for a user (no secrets, just metadata).
 */
export async function listApiKeys(userId: string) {
  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('api_keys')
    .select('id, key_prefix, name, is_active, created_at, last_used_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  return data ?? []
}

/**
 * Deactivate an API key.
 */
export async function deactivateApiKey(userId: string, keyId: string) {
  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('api_keys')
    .update({ is_active: false })
    .eq('id', keyId)
    .eq('user_id', userId)
  if (error) throw new Error(`Failed to deactivate key: ${error.message}`)
}
