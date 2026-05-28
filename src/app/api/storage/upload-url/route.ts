import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/service'

const BUCKET = 'images'

/**
 * POST /api/storage/upload-url — Generate a signed upload URL for Supabase Storage.
 *
 * CLI/external agents call this to get a pre-signed URL, then PUT the file directly
 * to Supabase Storage (bypasses Vercel body size limit).
 *
 * Body: { projectId?, filename, contentType }
 * Returns: { uploadUrl, publicUrl, path }
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest(req)
    if ('error' in authResult) return authResult.error
    const { userId } = authResult.auth

    const { projectId, filename, contentType } = await req.json()

    if (!filename) {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 })
    }

    const ext = filename.split('.').pop()?.toLowerCase() || 'bin'
    const fileId = crypto.randomUUID()
    const uploadScope = projectId ? `${projectId}/uploads` : 'standalone/uploads'
    const storagePath = `${userId}/${uploadScope}/${fileId}.${ext}`

    const admin = getSupabaseAdmin()
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath)

    if (error || !data) {
      console.error('createSignedUploadUrl error:', error)
      return NextResponse.json({ error: error?.message || 'Failed to create upload URL' }, { status: 500 })
    }

    const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(storagePath)

    return NextResponse.json({
      uploadUrl: data.signedUrl,
      token: data.token,
      path: storagePath,
      publicUrl: publicData.publicUrl,
      contentType: contentType || 'application/octet-stream',
    })
  } catch (err) {
    console.error('upload-url error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
