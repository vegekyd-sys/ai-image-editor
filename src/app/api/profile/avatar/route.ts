import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import sharp from 'sharp'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('avatar') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const raw = Buffer.from(await file.arrayBuffer())
  const buffer = await sharp(raw).resize(200, 200, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer()
  const storagePath = `avatars/${user.id}.jpg`

  const admin = getSupabaseAdmin()
  const { error: uploadError } = await admin.storage
    .from('images')
    .upload(storagePath, buffer, {
      contentType: 'image/jpeg',
      upsert: true,
    })
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = admin.storage.from('images').getPublicUrl(storagePath)

  // Append cache-buster so browsers pick up new avatar
  const avatarUrl = `${publicUrl}?v=${Date.now()}`

  // Store in user_metadata
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, avatar_url: avatarUrl },
  })
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ avatar_url: avatarUrl })
}
