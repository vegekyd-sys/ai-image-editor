import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Server-only admin client with service_role key
// Used for accessing tables without RLS (e.g. invite_codes)
let _admin: SupabaseClient | null = null

function readEnv(name: string): string {
  const value = process.env[name]?.replace(/\\[rn]|[\u0000-\u001F\u007F]/g, '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function getSupabaseAdmin() {
  if (!_admin) {
    _admin = createClient(
      readEnv('NEXT_PUBLIC_SUPABASE_URL'),
      readEnv('SUPABASE_SERVICE_ROLE_KEY')
    )
  }
  return _admin
}
