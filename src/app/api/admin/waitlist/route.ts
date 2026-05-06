import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { isAdmin } from '@/lib/admin'
import { getSupabaseAdmin } from '@/lib/supabase/service'

async function checkAdmin(req: Request): Promise<string | null> {
  const authResult = await authenticateRequest(req)
  if ('error' in authResult) return null
  const ok = await isAdmin(authResult.auth.userId)
  return ok ? authResult.auth.userId : null
}

// GET: list all waitlist entries
export async function GET(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await getSupabaseAdmin()
    .from('waitlist')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
