import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import JSZip from 'jszip'

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params
    const format = req.nextUrl.searchParams.get('format') // 'json' for CLI consumption
    const admin = getSupabaseAdmin()

    const { data: share, error } = await admin
      .from('skill_shares')
      .select('sharer_id, skill_name')
      .eq('code', code)
      .single()

    if (error || !share) {
      return new Response(JSON.stringify({ error: 'Share not found' }), { status: 404 })
    }

    const { data: allFiles } = await admin
      .from('workspace_files')
      .select('path, storage_url, content_type, user_id')
      .like('path', `skills/${share.skill_name}/%`)

    if (!allFiles || allFiles.length === 0) {
      return new Response(JSON.stringify({ error: 'Skill no longer exists' }), { status: 404 })
    }

    // Group by path, prefer sharer's own files
    const fileMap = new Map<string, typeof allFiles[0]>()
    for (const f of allFiles) {
      const existing = fileMap.get(f.path)
      if (!existing || f.user_id === share.sharer_id) {
        fileMap.set(f.path, f)
      }
    }

    const prefix = `skills/${share.skill_name}/`
    const files: Array<{ path: string; data: Buffer; contentType: string }> = []

    for (const [filePath, file] of fileMap) {
      if (!file.storage_url) continue
      try {
        const resp = await fetch(file.storage_url)
        if (!resp.ok) continue
        const buf = Buffer.from(await resp.arrayBuffer())
        const relativePath = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
        files.push({ path: relativePath, data: buf, contentType: file.content_type || 'application/octet-stream' })
      } catch { /* skip failed files */ }
    }

    // JSON format for CLI: returns file list with base64 content
    if (format === 'json') {
      return Response.json({
        skillName: share.skill_name,
        files: files.map(f => ({
          path: f.path,
          contentType: f.contentType,
          data: f.data.toString('base64'),
        })),
      })
    }

    // Default: zip format
    const zip = new JSZip()
    for (const f of files) zip.file(f.path, f.data)
    const zipBuf = await zip.generateAsync({ type: 'arraybuffer' })

    return new Response(zipBuf, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${share.skill_name}.zip"`,
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
}
