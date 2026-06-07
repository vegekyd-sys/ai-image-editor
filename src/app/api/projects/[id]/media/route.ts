import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import type { VideoMeta } from '@/types'

type ProjectRow = {
  id: string
  title?: string | null
  is_public?: boolean | null
  user_id?: string | null
}

type SnapshotRow = {
  id: string
  image_url?: string | null
  description?: string | null
  type?: string | null
  design_path?: string | null
  sort_order?: number | null
  created_at?: string | null
  video_meta?: VideoMeta | null
}

function appUrl(req: NextRequest): string {
  return process.env.MAKARON_APP_URL || new URL(req.url).origin
}

function mediaType(snapshot: SnapshotRow): 'image' | 'video' | 'composition' | 'reference' {
  if (snapshot.type === 'video') return 'video'
  if (snapshot.type === 'reference') return 'reference'
  if (snapshot.design_path) return 'composition'
  return 'image'
}

function firstLine(text: string | null | undefined): string | undefined {
  return text?.split('\n').find(line => line.trim())?.trim() || undefined
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const admin = getSupabaseAdmin()
    const authResult = await authenticateRequest(req)
    const authUserId = 'auth' in authResult ? authResult.auth.userId : null
    const hasBearerAuth = req.headers.get('authorization')?.startsWith('Bearer ') ?? false

    const { data: project } = await admin
      .from('projects')
      .select('id, title, is_public, user_id')
      .eq('id', id)
      .maybeSingle<ProjectRow>()

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const isPublic = project.is_public === true
    if (!isPublic && (!authUserId || authUserId !== project.user_id)) {
      return 'error' in authResult ? authResult.error : NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (hasBearerAuth && 'error' in authResult) return authResult.error

    const { data: snapshots, error } = await admin
      .from('snapshots')
      .select('id, image_url, description, type, design_path, sort_order, created_at, video_meta')
      .eq('project_id', id)
      .order('sort_order', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const media = ((snapshots ?? []) as SnapshotRow[]).map((snapshot, idx) => {
      const type = mediaType(snapshot)
      const videoMeta = snapshot.video_meta ?? undefined
      const url = type === 'video'
        ? videoMeta?.videoUrl || snapshot.image_url || undefined
        : snapshot.image_url || undefined
      const description = type === 'video'
        ? firstLine(snapshot.description) || firstLine(videoMeta?.prompt) || 'Video snapshot'
        : firstLine(snapshot.description)

      return {
        id: `media_${idx + 1}`,
        index: idx + 1,
        ref: `<<<media_${idx + 1}>>>`,
        type,
        status: type === 'video' ? (videoMeta?.status || 'completed') : 'completed',
        snapshot_id: snapshot.id,
        snapshotId: snapshot.id,
        url,
        ...(type === 'video' ? { posterUrl: snapshot.image_url || undefined } : {}),
        ...(description ? { description } : {}),
        ...(snapshot.design_path && type !== 'video' ? { codePath: snapshot.design_path } : {}),
        ...(videoMeta?.taskId ? { task_id: videoMeta.taskId, taskId: videoMeta.taskId } : {}),
        ...(typeof videoMeta?.duration === 'number' ? { duration: videoMeta.duration } : {}),
        ...(typeof videoMeta?.width === 'number' ? { width: videoMeta.width } : {}),
        ...(typeof videoMeta?.height === 'number' ? { height: videoMeta.height } : {}),
        ...(snapshot.created_at ? { created_at: snapshot.created_at } : {}),
      }
    })

    return NextResponse.json({
      projectId: project.id,
      project_id: project.id,
      title: project.title || 'Untitled',
      projectUrl: `${appUrl(req)}/projects/${project.id}`,
      media,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
