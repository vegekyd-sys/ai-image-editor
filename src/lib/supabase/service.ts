import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Server-only admin client with service_role key
// Used for accessing tables without RLS (e.g. invite_codes)
let _admin: SupabaseClient | null = null

export function getSupabaseAdmin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _admin
}
