import { getSupabaseAdmin } from '@/lib/supabase/service'

export async function isAdmin(userId: string): Promise<boolean> {
  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('user_profiles')
    .select('is_admin')
    .eq('id', userId)
    .single()
  return data?.is_admin === true
}
