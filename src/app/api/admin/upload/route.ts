import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { isAdmin } from '@/lib/admin'
import { getSupabaseAdmin } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  const authResult = await authenticateRequest(req)
  if ('error' in authResult) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await isAdmin(authResult.auth.userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const storagePath = formData.get('path') as string | null

  if (!file || !storagePath) {
    return NextResponse.json({ error: 'file and path are required' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const admin = getSupabaseAdmin()
  const { error } = await admin.storage
    .from('images')
    .upload(storagePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: true,
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: { publicUrl } } = admin.storage.from('images').getPublicUrl(storagePath)
  return NextResponse.json({ url: publicUrl })
}
