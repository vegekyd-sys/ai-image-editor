import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { isGalleryProjectId, parseGalleryCursor, readProjectGalleryPage } from '@/lib/server/project-gallery'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  // Verify the session with Auth before using an owner-scoped admin query.
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const cursorParam = req.nextUrl.searchParams.get('cursor')
  const projectId = req.nextUrl.searchParams.get('id') ?? undefined
  let cursor
  try {
    if (projectId && !isGalleryProjectId(projectId)) throw new Error('Invalid project ID')
    if (cursorParam) cursor = parseGalleryCursor(cursorParam)
  } catch {
    return NextResponse.json({ error: 'Invalid pagination parameters' }, { status: 400 })
  }
  try {
    const page = await readProjectGalleryPage(getSupabaseAdmin(), user.id, { cursor, projectId })
    return NextResponse.json(page, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Failed to load project gallery:', error)
    return NextResponse.json({ error: 'Project gallery unavailable' }, { status: 503 })
  }
}
