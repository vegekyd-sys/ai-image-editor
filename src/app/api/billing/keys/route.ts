import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateApiKey, listApiKeys, deactivateApiKey } from '@/lib/billing/api-keys'

// GET: list current user's API keys
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const keys = await listApiKeys(user.id)
  return NextResponse.json({ keys })
}

// POST: generate a new API key
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await req.json().catch(() => ({ name: undefined }))
  const result = await generateApiKey(user.id, name)
  // Return full key ONCE — never stored in plaintext
  return NextResponse.json({ key: result.key, id: result.id, prefix: result.prefix })
}

// DELETE: deactivate an API key
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await deactivateApiKey(user.id, id)
  return NextResponse.json({ success: true })
}
