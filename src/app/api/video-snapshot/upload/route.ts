import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { uploadVideo } from '@/lib/supabase/storage'
import type { VideoMeta } from '@/types'

export const maxDuration = 60

/**
 * POST /api/video-snapshot/upload — Upload a user video as a timeline snapshot.
 *
 * Used by CLI `chat --video` to add video files to a project timeline.
 * Creates a completed video snapshot (type='video', status='completed').
 *
 * Body: { projectId, videoUrl } or multipart form with video file + projectId.
 * Returns: { snapshotId, videoUrl, posterUrl }
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest(req)
    if ('error' in authResult) return authResult.error
    const { userId, supabase } = authResult.auth

    let projectId: string
    let videoBuffer: Uint8Array | null = null
    let videoUrl: string | undefined
    let duration: number | undefined
    let width: number | undefined
    let height: number | undefined

    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      projectId = form.get('projectId') as string
      const file = form.get('video') as File | null
      if (!file) return NextResponse.json({ error: 'No video file provided' }, { status: 400 })
      videoBuffer = new Uint8Array(await file.arrayBuffer())
      duration = Number(form.get('duration')) || undefined
      width = Number(form.get('width')) || undefined
      height = Number(form.get('height')) || undefined
    } else {
      const body = await req.json()
      projectId = body.projectId
      videoUrl = body.videoUrl
      duration = body.duration
      width = body.width
      height = body.height
      if (videoUrl && !videoUrl.startsWith('http')) {
        return NextResponse.json({ error: 'videoUrl must be a valid URL' }, { status: 400 })
      }
    }

    if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })

    // Verify project ownership
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const snapshotId = crypto.randomUUID()

    // If URL provided, fetch and upload to our Storage
    if (videoUrl && !videoBuffer) {
      const res = await fetch(videoUrl)
      if (!res.ok) return NextResponse.json({ error: `Failed to fetch video: ${res.status}` }, { status: 400 })
      videoBuffer = new Uint8Array(await res.arrayBuffer())
    }

    let permanentUrl = videoUrl || ''
    if (videoBuffer) {
      // Probe dimensions if not provided
      if (!width || !height) {
        try {
          const { probeMP4Dimensions } = await import('@/lib/mp4-probe')
          const dims = probeMP4Dimensions(videoBuffer)
          if (dims) { width = dims.width; height = dims.height }
        } catch { /* non-fatal */ }
      }

      const uploaded = await uploadVideo(supabase, userId, projectId, snapshotId, videoBuffer)
      if (uploaded) permanentUrl = uploaded
    }

    if (!permanentUrl) {
      return NextResponse.json({ error: 'Failed to upload video' }, { status: 500 })
    }

    // Use first frame as poster (just use the video URL for now — frontend captures poster on play)
    const posterUrl = permanentUrl

    const videoMeta: VideoMeta = {
      taskId: null,
      videoUrl: permanentUrl,
      prompt: '',
      sourceSnapshotIds: [],
      sourceUrls: [],
      status: 'completed',
      duration: duration || null,
      model: 'upload',
      createdAt: new Date().toISOString(),
      width,
      height,
    }

    // Atomic sort_order
    const { data: sortData } = await supabase.rpc('next_sort_order', { p_project_id: projectId })

    const { error } = await supabase.from('snapshots').insert({
      id: snapshotId,
      project_id: projectId,
      image_url: posterUrl,
      tips: [],
      message_id: '',
      sort_order: sortData ?? 0,
      type: 'video',
      video_meta: videoMeta,
    })

    if (error) throw error

    return NextResponse.json({ snapshotId, videoUrl: permanentUrl, posterUrl, width, height, duration })
  } catch (err) {
    console.error('video-snapshot/upload error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
