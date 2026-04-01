import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBalance } from '@/lib/billing/credits'

// GET: get current user's credit balance
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const balance = await getBalance(user.id)
  return NextResponse.json(balance)
}
