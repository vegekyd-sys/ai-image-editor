import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/service'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await authenticateRequest(req)
  if ('error' in result) return result.error

  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('projects')
    .select('is_public')
    .eq('id', id)
    .eq('user_id', result.auth.userId)
    .single()

  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ is_public: data.is_public })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await authenticateRequest(req)
  if ('error' in result) return result.error

  const body = await req.json()
  const isPublic = Boolean(body.is_public)

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('projects')
    .update({ is_public: isPublic })
    .eq('id', id)
    .eq('user_id', result.auth.userId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ is_public: isPublic })
}
