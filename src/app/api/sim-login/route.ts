import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: 'test-claude@makaron.app',
    password: 'TestAccount2026!',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const url = new URL('/home', 'http://localhost:3000')
  const res = NextResponse.redirect(url)
  res.cookies.set('mkr_activated', '1', { path: '/', maxAge: 86400 })
  return res
}
