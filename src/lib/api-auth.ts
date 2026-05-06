import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { validateApiKey } from '@/lib/billing/api-keys'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuthResult {
  userId: string
  supabase: SupabaseClient
}

export async function authenticateRequest(
  req: Request
): Promise<{ auth: AuthResult } | { error: Response }> {
  const header = req.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null

  if (token?.startsWith('mk_live_')) {
    const result = await validateApiKey(token)
    if (!result) {
      return { error: new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401, headers: { 'Content-Type': 'application/json' } }) }
    }
    return { auth: { userId: result.userId, supabase: getSupabaseAdmin() } }
  }

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) {
    return { error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } }) }
  }
  return { auth: { userId: user.id, supabase } }
}
