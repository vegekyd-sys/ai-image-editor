import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConfiguredAppleProducts } from '@/lib/billing/apple'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({
    appAccountToken: user.id,
    products: getConfiguredAppleProducts(),
  })
}
